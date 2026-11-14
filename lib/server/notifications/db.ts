/**
 * File-backed SQLite storage for the notification relay.
 *
 * Uses Node's built-in `node:sqlite` (synchronous API) so the app has no
 * native module to compile. The file lives on a persistent volume in
 * production (see `NOTIFICATIONS_DB_PATH`).
 *
 * Stored data is intentionally minimal: a push endpoint + keys, coarse
 * preferences, and a list of reminder instants. In detailed mode the reminder
 * content is an opaque AES-GCM ciphertext the server cannot read.
 */
import {createHash, randomBytes, randomUUID, timingSafeEqual} from "node:crypto";
import {mkdirSync} from "node:fs";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";

import {getNotificationServerConfig} from "./config";

export interface SubscriptionInput {
    endpoint: string;
    p256dh: string;
    auth: string;
    timezone: string;
    appVersion?: string;
    detailLevel: "generic" | "detailed";
    leadMinutes: number;
    consentVersion: string;
}

export interface ReminderInput {
    occurrenceKey: string;
    dueAt: string;
    expiresAt: string;
    payloadCiphertext?: string | null;
    payloadIv?: string | null;
}

export interface SubscriptionRow {
    id: string;
    tokenHash: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    timezone: string;
    detailLevel: "generic" | "detailed";
    consentVersion: string;
    createdAt: string;
    updatedAt: string;
    lastSeenAt: string;
    revokedAt: string | null;
}

export interface ReminderRow {
    id: string;
    subscriptionId: string;
    occurrenceKey: string;
    dueAt: string;
    status: "pending" | "sending" | "sent" | "failed" | "expired";
    payloadCiphertext: string | null;
    payloadIv: string | null;
    sentAt: string | null;
    attempts: number;
    lastError: string | null;
    expiresAt: string;
    retryAt: string | null;
    claimedAt: string | null;
}

export interface DueReminder extends ReminderRow {
    endpoint: string;
    p256dh: string;
    auth: string;
    detailLevel: "generic" | "detailed";
}

const MAX_ATTEMPTS = 5;
const SENDING_LEASE_MS = 5 * 60 * 1000;

type Row = Record<string, string | number | bigint | Uint8Array | null>;

function text(row: Row, key: string): string {
    const value = row[key];
    return typeof value === "string" ? value : value == null ? "" : String(value);
}

function number(row: Row, key: string): number {
    const value = row[key];
    return typeof value === "number" ? value : Number(value ?? 0);
}

function subscriptionFromRow(row: Row): SubscriptionRow {
    return {
        id: text(row, "id"),
        tokenHash: text(row, "token_hash"),
        endpoint: text(row, "endpoint"),
        p256dh: text(row, "p256dh"),
        auth: text(row, "auth"),
        timezone: text(row, "timezone"),
        detailLevel: text(row, "detail_level") === "detailed" ? "detailed" : "generic",
        consentVersion: text(row, "consent_version"),
        createdAt: text(row, "created_at"),
        updatedAt: text(row, "updated_at"),
        lastSeenAt: text(row, "last_seen_at"),
        revokedAt: text(row, "revoked_at") || null,
    };
}

function reminderFromRow(row: Row): ReminderRow {
    const status = text(row, "status");
    return {
        id: text(row, "id"),
        subscriptionId: text(row, "subscription_id"),
        occurrenceKey: text(row, "occurrence_key"),
        dueAt: text(row, "due_at"),
        status:
            status === "sending" ||
            status === "sent" ||
            status === "failed" ||
            status === "expired"
                ? status
                : "pending",
        payloadCiphertext: text(row, "payload_ciphertext") || null,
        payloadIv: text(row, "payload_iv") || null,
        sentAt: text(row, "sent_at") || null,
        attempts: number(row, "attempts"),
        lastError: text(row, "last_error") || null,
        expiresAt: text(row, "expires_at"),
        retryAt: text(row, "retry_at") || null,
        claimedAt: text(row, "claimed_at") || null,
    };
}

function dueReminderFromRow(row: Row): DueReminder {
    return {
        ...reminderFromRow(row),
        endpoint: text(row, "endpoint"),
        p256dh: text(row, "p256dh"),
        auth: text(row, "auth"),
        detailLevel: text(row, "detail_level") === "detailed" ? "detailed" : "generic",
    };
}

const globalForDb = globalThis as typeof globalThis & {
    __peptimaniaNotificationDb?: DatabaseSync;
};

function openDatabase(): DatabaseSync {
    if (globalForDb.__peptimaniaNotificationDb) {
        return globalForDb.__peptimaniaNotificationDb;
    }

    const {dbPath} = getNotificationServerConfig();
    mkdirSync(path.dirname(dbPath), {recursive: true});

    const database = new DatabaseSync(dbPath);
    database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;

        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id              TEXT PRIMARY KEY,
            token_hash      TEXT NOT NULL,
            endpoint        TEXT NOT NULL UNIQUE,
            p256dh          TEXT NOT NULL,
            auth            TEXT NOT NULL,
            timezone        TEXT NOT NULL,
            app_version     TEXT,
            detail_level    TEXT NOT NULL DEFAULT 'generic',
            lead_minutes    INTEGER NOT NULL DEFAULT 0,
            consent_version TEXT NOT NULL,
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL,
            last_seen_at    TEXT NOT NULL,
            revoked_at      TEXT
        );

        CREATE TABLE IF NOT EXISTS reminders (
            id                 TEXT PRIMARY KEY,
            subscription_id    TEXT NOT NULL REFERENCES push_subscriptions (id) ON DELETE CASCADE,
            occurrence_key     TEXT NOT NULL,
            due_at             TEXT NOT NULL,
            status             TEXT NOT NULL DEFAULT 'pending',
            payload_ciphertext TEXT,
            payload_iv         TEXT,
            sent_at            TEXT,
            attempts           INTEGER NOT NULL DEFAULT 0,
            last_error         TEXT,
            expires_at         TEXT NOT NULL,
            retry_at           TEXT,
            claimed_at         TEXT,
            UNIQUE (subscription_id, occurrence_key)
        );

        CREATE INDEX IF NOT EXISTS reminders_due_idx
            ON reminders (status, due_at);
        CREATE INDEX IF NOT EXISTS reminders_subscription_idx
            ON reminders (subscription_id);
    `);

    globalForDb.__peptimaniaNotificationDb = database;
    return database;
}

export function hashToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
}

function tokenMatches(candidate: string, expectedHash: string): boolean {
    const candidateHash = Buffer.from(hashToken(candidate), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    return candidateHash.length === expected.length && timingSafeEqual(candidateHash, expected);
}

function beginImmediate(database: DatabaseSync): void {
    database.exec("BEGIN IMMEDIATE");
}

/**
 * Creates a subscription, or rotates the token and refreshes the stored keys
 * when the same push endpoint registers again (e.g. after local storage was
 * cleared but the browser subscription survived).
 */
export function upsertSubscription(input: SubscriptionInput): { id: string; token: string } {
    const database = openDatabase();
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const now = new Date().toISOString();

    database
        .prepare(
            `INSERT INTO push_subscriptions
             (id, token_hash, endpoint, p256dh, auth, timezone, app_version, detail_level,
              lead_minutes, consent_version, created_at, updated_at, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (endpoint) DO UPDATE SET
                token_hash = excluded.token_hash,
                p256dh = excluded.p256dh,
                auth = excluded.auth,
                timezone = excluded.timezone,
                app_version = excluded.app_version,
                detail_level = excluded.detail_level,
                lead_minutes = excluded.lead_minutes,
                consent_version = excluded.consent_version,
                updated_at = excluded.updated_at,
                last_seen_at = excluded.last_seen_at,
                revoked_at = NULL`
        )
        .run(
            randomUUID(),
            tokenHash,
            input.endpoint,
            input.p256dh,
            input.auth,
            input.timezone,
            input.appVersion ?? null,
            input.detailLevel,
            input.leadMinutes,
            input.consentVersion,
            now,
            now,
            now
        );

    const row = database
        .prepare("SELECT id FROM push_subscriptions WHERE endpoint = ?")
        .get(input.endpoint);
    if (!row) throw new Error("subscription-write-failed");

    return {id: text(row, "id"), token};
}

export function getSubscription(id: string): SubscriptionRow | null {
    const row = openDatabase()
        .prepare("SELECT * FROM push_subscriptions WHERE id = ? AND revoked_at IS NULL")
        .get(id);
    return row ? subscriptionFromRow(row) : null;
}

/** Bearer-token check with a constant-time hash comparison. */
export function authenticateSubscription(id: string, token: string): SubscriptionRow | null {
    const subscription = getSubscription(id);
    if (!subscription) return null;
    return tokenMatches(token, subscription.tokenHash) ? subscription : null;
}

export function updateSubscription(
    id: string,
    input: Omit<SubscriptionInput, "endpoint"> & { endpoint?: string }
): void {
    const database = openDatabase();
    const now = new Date().toISOString();
    database
        .prepare(
            `UPDATE push_subscriptions
             SET p256dh = ?, auth = ?, timezone = ?, app_version = ?, detail_level = ?,
                 lead_minutes = ?, consent_version = ?, updated_at = ?, last_seen_at = ?
             WHERE id = ? AND revoked_at IS NULL`
        )
        .run(
            input.p256dh,
            input.auth,
            input.timezone,
            input.appVersion ?? null,
            input.detailLevel,
            input.leadMinutes,
            input.consentVersion,
            now,
            now,
            id
        );
}

export function markSubscriptionSeen(id: string): void {
    const now = new Date().toISOString();
    openDatabase()
        .prepare("UPDATE push_subscriptions SET last_seen_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, id);
}

/**
 * Replaces the pending reminder horizon for a subscription.
 *
 * - New occurrence keys are inserted.
 * - Existing pending/failed keys are refreshed (idempotent sync).
 * - Pending rows that are still in the future but no longer in the payload
 *   are deleted (a dose was logged, the schedule changed or paused).
 * - Already-sent rows are kept for delivery history/retention.
 */
export function replaceReminders(
    subscriptionId: string,
    reminders: ReminderInput[],
    now: Date = new Date()
): { inserted: number; removed: number } {
    const database = openDatabase();
    const nowIso = now.toISOString();
    const keys = new Set(reminders.map((reminder) => reminder.occurrenceKey));

    beginImmediate(database);
    try {
        const existing = database
            .prepare(
                `SELECT occurrence_key FROM reminders
                 WHERE subscription_id = ? AND status IN ('pending', 'failed') AND due_at > ?`
            )
            .all(subscriptionId, nowIso);

        const deleteReminder = database.prepare(
            "DELETE FROM reminders WHERE subscription_id = ? AND occurrence_key = ?"
        );
        let removed = 0;
        for (const row of existing) {
            const key = text(row, "occurrence_key");
            if (!keys.has(key)) {
                deleteReminder.run(subscriptionId, key);
                removed += 1;
            }
        }

        const upsert = database.prepare(
            `INSERT INTO reminders
             (id, subscription_id, occurrence_key, due_at, status, payload_ciphertext,
              payload_iv, expires_at, attempts)
             VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, 0)
             ON CONFLICT (subscription_id, occurrence_key) DO UPDATE SET
                due_at = excluded.due_at,
                payload_ciphertext = excluded.payload_ciphertext,
                payload_iv = excluded.payload_iv,
                expires_at = excluded.expires_at,
                status = CASE
                    WHEN reminders.status = 'sent' THEN 'sent'
                    WHEN reminders.status = 'sending' THEN 'sending'
                    ELSE 'pending'
                END,
                retry_at = CASE WHEN reminders.status = 'sending' THEN reminders.retry_at ELSE NULL END,
                claimed_at = CASE WHEN reminders.status = 'sending' THEN reminders.claimed_at ELSE NULL END,
                attempts = CASE WHEN reminders.status = 'sending' THEN reminders.attempts ELSE 0 END,
                last_error = CASE WHEN reminders.status = 'sending' THEN reminders.last_error ELSE NULL END`
        );

        for (const reminder of reminders) {
            upsert.run(
                randomUUID(),
                subscriptionId,
                reminder.occurrenceKey,
                reminder.dueAt,
                reminder.payloadCiphertext ?? null,
                reminder.payloadIv ?? null,
                reminder.expiresAt
            );
        }

        database.exec("COMMIT");
        return {inserted: reminders.length, removed};
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}

/**
 * Revokes a subscription and deletes its reminders. Keeps a tombstone row so
 * a repeated DELETE stays idempotent and the endpoint cannot be reused by an
 * unauthenticated caller.
 */
export function revokeSubscription(id: string): void {
    const database = openDatabase();
    const now = new Date().toISOString();
    beginImmediate(database);
    try {
        database
            .prepare("UPDATE push_subscriptions SET revoked_at = ?, updated_at = ? WHERE id = ?")
            .run(now, now, id);
        database.prepare("DELETE FROM reminders WHERE subscription_id = ?").run(id);
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}

/**
 * Claims up to `limit` due reminders for this worker.
 *
 * A single-writer SQLite transaction plus a `sending` lease prevents two
 * ticks in the same process (or two containers sharing the volume) from
 * sending the same reminder twice. Stale leases are released first, so a
 * crash mid-send retries on a later tick.
 */
export function claimDueReminders(
    limit: number,
    now: Date = new Date()
): DueReminder[] {
    const database = openDatabase();
    const nowIso = now.toISOString();
    const staleIso = new Date(now.getTime() - SENDING_LEASE_MS).toISOString();

    beginImmediate(database);
    try {
        database
            .prepare(
                `UPDATE reminders
                 SET status = 'pending', claimed_at = NULL
                 WHERE status = 'sending' AND claimed_at IS NOT NULL AND claimed_at < ?`
            )
            .run(staleIso);

        const rows = database
            .prepare(
                `SELECT r.*, s.endpoint, s.p256dh, s.auth, s.detail_level
                 FROM reminders r
                 JOIN push_subscriptions s ON s.id = r.subscription_id
                 WHERE r.status = 'pending'
                   AND r.due_at <= ?
                   AND (r.retry_at IS NULL OR r.retry_at <= ?)
                   AND r.expires_at > ?
                   AND s.revoked_at IS NULL
                 ORDER BY r.due_at ASC
                 LIMIT ?`
            )
            .all(nowIso, nowIso, nowIso, limit);

        const claim = database.prepare(
            `UPDATE reminders
             SET status = 'sending', claimed_at = ?, attempts = attempts + 1
             WHERE id = ? AND status = 'pending'`
        );
        const claimed: DueReminder[] = [];
        for (const row of rows) {
            const id = text(row, "id");
            const result = claim.run(nowIso, id);
            if (Number(result.changes) > 0) claimed.push(dueReminderFromRow(row));
        }

        database.exec("COMMIT");
        return claimed;
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}

export function markReminderSent(id: string, now: Date = new Date()): void {
    openDatabase()
        .prepare(
            `UPDATE reminders
             SET status = 'sent', sent_at = ?, claimed_at = NULL, last_error = NULL, retry_at = NULL
             WHERE id = ?`
        )
        .run(now.toISOString(), id);
}

export function markReminderRetry(id: string, errorCode: string, retryAt: Date): void {
    const database = openDatabase();
    const row = database.prepare("SELECT attempts FROM reminders WHERE id = ?").get(id);
    const attempts = row ? number(row, "attempts") : MAX_ATTEMPTS;

    if (attempts >= MAX_ATTEMPTS) {
        database
            .prepare(
                `UPDATE reminders
                 SET status = 'failed', claimed_at = NULL, last_error = ?, retry_at = NULL
                 WHERE id = ?`
            )
            .run(errorCode, id);
        return;
    }

    database
        .prepare(
            `UPDATE reminders
             SET status = 'pending', claimed_at = NULL, last_error = ?, retry_at = ?
             WHERE id = ?`
        )
        .run(errorCode, retryAt.toISOString(), id);
}

export function revokeReminderSubscription(subscriptionId: string): void {
    revokeSubscription(subscriptionId);
}

/** Deletes expired/sent rows and tombstones. Safe to call on every tick. */
export function pruneNotificationData(now: Date = new Date()): {
    reminders: number;
    subscriptions: number;
} {
    const database = openDatabase();
    const nowIso = now.toISOString();
    const {sentRetentionDays, subscriptionRetentionDays} = getNotificationServerConfig();
    const sentCutoff = new Date(now.getTime() - sentRetentionDays * 86_400_000).toISOString();
    const failedCutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const subscriptionCutoff = new Date(
        now.getTime() - subscriptionRetentionDays * 86_400_000
    ).toISOString();

    const reminders = database
        .prepare(
            `DELETE FROM reminders
             WHERE expires_at <= ?
                OR (status = 'sent' AND sent_at IS NOT NULL AND sent_at < ?)
                OR (status = 'failed' AND due_at < ?)`
        )
        .run(nowIso, sentCutoff, failedCutoff);
    const subscriptions = database
        .prepare(
            "DELETE FROM push_subscriptions WHERE revoked_at IS NOT NULL AND revoked_at < ?"
        )
        .run(subscriptionCutoff);

    return {
        reminders: Number(reminders.changes),
        subscriptions: Number(subscriptions.changes),
    };
}

/** Lightweight liveness probe; never returns user data. */
export function databaseIsHealthy(): boolean {
    try {
        return Boolean(openDatabase().prepare("SELECT 1 AS ok").get());
    } catch {
        return false;
    }
}

/** Test helper — closes the cached handle so a temp DB path can be reopened. */
export function closeNotificationDatabase(): void {
    if (globalForDb.__peptimaniaNotificationDb) {
        globalForDb.__peptimaniaNotificationDb.close();
        globalForDb.__peptimaniaNotificationDb = undefined;
    }
}

/** Retry delay for transient push-service errors (exponential, capped). */
export function retryDelayMs(attempts: number): number {
    return Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

export {MAX_ATTEMPTS};
