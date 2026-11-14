/**
 * Server-only configuration for the embedded notification relay.
 *
 * Everything here is read from `process.env` at request time (never bundled
 * into the client). The VAPID private key must only ever live on the server /
 * in the hosting platform's secret store.
 */
import path from "node:path";

export interface VapidConfig {
    publicKey: string;
    privateKey: string;
    subject: string;
}

export interface NotificationServerConfig {
    /** Absolute SQLite file path (persistent volume in production). */
    dbPath: string;
    /** `null` when VAPID keys are absent — the relay is then disabled. */
    vapid: VapidConfig | null;
    /** Extra browser origins allowed to call the relay (besides same-origin). */
    allowedOrigins: string[];
    /** Whether the in-process minute scheduler should run. */
    schedulerEnabled: boolean;
    /** Scheduler poll interval in milliseconds. */
    schedulerIntervalMs: number;
    /** Maximum reminders accepted per sync request. */
    maxReminders: number;
    /** Client sync horizon advertised through `/v1/config`. */
    horizonDays: number;
    /** Days after which a missing subscription is deleted. */
    subscriptionRetentionDays: number;
    /** Days after `sent_at` that delivered reminders are pruned. */
    sentRetentionDays: number;
}

const DEFAULT_DB_PATH = ".data/notifications.sqlite";
const DEFAULT_MAX_REMINDERS = 1000;
const DEFAULT_HORIZON_DAYS = 30;
const DEFAULT_SUBSCRIPTION_RETENTION_DAYS = 90;
const DEFAULT_SENT_RETENTION_DAYS = 7;

function envString(name: string): string | null {
    const value = process.env[name]?.trim();
    return value ? value : null;
}

function envInt(name: string, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
    const raw = envString(name);
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function envBool(name: string, fallback: boolean): boolean {
    const raw = envString(name)?.toLowerCase();
    if (!raw) return fallback;
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** Resolves the notification relay configuration for this process. */
export function getNotificationServerConfig(): NotificationServerConfig {
    const publicKey = envString("VAPID_PUBLIC_KEY");
    const privateKey = envString("VAPID_PRIVATE_KEY");
    const subject = envString("VAPID_SUBJECT") ?? "mailto:notifications@localhost";
    const configured = Boolean(publicKey && privateKey);

    return {
        // The path is intentionally runtime-configurable (persistent volume in
        // production). Opt out of Turbopack's dynamic-filesystem tracing so a
        // custom DB path does not pull the whole project into the bundle.
        dbPath: path.resolve(
            /*turbopackIgnore: true*/ process.cwd(),
            envString("NOTIFICATIONS_DB_PATH") ?? DEFAULT_DB_PATH
        ),
        vapid: configured
            ? {
                publicKey: publicKey as string,
                privateKey: privateKey as string,
                subject,
            }
            : null,
        allowedOrigins: (envString("NOTIFICATIONS_ALLOWED_ORIGINS") ?? "")
            .split(",")
            .map((origin) => origin.trim().replace(/\/$/, ""))
            .filter(Boolean),
        schedulerEnabled: envBool("NOTIFICATIONS_SCHEDULER", true),
        schedulerIntervalMs: envInt("NOTIFICATIONS_SCHEDULER_INTERVAL_MS", 60_000, 10_000, 3_600_000),
        maxReminders: envInt("NOTIFICATIONS_MAX_REMINDERS", DEFAULT_MAX_REMINDERS, 1, 10_000),
        horizonDays: envInt("NOTIFICATIONS_HORIZON_DAYS", DEFAULT_HORIZON_DAYS, 1, 90),
        subscriptionRetentionDays: envInt(
            "NOTIFICATIONS_SUBSCRIPTION_RETENTION_DAYS",
            DEFAULT_SUBSCRIPTION_RETENTION_DAYS,
            7,
            3650
        ),
        sentRetentionDays: envInt(
            "NOTIFICATIONS_SENT_RETENTION_DAYS",
            DEFAULT_SENT_RETENTION_DAYS,
            1,
            365
        ),
    };
}
