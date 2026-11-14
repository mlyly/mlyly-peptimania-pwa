/**
 * Smoke test for the notification relay contract and the pure client helpers,
 * runnable in Node via tsx (no browser, no network):
 *
 *   npx tsx scripts/notifications-smoke.ts
 *
 * Exercises: consent gating, snooze re-arming of already-sent reminders,
 * attempt counting and retry/failed classification, idempotent DELETE, the
 * generic payload contents, override retention and the 500-entry cap.
 */
import {createECDH, randomBytes} from "node:crypto";
import {rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";

import * as webpush from "web-push";

import {NOTIFICATIONS_CONSENT_VERSION} from "../lib/notifications/consent";
import {pruneOverrides} from "../lib/notifications/overrides";
import {settingDefinition} from "../lib/settings/definitions";
import {
    authenticateAnySubscription,
    authenticateSubscription,
    claimDueReminders,
    closeNotificationDatabase,
    markReminderFailed,
    markReminderRetry,
    markReminderSent,
} from "../lib/server/notifications/db";
import {buildReminderPayload, type PushPayload} from "../lib/server/notifications/push";
import {
    createSubscription,
    deleteSubscription,
    processDueReminders,
    RelayError,
    updateSubscription,
} from "../lib/server/notifications/service";

const dbPath = path.join(os.tmpdir(), `peptimania-notifications-smoke-${process.pid}.sqlite`);
for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, {force: true});

const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
process.env.NOTIFICATIONS_DB_PATH = dbPath;
process.env.NOTIFICATIONS_SCHEDULER = "0";

let failed = false;

function check(label: string, condition: boolean) {
    if (condition) {
        console.log(`✓ ${label}`);
    } else {
        console.error(`✗ ${label}`);
        failed = true;
    }
}

const MINUTE = 60_000;

/** A push subscription with real P-256 / auth key material so web-push can encrypt. */
function newSubscription(endpoint: string) {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    return {
        endpoint,
        keys: {
            p256dh: ecdh.getPublicKey().toString("base64url"),
            auth: randomBytes(16).toString("base64url"),
        },
    };
}

async function main(): Promise<void> {
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();

    const client = {timezone: "UTC"};
    const preferences = {detailLevel: "generic" as const, leadMinutes: 0};
    const consent = {version: NOTIFICATIONS_CONSENT_VERSION, acceptedAt: iso(now)};
    const subscription = newSubscription("https://fcm.googleapis.com/fcm/send/smoke-main");
    const KEY = "sched-1@2026-11-14";

    // Consent gate: a sync carrying an outdated disclosure version is refused.
    try {
        createSubscription({
            subscription,
            client,
            preferences,
            consent: {version: "outdated", acceptedAt: iso(now)},
            reminders: [],
        } as never);
        check("outdated consent is rejected", false);
    } catch (error) {
        check(
            "outdated consent is rejected",
            error instanceof RelayError && error.code === "consent-outdated"
        );
    }

    const created = createSubscription({
        subscription,
        client,
        preferences,
        consent,
        reminders: [{occurrenceKey: KEY, dueAt: iso(now - MINUTE)}],
    } as never);

    const [first] = claimDueReminders(10, new Date(now));
    check("first claim is attempt 1", first?.attempts === 1);
    markReminderSent(first.id, new Date(now));

    // Re-syncing the same instant must not re-arm a delivered reminder.
    updateSubscription(created.subscriptionId, {
        client,
        preferences,
        consent,
        reminders: [{occurrenceKey: KEY, dueAt: iso(now - MINUTE)}],
    } as never);
    check(
        "unchanged re-sync keeps a delivered reminder sent",
        claimDueReminders(10, new Date(now)).length === 0
    );

    // Snoozing moves the due time, so the already-delivered occurrence fires again.
    updateSubscription(created.subscriptionId, {
        client,
        preferences,
        consent,
        reminders: [{occurrenceKey: KEY, dueAt: iso(now + 15 * MINUTE)}],
    } as never);
    const snoozed = claimDueReminders(10, new Date(now + 16 * MINUTE));
    check("snoozed occurrence is re-armed and claimable", snoozed.length === 1);
    if (snoozed[0]) markReminderSent(snoozed[0].id, new Date(now + 16 * MINUTE));

    // Transient retry: not claimable until retry_at, then attempt numbers keep counting.
    updateSubscription(created.subscriptionId, {
        client,
        preferences,
        consent,
        reminders: [{occurrenceKey: "sched-2@2026-11-14", dueAt: iso(now + 20 * MINUTE)}],
    } as never);
    const [retryable] = claimDueReminders(10, new Date(now + 21 * MINUTE));
    if (retryable) markReminderRetry(retryable.id, "http-503", new Date(now + 40 * MINUTE));
    check(
        "retry is not claimable before retry_at",
        claimDueReminders(10, new Date(now + 30 * MINUTE)).length === 0
    );
    const [retried] = claimDueReminders(10, new Date(now + 41 * MINUTE));
    check("retry is claimable after retry_at with attempt 2", retried?.attempts === 2);
    if (retried) markReminderFailed(retried.id, "http-400");
    check(
        "permanent failure is never claimed again",
        claimDueReminders(10, new Date(now + 90 * MINUTE)).length === 0
    );

    // Transport failure (no HTTP status) is transient and goes to retry, not failed.
    const unreachable = createSubscription({
        subscription: newSubscription("https://127.0.0.1:9/smoke-net"),
        client,
        preferences,
        consent,
        reminders: [{occurrenceKey: "net@2026-11-14", dueAt: iso(now - MINUTE)}],
    } as never);
    const tick = await processDueReminders(10);
    check("connection failure is counted as retry", tick.retried === 1 && tick.failed === 0);
    deleteSubscription(unreachable.subscriptionId);

    // DELETE is idempotent: the original token still authenticates the tombstone.
    deleteSubscription(created.subscriptionId);
    check(
        "repeat DELETE with the original token is accepted",
        authenticateAnySubscription(created.subscriptionId, created.token)
    );
    check(
        "revoked subscription no longer serves normal requests",
        authenticateSubscription(created.subscriptionId, created.token) === null
    );
    check(
        "wrong token is rejected on DELETE",
        !authenticateAnySubscription(created.subscriptionId, "not-the-token")
    );

    // Generic payloads never carry medication data, even if ciphertext is present.
    const genericPayload: PushPayload = buildReminderPayload({
        id: "x",
        subscriptionId: "x",
        occurrenceKey: KEY,
        dueAt: iso(now),
        status: "sending",
        payloadCiphertext: "should-not-appear",
        payloadIv: "iv",
        sentAt: null,
        attempts: 1,
        lastError: null,
        expiresAt: iso(now),
        retryAt: null,
        claimedAt: null,
        endpoint: "",
        p256dh: "",
        auth: "",
        detailLevel: "generic",
    } as never);
    check(
        "generic payload has only the fixed fields",
        Object.keys(genericPayload).sort().join(",") === "body,tag,title,type,url,v"
    );
    check(
        "generic payload never includes ciphertext",
        !JSON.stringify(genericPayload).includes("should-not-appear")
    );

    // Notification overrides: old days are pruned, and the cap keeps the newest actions.
    const day = (offset: number) => new Date(now + offset * 86_400_000).toISOString().slice(0, 10);
    const pruned = pruneOverrides(
        {
            [`s@${day(-10)}`]: {skippedAt: iso(now)},
            [`s@${day(0)}`]: {skippedAt: iso(now)},
        },
        new Date(now)
    );
    check("overrides older than the centre window are pruned", Object.keys(pruned).length === 1);

    const overrideDef = settingDefinition("notifications.overrides");
    const raw: Record<string, { skippedAt: string }> = {};
    for (let index = 0; index < 510; index += 1) {
        raw[`s-${index}@${day(0)}`] = {skippedAt: iso(now - (510 - index) * MINUTE)};
    }
    const capped = overrideDef.parse(raw);
    check("override cap keeps 500 entries", Object.keys(capped).length === 500);
    check("override cap keeps the newest action", `s-509@${day(0)}` in capped);
    check("override cap drops the oldest action", !(`s-0@${day(0)}` in capped));

    closeNotificationDatabase();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, {force: true});

    if (failed) {
        console.error("\nNotification smoke test FAILED");
        process.exitCode = 1;
    } else {
        console.log("\nNotification smoke test passed");
    }
}

void main();
