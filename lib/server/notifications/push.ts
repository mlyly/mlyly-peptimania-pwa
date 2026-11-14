/**
 * Web Push delivery (RFC 8291 / RFC 8292) via `web-push`.
 *
 * Generic reminders contain only "a dose is due". Detailed reminders carry an
 * opaque AES-GCM blob produced in the browser; the relay forwards it without
 * being able to decrypt it.
 */
import webpush from "web-push";

import {getNotificationServerConfig} from "./config";
import type {DueReminder, SubscriptionRow} from "./db";

let configuredKey: string | null = null;

function ensureVapid(): { configured: true } | { configured: false } {
    const {vapid} = getNotificationServerConfig();
    if (!vapid) return {configured: false};
    if (configuredKey !== vapid.publicKey) {
        webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
        configuredKey = vapid.publicKey;
    }
    return {configured: true};
}

export function pushIsConfigured(): boolean {
    return getNotificationServerConfig().vapid !== null;
}

export interface PushPayload {
    v: 1;
    type: "dose-due" | "test";
    title?: string;
    body?: string;
    enc?: { alg: "A256GCM"; iv: string; ct: string };
    tag: string;
    url: string;
}

function focusUrl(occurrenceKey: string): string {
    return `/notifications?focus=${encodeURIComponent(occurrenceKey)}`;
}

/** Builds the exact JSON payload pushed for a reminder. */
export function buildReminderPayload(reminder: DueReminder): PushPayload {
    const tag = `dose-${reminder.occurrenceKey}`;
    const url = focusUrl(reminder.occurrenceKey);

    if (
        reminder.detailLevel === "detailed" &&
        reminder.payloadCiphertext &&
        reminder.payloadIv
    ) {
        return {
            v: 1,
            type: "dose-due",
            enc: {
                alg: "A256GCM",
                iv: reminder.payloadIv,
                ct: reminder.payloadCiphertext,
            },
            tag,
            url,
        };
    }

    return {
        v: 1,
        type: "dose-due",
        title: "Dose due",
        body: "A scheduled dose is due.",
        tag,
        url,
    };
}

export function buildTestPayload(): PushPayload {
    return {
        v: 1,
        type: "test",
        title: "Peptimania test notification",
        body: "Background reminders are working.",
        tag: "peptimania-test",
        url: "/notifications",
    };
}

function pushTarget(subscription: SubscriptionRow | DueReminder) {
    return {
        endpoint: subscription.endpoint,
        keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
        },
    };
}

export type PushSendResult =
    | { ok: true }
    | { ok: false; statusCode: number | null; reason: "gone" | "retry" | "failed" };

function classify(error: unknown): PushSendResult {
    const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error
            ? Number((error as { statusCode?: unknown }).statusCode)
            : null;

    if (statusCode === 404 || statusCode === 410) {
        return {ok: false, statusCode, reason: "gone"};
    }
    if (statusCode === 429 || (statusCode !== null && statusCode >= 500)) {
        return {ok: false, statusCode, reason: "retry"};
    }
    return {ok: false, statusCode, reason: "failed"};
}

export async function sendPush(
    subscription: SubscriptionRow | DueReminder,
    payload: PushPayload
): Promise<PushSendResult> {
    if (!ensureVapid().configured) {
        return {ok: false, statusCode: null, reason: "failed"};
    }

    try {
        await webpush.sendNotification(pushTarget(subscription), JSON.stringify(payload), {
            TTL: 60 * 60 * 6,
            urgency: "high",
        });
        return {ok: true};
    } catch (error) {
        return classify(error);
    }
}

/** Content-free error label stored in `last_error` (never logs the message). */
export function safePushError(result: PushSendResult): string {
    if (result.ok) return "";
    if (result.statusCode !== null) return `http-${result.statusCode}`;
    return result.reason;
}
