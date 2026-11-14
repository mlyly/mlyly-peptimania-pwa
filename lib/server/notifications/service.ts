/**
 * Relay service layer: turns validated requests into database mutations and
 * drives one delivery tick. Routes stay thin; scheduling stays deterministic.
 */
import {randomUUID} from "node:crypto";

import {getNotificationServerConfig} from "./config";
import {
    claimDueReminders,
    getSubscription,
    markReminderRetry,
    markReminderSent,
    markSubscriptionSeen,
    pruneNotificationData,
    type ReminderInput,
    replaceReminders,
    retryDelayMs,
    revokeSubscription,
    type SubscriptionRow,
    updateSubscription as updateSubscriptionRow,
    upsertSubscription,
} from "./db";
import {buildReminderPayload, buildTestPayload, pushIsConfigured, safePushError, sendPush} from "./push";
import type {CreateSubscriptionPayload, SyncPayload} from "./schemas";

export type RelayErrorCode =
    | "relay-not-configured"
    | "invalid-reminders"
    | "endpoint-mismatch"
    | "subscription-not-found"
    | "push-failed";

export class RelayError extends Error {
    constructor(
        readonly code: RelayErrorCode,
        readonly status: number,
        message: string = code
    ) {
        super(message);
        this.name = "RelayError";
    }
}

const DAY_MS = 86_400_000;

/** Public runtime configuration for the client. No secrets. */
export function publicRelayConfig() {
    const config = getNotificationServerConfig();
    return {
        configured: pushIsConfigured(),
        vapidPublicKey: config.vapid?.publicKey ?? null,
        maxReminders: config.maxReminders,
        horizonDays: config.horizonDays,
        detailLevels: ["generic", "detailed"] as const,
        schedulerEnabled: config.schedulerEnabled,
        version: 1,
    };
}

/**
 * Normalises the client horizon:
 * - drops duplicate occurrence keys,
 * - ignores due times outside a sane window (a day late … horizon + a day),
 * - attaches encrypted content only in detailed mode,
 * - caps the number of rows.
 */
function sanitizeReminders(
    payload: Pick<SyncPayload, "reminders" | "preferences">,
    now: Date
): ReminderInput[] {
    const config = getNotificationServerConfig();
    const nowMs = now.getTime();
    const earliest = nowMs - DAY_MS;
    const latest = nowMs + (config.horizonDays + 1) * DAY_MS;
    const detailed = payload.preferences.detailLevel === "detailed";
    const seen = new Set<string>();
    const reminders: ReminderInput[] = [];

    for (const reminder of payload.reminders) {
        if (seen.has(reminder.occurrenceKey)) continue;
        const dueMs = Date.parse(reminder.dueAt);
        if (!Number.isFinite(dueMs) || dueMs < earliest || dueMs > latest) continue;
        seen.add(reminder.occurrenceKey);

        const encrypted =
            detailed && reminder.encryptedPayload
                ? {
                    payloadIv: reminder.encryptedPayload.iv,
                    payloadCiphertext: reminder.encryptedPayload.ct,
                }
                : {payloadIv: null, payloadCiphertext: null};

        reminders.push({
            occurrenceKey: reminder.occurrenceKey,
            dueAt: new Date(dueMs).toISOString(),
            expiresAt: new Date(dueMs + 30 * DAY_MS).toISOString(),
            ...encrypted,
        });
    }

    reminders.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    return reminders.slice(0, config.maxReminders);
}

export function createSubscription(payload: CreateSubscriptionPayload): {
    subscriptionId: string;
    token: string;
} {
    if (!pushIsConfigured()) {
        throw new RelayError("relay-not-configured", 503);
    }

    const now = new Date();
    const reminders = sanitizeReminders(payload, now);
    const {id, token} = upsertSubscription({
        endpoint: payload.subscription.endpoint,
        p256dh: payload.subscription.keys.p256dh,
        auth: payload.subscription.keys.auth,
        timezone: payload.client.timezone,
        appVersion: payload.client.appVersion,
        detailLevel: payload.preferences.detailLevel,
        leadMinutes: payload.preferences.leadMinutes,
        consentVersion: payload.consent.version,
    });
    replaceReminders(id, reminders, now);
    return {subscriptionId: id, token};
}

export function updateSubscription(id: string, payload: SyncPayload): void {
    const existing = getSubscription(id);
    if (!existing) throw new RelayError("subscription-not-found", 404);

    if (payload.subscription && payload.subscription.endpoint !== existing.endpoint) {
        throw new RelayError("endpoint-mismatch", 409);
    }

    const now = new Date();
    updateSubscriptionRow(id, {
        endpoint: existing.endpoint,
        p256dh: payload.subscription?.keys.p256dh ?? existing.p256dh,
        auth: payload.subscription?.keys.auth ?? existing.auth,
        timezone: payload.client.timezone,
        appVersion: payload.client.appVersion,
        detailLevel: payload.preferences.detailLevel,
        leadMinutes: payload.preferences.leadMinutes,
        consentVersion: payload.consent.version,
    });
    replaceReminders(id, sanitizeReminders(payload, now), now);
    markSubscriptionSeen(id);
}

export function deleteSubscription(id: string): void {
    revokeSubscription(id);
}

export async function sendTestNotification(subscription: SubscriptionRow): Promise<void> {
    const result = await sendPush(subscription, buildTestPayload());
    if (!result.ok) {
        if (result.reason === "gone") revokeSubscription(subscription.id);
        throw new RelayError("push-failed", 502);
    }
}

export interface TickResult {
    claimed: number;
    sent: number;
    retried: number;
    revoked: number;
    pruned: number;
}

/**
 * One delivery tick: claim due rows, push each one, then prune retention.
 * Failures are content-free; a revoked push subscription is deleted on 404/410.
 */
export async function processDueReminders(limit = 100): Promise<TickResult> {
    const now = new Date();
    const due = claimDueReminders(limit, now);
    const result: TickResult = {
        claimed: due.length,
        sent: 0,
        retried: 0,
        revoked: 0,
        pruned: 0,
    };

    for (const reminder of due) {
        const sentAt = new Date();
        const response = await sendPush(reminder, buildReminderPayload(reminder));
        if (response.ok) {
            markReminderSent(reminder.id, sentAt);
            result.sent += 1;
            continue;
        }

        if (response.reason === "gone") {
            revokeSubscription(reminder.subscriptionId);
            result.revoked += 1;
            continue;
        }

        const code = safePushError(response);
        const delay =
            response.reason === "retry"
                ? retryDelayMs(reminder.attempts)
                : Math.min(30 * 60_000, 60_000 * reminder.attempts);
        markReminderRetry(reminder.id, code, new Date(sentAt.getTime() + delay));
        result.retried += 1;
    }

    const pruned = pruneNotificationData(now);
    result.pruned = pruned.reminders + pruned.subscriptions;
    return result;
}

/** Creates a fresh id for callers that need one (kept here for testability). */
export function newSubscriptionId(): string {
    return randomUUID();
}
