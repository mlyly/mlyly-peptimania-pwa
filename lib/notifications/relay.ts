"use client";

/**
 * Relay client: runtime config discovery, push subscription lifecycle,
 * reminder-horizon sync, test pushes and local-only status.
 *
 * Design rules (see `docs/notifications-plan.md`):
 * - Every function is a no-op when notifications are disabled, consent is
 *   missing/outdated or the relay is not configured.
 * - The bearer token and AES key never leave the `peptimania-notifications`
 *   IndexedDB database.
 * - Detailed reminder text is encrypted before it is added to the sync body.
 * - Sync requests are debounced; an app boot/visibility/schedule change only
 *   refreshes the next 30 days of concrete instants.
 */
import * as React from "react";

import {ensureDatabase} from "@/lib/db";
import {listMedications} from "@/lib/medications/service";
import {addDays, formatClockTime} from "@/lib/scheduling/dates";
import {rangeAgenda} from "@/lib/scheduling/occurrences";
import {listDoseLogs, listSchedules} from "@/lib/scheduling/service";
import {loadSettings} from "@/lib/settings/service";
import type {AppSettings, NotificationDetailLevel} from "@/lib/settings/definitions";

import {base64UrlToBytes} from "./base64";
import {getNotificationSupport} from "./capabilities";
import {hasCurrentNotificationConsent} from "./consent";
import {encryptDetailedPayload, type EncryptedDetailPayload} from "./detail-crypto";
import {
    clearNotificationSecrets,
    clearRelayCredentials,
    getRelayCredentials,
    type RelayCredentials,
    saveRelayCredentials,
} from "./storage";

const DAY_MS = 86_400_000;
const LATE_WINDOW_MS = 15 * 60 * 1000;
const SYNC_DEBOUNCE_MS = 1_500;
const CONFIG_TTL_MS = 5 * 60 * 1000;
const STATUS_STORAGE_KEY = "peptimania.notifications.relay-status";
const REQUEST_TIMEOUT_MS = 20_000;

export interface RelayConfig {
    configured: boolean;
    vapidPublicKey: string | null;
    maxReminders: number;
    horizonDays: number;
    detailLevels: readonly string[];
    schedulerEnabled: boolean;
    version: number;
}

export interface RelayStatus {
    /** `null` until `/v1/config` has been read (or when it is unreachable). */
    configured: boolean | null;
    /** True when this device has a stored bearer credential. */
    subscriptionActive: boolean;
    syncing: boolean;
    lastSyncedAt: string | null;
    lastError: string | null;
}

interface SyncReminder {
    occurrenceKey: string;
    dueAt: string;
    encryptedPayload?: EncryptedDetailPayload;
}

interface SyncBody {
    subscription: unknown;
    client: { timezone: string };
    preferences: { detailLevel: NotificationDetailLevel; leadMinutes: number };
    consent: { version: string; acceptedAt: string };
    reminders: SyncReminder[];
}

const EMPTY_STATUS: RelayStatus = {
    configured: null,
    subscriptionActive: false,
    syncing: false,
    lastSyncedAt: null,
    lastError: null,
};

function loadPersistedStatus(): Partial<RelayStatus> {
    try {
        const raw = window.localStorage.getItem(STATUS_STORAGE_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return {};
        const record = parsed as Record<string, unknown>;
        return {
            subscriptionActive: record.subscriptionActive === true,
            lastSyncedAt:
                typeof record.lastSyncedAt === "string" ? record.lastSyncedAt : null,
            lastError: typeof record.lastError === "string" ? record.lastError : null,
        };
    } catch {
        return {};
    }
}

let status: RelayStatus = {...EMPTY_STATUS, ...(typeof window === "undefined" ? {} : loadPersistedStatus())};
const statusListeners = new Set<() => void>();

function persistStatus(): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(
            STATUS_STORAGE_KEY,
            JSON.stringify({
                subscriptionActive: status.subscriptionActive,
                lastSyncedAt: status.lastSyncedAt,
                lastError: status.lastError,
            })
        );
    } catch {
        // Storage failures only affect the status line, never the app.
    }
}

function setStatus(patch: Partial<RelayStatus>): void {
    status = {...status, ...patch};
    persistStatus();
    for (const listener of statusListeners) listener();
}

export function getRelayStatus(): RelayStatus {
    return status;
}

export function useRelayStatus(): RelayStatus {
    return React.useSyncExternalStore(
        (listener) => {
            statusListeners.add(listener);
            return () => statusListeners.delete(listener);
        },
        () => status,
        () => EMPTY_STATUS
    );
}

function relayBaseUrl(): string {
    return (process.env.NEXT_PUBLIC_NOTIFICATION_RELAY_URL ?? "").trim().replace(/\/+$/, "");
}

function relayUrl(path: string): string {
    return `${relayBaseUrl()}${path}`;
}

function timeoutSignal(): AbortSignal {
    const controller = new AbortController();
    window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    return controller.signal;
}

function parseRelayConfig(value: unknown): RelayConfig | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.configured !== "boolean") return null;
    if (record.vapidPublicKey !== null && typeof record.vapidPublicKey !== "string") return null;
    return {
        configured: record.configured,
        vapidPublicKey: record.vapidPublicKey,
        maxReminders:
            typeof record.maxReminders === "number" && record.maxReminders > 0
                ? Math.trunc(record.maxReminders)
                : 1000,
        horizonDays:
            typeof record.horizonDays === "number" && record.horizonDays > 0
                ? Math.trunc(record.horizonDays)
                : 30,
        detailLevels: Array.isArray(record.detailLevels)
            ? record.detailLevels.filter((level): level is string => typeof level === "string")
            : ["generic", "detailed"],
        schedulerEnabled: record.schedulerEnabled === true,
        version: typeof record.version === "number" ? record.version : 1,
    };
}

let configCache: { value: RelayConfig; at: number } | null = null;
let configInFlight: Promise<RelayConfig> | null = null;

export async function fetchRelayConfig(force = false): Promise<RelayConfig> {
    const now = Date.now();
    if (!force && configCache && now - configCache.at < CONFIG_TTL_MS) {
        return configCache.value;
    }
    if (configInFlight) return configInFlight;

    configInFlight = (async () => {
        const response = await fetch(relayUrl("/v1/config"), {
            cache: "no-store",
            headers: {accept: "application/json"},
            signal: timeoutSignal(),
        });
        if (!response.ok) {
            throw new Error(`The notification relay is unavailable (HTTP ${response.status}).`);
        }
        const parsed = parseRelayConfig(await response.json());
        if (!parsed) throw new Error("The notification relay returned an invalid configuration.");
        configCache = {value: parsed, at: Date.now()};
        setStatus({configured: parsed.configured});
        return parsed;
    })().finally(() => {
        configInFlight = null;
    });

    return configInFlight;
}

/** Re-reads `/v1/config`; used by the Settings status panel. */
export async function refreshRelayStatus(): Promise<void> {
    try {
        await fetchRelayConfig(true);
    } catch {
        setStatus({configured: null});
    }
}

async function ensurePushSubscription(vapidPublicKey: string): Promise<PushSubscription> {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("This browser does not support Web Push.");
    }
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
        throw new Error(
            "The notification worker is not ready yet. Reload the app and try again."
        );
    }
    const ready = registration.active ? registration : await navigator.serviceWorker.ready;

    let subscription = await ready.pushManager.getSubscription();
    const keyBytes = base64UrlToBytes(vapidPublicKey);
    const currentKey = subscription?.options.applicationServerKey;
    if (subscription && currentKey) {
        const currentBytes = new Uint8Array(currentKey);
        const changed =
            currentBytes.length !== keyBytes.length ||
            currentBytes.some((byte, index) => byte !== keyBytes[index]);
        if (changed) {
            await subscription.unsubscribe();
            subscription = null;
        }
    }

    if (!subscription) {
        subscription = await ready.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyBytes as BufferSource,
        });
    }
    return subscription;
}

function serverSubscription(subscription: PushSubscription): unknown {
    return subscription.toJSON();
}

function detailedContent(
    medicationName: string | null,
    doseAmount: number,
    unit: string,
    scheduledAt: Date
): { title: string; body: string } {
    const title = medicationName ? `${medicationName} dose due` : "Dose due";
    const dose = `${doseAmount} ${unit}`;
    const body = medicationName
        ? `${dose} · scheduled for ${formatClockTime(scheduledAt)}.`
        : `Scheduled for ${formatClockTime(scheduledAt)}.`;
    return {
        title: title.slice(0, 120),
        body: body.slice(0, 240),
    };
}

async function buildReminders(
    settings: AppSettings,
    config: RelayConfig
): Promise<SyncReminder[]> {
    await ensureDatabase();
    const [schedules, doseLogs, medications] = await Promise.all([
        listSchedules(),
        listDoseLogs(),
        listMedications(),
    ]);

    const now = new Date();
    const agenda = rangeAgenda(
        schedules,
        doseLogs,
        addDays(now, -1),
        addDays(now, config.horizonDays),
        now
    );
    const medicationNames = new Map(
        medications.map((medication) => [medication.id, medication.name])
    );
    const overrides = settings["notifications.overrides"];
    const leadMs = settings["notifications.leadMinutes"] * 60_000;
    const nowMs = now.getTime();

    const candidates: {
        occurrenceKey: string;
        dueMs: number;
        medicationName: string | null;
        doseAmount: number;
        unit: string;
        scheduledAt: Date;
    }[] = [];

    for (const occurrence of agenda) {
        if (occurrence.status === "done") continue;
        if (occurrence.scheduledAt.getTime() < nowMs - LATE_WINDOW_MS) continue;

        const override = overrides[occurrence.key];
        if (override?.skippedAt) continue;

        let dueMs = occurrence.scheduledAt.getTime() - leadMs;
        if (override?.snoozeUntil) {
            const snoozed = Date.parse(override.snoozeUntil);
            if (Number.isFinite(snoozed) && snoozed > dueMs) dueMs = snoozed;
        }
        if (dueMs < nowMs - LATE_WINDOW_MS) continue;
        if (dueMs > nowMs + (config.horizonDays + 1) * DAY_MS) continue;

        candidates.push({
            occurrenceKey: occurrence.key,
            dueMs,
            medicationName: medicationNames.get(occurrence.medicationId) ?? null,
            doseAmount: occurrence.doseAmount,
            unit: occurrence.unit,
            scheduledAt: occurrence.scheduledAt,
        });
    }

    candidates.sort((a, b) => a.dueMs - b.dueMs || a.occurrenceKey.localeCompare(b.occurrenceKey));
    const capped = candidates.slice(0, config.maxReminders);
    const detailed = settings["notifications.detailLevel"] === "detailed";

    return Promise.all(
        capped.map(async (candidate) => {
            const reminder: SyncReminder = {
                occurrenceKey: candidate.occurrenceKey,
                dueAt: new Date(candidate.dueMs).toISOString(),
            };
            if (detailed) {
                reminder.encryptedPayload = await encryptDetailedPayload(
                    detailedContent(
                        candidate.medicationName,
                        candidate.doseAmount,
                        candidate.unit,
                        candidate.scheduledAt
                    )
                );
            }
            return reminder;
        })
    );
}

async function buildSyncBody(
    settings: AppSettings,
    config: RelayConfig,
    subscription: PushSubscription
): Promise<SyncBody> {
    const reminders = await buildReminders(settings, config);
    return {
        subscription: serverSubscription(subscription),
        client: {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        },
        preferences: {
            detailLevel: settings["notifications.detailLevel"],
            leadMinutes: settings["notifications.leadMinutes"],
        },
        consent: {
            version: settings["notifications.consentVersion"] ?? "",
            acceptedAt: settings["notifications.consentAt"] ?? "",
        },
        reminders,
    };
}

function relayHttpError(status: number): Error {
    if (status === 401 || status === 403) {
        return new Error("The relay rejected this device's credentials.");
    }
    if (status === 413) return new Error("The reminder list is too large for the relay.");
    if (status === 429) return new Error("Too many sync attempts. Try again in a minute.");
    if (status === 503) return new Error("Background delivery is not configured on the relay.");
    return new Error(`The relay request failed (HTTP ${status}).`);
}

async function createRelaySubscription(body: SyncBody): Promise<RelayCredentials> {
    const response = await fetch(relayUrl("/v1/subscriptions"), {
        method: "POST",
        headers: {"content-type": "application/json", accept: "application/json"},
        body: JSON.stringify(body),
        signal: timeoutSignal(),
    });
    if (!response.ok) throw relayHttpError(response.status);

    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== "object") {
        throw new Error("The relay returned an invalid subscription response.");
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.subscriptionId !== "string" || typeof record.token !== "string") {
        throw new Error("The relay returned an invalid subscription response.");
    }
    const credentials: RelayCredentials = {
        subscriptionId: record.subscriptionId,
        token: record.token,
        endpoint: (body.subscription as { endpoint?: string }).endpoint ?? "",
    };
    await saveRelayCredentials(credentials);
    return credentials;
}

async function putRelaySubscription(
    credentials: RelayCredentials,
    body: SyncBody
): Promise<"ok" | "recreate"> {
    const response = await fetch(
        relayUrl(`/v1/subscriptions/${encodeURIComponent(credentials.subscriptionId)}`),
        {
            method: "PUT",
            headers: {
                "content-type": "application/json",
                accept: "application/json",
                authorization: `Bearer ${credentials.token}`,
            },
            body: JSON.stringify(body),
            signal: timeoutSignal(),
        }
    );
    if (response.status === 401 || response.status === 404 || response.status === 409) {
        await clearRelayCredentials();
        return "recreate";
    }
    if (!response.ok) throw relayHttpError(response.status);
    return "ok";
}

function safeErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        // Our own errors contain only status codes / generic text.
        return error.message;
    }
    return "Could not sync reminders with the relay.";
}

async function doSync(): Promise<void> {
    let settings: AppSettings;
    try {
        settings = await loadSettings();
    } catch {
        return;
    }

    if (!settings["notifications.enabled"]) return;
    if (
        !hasCurrentNotificationConsent(
            settings["notifications.consentAt"],
            settings["notifications.consentVersion"]
        )
    ) {
        return;
    }

    const support = getNotificationSupport();
    if (!support.supported || support.permission !== "granted") return;

    let config: RelayConfig;
    try {
        config = await fetchRelayConfig();
    } catch (error) {
        setStatus({lastError: safeErrorMessage(error)});
        return;
    }
    if (!config.configured || !config.vapidPublicKey) {
        setStatus({configured: false, lastError: null});
        return;
    }

    setStatus({syncing: true});
    try {
        // The boot trigger can fire before `ServiceWorkerRegister` has
        // finished installing the worker. That is not an error worth
        // surfacing; the next visibility/change trigger retries.
        if (!(await navigator.serviceWorker.getRegistration())) {
            setStatus({syncing: false});
            return;
        }
        const subscription = await ensurePushSubscription(config.vapidPublicKey);
        const body = await buildSyncBody(settings, config, subscription);
        const credentials = await getRelayCredentials();

        if (!credentials || credentials.endpoint !== subscription.endpoint) {
            await createRelaySubscription(body);
        } else {
            const result = await putRelaySubscription(credentials, body);
            if (result === "recreate") await createRelaySubscription(body);
        }

        setStatus({
            configured: true,
            subscriptionActive: true,
            syncing: false,
            lastSyncedAt: new Date().toISOString(),
            lastError: null,
        });
    } catch (error) {
        setStatus({
            syncing: false,
            lastError: safeErrorMessage(error),
        });
    }
}

let inFlight: Promise<void> | null = null;
let rerunRequested = false;
let debounceTimer: number | null = null;

/** Runs a sync immediately (coalesces with an in-flight request). */
export function syncNotificationsNow(): Promise<void> {
    if (typeof window === "undefined") return Promise.resolve();
    if (inFlight) {
        rerunRequested = true;
        return inFlight;
    }
    inFlight = doSync().finally(() => {
        inFlight = null;
        if (rerunRequested) {
            rerunRequested = false;
            void syncNotificationsNow();
        }
    });
    return inFlight;
}

/** Debounced trigger used by data mutations and lifecycle events. */
export function requestNotificationSync(options: { immediate?: boolean } = {}): void {
    if (typeof window === "undefined") return;
    if (options.immediate) {
        if (debounceTimer !== null) {
            window.clearTimeout(debounceTimer);
            debounceTimer = null;
        }
        void syncNotificationsNow();
        return;
    }
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        void syncNotificationsNow();
    }, SYNC_DEBOUNCE_MS);
}

async function unsubscribeBrowser(): Promise<void> {
    try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        await subscription?.unsubscribe();
    } catch {
        // Best-effort: a missing worker or denied permission is fine here.
    }
}

/**
 * Turns the relay off: best-effort DELETE, browser unsubscribe, and removal of
 * local credentials + the detailed-mode key (forward secrecy for future
 * reminders). Local on-device reminders keep working if the user left
 * `notifications.enabled` true.
 */
export async function disableNotificationRelay(): Promise<void> {
    const credentials = await getRelayCredentials();
    if (credentials) {
        try {
            await fetch(
                relayUrl(`/v1/subscriptions/${encodeURIComponent(credentials.subscriptionId)}`),
                {
                    method: "DELETE",
                    headers: {authorization: `Bearer ${credentials.token}`},
                    signal: timeoutSignal(),
                }
            );
        } catch {
            // Offline / relay down: local deletion still proceeds.
        }
    }
    await unsubscribeBrowser();
    await clearNotificationSecrets();
    setStatus({
        subscriptionActive: false,
        syncing: false,
        lastSyncedAt: null,
        lastError: null,
    });
}

/** Sends one generic test push through the relay. */
export async function sendRelayTestPush(): Promise<void> {
    const config = await fetchRelayConfig(true);
    if (!config.configured) {
        throw new Error("Background delivery is not configured on the relay.");
    }

    let credentials = await getRelayCredentials();
    if (!credentials) {
        await syncNotificationsNow();
        credentials = await getRelayCredentials();
    }
    if (!credentials) {
        throw new Error("This device is not connected to the relay yet.");
    }

    const send = async (current: RelayCredentials): Promise<Response> =>
        fetch(
            relayUrl(`/v1/subscriptions/${encodeURIComponent(current.subscriptionId)}/test`),
            {
                method: "POST",
                headers: {authorization: `Bearer ${current.token}`},
                signal: timeoutSignal(),
            }
        );

    let response = await send(credentials);
    if (response.status === 401 || response.status === 404) {
        await clearRelayCredentials();
        await syncNotificationsNow();
        credentials = await getRelayCredentials();
        if (!credentials) throw new Error("This device could not reconnect to the relay.");
        response = await send(credentials);
    }
    if (!response.ok) throw relayHttpError(response.status);
}
