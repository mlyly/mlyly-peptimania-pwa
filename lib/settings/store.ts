/**
 * Client-side store for app settings (schema v8 `settings` table).
 *
 * All components share one in-memory snapshot (loaded lazily after
 * `ensureDatabase()`), so a control on the chart page and the settings page
 * always agree without prop drilling. Writes are optimistic: the snapshot
 * updates synchronously for the UI, persistence happens in the background
 * and a failed write re-syncs the snapshot from the database.
 */
"use client";

import * as React from "react";

import {ensureDatabase} from "@/lib/db";
import {type AppSettings, DEFAULT_SETTINGS,} from "./definitions";
import {loadSettings, resetAllSettings, setSetting} from "./service";

type Cache =
    | { status: "loading"; settings: AppSettings }
    | { status: "ready"; settings: AppSettings };

let cache: Cache = {status: "loading", settings: DEFAULT_SETTINGS};
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) listener();
}

/** Loads settings once per page load (safe to call from every consumer). */
export function ensureSettingsLoaded(): Promise<void> {
    if (cache.status === "ready") return Promise.resolve();
    inFlight ??= ensureDatabase()
        .then(loadSettings)
        .then((settings) => {
            cache = {status: "ready", settings};
            emit();
        })
        .catch(() => {
            // Keep defaults and allow a retry on the next mount.
            inFlight = null;
        });
    return inFlight;
}

/** Optimistically applies a setting, then persists it. */
async function applySetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
    const next: AppSettings = {...cache.settings, [key]: value};
    cache = {status: "ready", settings: next};
    emit();
    try {
        await setSetting(key, value);
    } catch {
        // Storage failed (quota, private mode): re-sync from the database so
        // the UI reflects what is actually persisted.
        inFlight = null;
        await ensureSettingsLoaded();
    }
}

/** Restores every toggleable feature to its default (rows deleted). */
async function applyReset(): Promise<void> {
    try {
        await resetAllSettings();
        // Restoring defaults turns notifications off; also remove the relay
        // subscription so background pushes actually stop (best-effort).
        await import("@/lib/notifications/relay")
            .then(({disableNotificationRelay}) => disableNotificationRelay())
            .catch(() => undefined);
        cache = {status: "ready", settings: DEFAULT_SETTINGS};
        emit();
    } catch {
        inFlight = null;
        await ensureSettingsLoaded();
    }
}

/**
 * Drops the cached snapshot (e.g. after an import replaced the database) and
 * re-reads from storage, notifying all mounted consumers.
 */
export async function invalidateSettings(): Promise<void> {
    cache = {status: "loading", settings: DEFAULT_SETTINGS};
    emit();
    inFlight = null;
    await ensureSettingsLoaded();
}

export interface AppSettingsState {
    settings: AppSettings;
    /** True once the snapshot reflects the database (not just defaults). */
    loaded: boolean;
    /** Updates one setting and persists it in the background. */
    setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
    /** Restores all feature settings to their defaults. */
    resetSettings: () => Promise<void>;
}

export function useAppSettings(): AppSettingsState {
    const settings = React.useSyncExternalStore(
        (onStoreChange) => {
            listeners.add(onStoreChange);
            return () => listeners.delete(onStoreChange);
        },
        () => cache.settings,
        () => DEFAULT_SETTINGS
    );
    const loaded = cache.status === "ready";

    React.useEffect(() => {
        void ensureSettingsLoaded();
    }, []);

    return React.useMemo(
        () => ({
            settings,
            loaded,
            setSetting: applySetting,
            resetSettings: applyReset,
        }),
        // `loaded` is a module-level flag read during render; both inputs
        // change together on every emit, but list them honestly.
        [settings, loaded]
    );
}
