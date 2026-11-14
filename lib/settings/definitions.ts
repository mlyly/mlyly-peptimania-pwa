/**
 * Registry of toggleable application features backed by the `settings` table
 * (schema v8). Each known key declares its default and a parser that turns a
 * stored value into the typed setting — anything invalid or unrecognized
 * falls back to the default, so a corrupt or future-shaped row can never
 * break the UI.
 *
 * Adding a new toggleable feature = add a key here, then read it through
 * `useAppSettings()` at the call site.
 */
import {
    CHART_RANGES,
    type ChartRangeId,
    CONCENTRATION_UNITS,
    type ConcentrationDisplayUnit,
} from "@/lib/pharmacokinetics/charting";

export type SettingKey =
    | "pk.chartRange"
    | "pk.chartUnit"
    | "pk.hiddenMedicationIds"
    | "legal.termsAcceptedAt"
    | "paging.pageSize"
    | "notifications.enabled"
    | "notifications.consentAt"
    | "notifications.consentVersion"
    | "notifications.detailLevel"
    | "notifications.leadMinutes"
    | "notifications.overrides";

/** Selectable page sizes for paged lists; `"all"` disables pagination. */
export type PageSize = 10 | 20 | 50 | 100 | "all";

export const PAGE_SIZES: readonly PageSize[] = [10, 20, 50, 100, "all"];

/** Lists that expose pagination; each id gets its own stored page size. */
export type PagedTableId = "doseLogs" | "measurements";

const PAGED_TABLE_IDS: readonly string[] = ["doseLogs", "measurements"];

/**
 * How much reminder content a future push relay may carry:
 *  - `generic`: only "A dose is due" — no medication names or doses.
 *  - `detailed`: medication name, dose and time, end-to-end encrypted so the
 *    relay cannot read it (see `docs/notifications-plan.md`).
 */
export type NotificationDetailLevel = "generic" | "detailed";

export const NOTIFICATION_DETAIL_LEVELS: readonly NotificationDetailLevel[] = [
    "generic",
    "detailed",
];

/** Minutes before the scheduled time a reminder should fire. */
export const NOTIFICATION_LEAD_MINUTES = [0, 5, 10, 15, 30, 60] as const;
export type NotificationLeadMinutes = (typeof NOTIFICATION_LEAD_MINUTES)[number];

/**
 * Per-occurrence notification override from the notification centre.
 *
 * - `snoozeUntil`: ISO instant at which the reminder should fire instead of
 *   the normal lead-time instant.
 * - `skippedAt`: ISO timestamp of an explicit "skip this occurrence" action;
 *   the occurrence is left out of the relay horizon.
 *
 * Keys are occurrence keys (`scheduleId@YYYY-MM-DD`). Only upcoming/recent
 * entries matter, so stale keys are harmless and can be pruned freely.
 */
export interface NotificationOverride {
    snoozeUntil?: string;
    skippedAt?: string;
}

export type NotificationOverrides = Record<string, NotificationOverride>;

const MAX_NOTIFICATION_OVERRIDES = 500;

function parseIsoTimestamp(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

export function pageSizeLabel(size: PageSize): string {
    return size === "all" ? "All" : `${size} / page`;
}

/** Typed view of every known setting, merged with its default. */
export interface AppSettings {
    "pk.chartRange": ChartRangeId;
    "pk.chartUnit": ConcentrationDisplayUnit;
    /** Medication ids hidden on the concentration chart (all shown by default). */
    "pk.hiddenMedicationIds": string[];
    /**
     * ISO timestamp of the last time the user accepted the Terms of Service
     * and Legal Disclaimer (see `public/TERMS.md`). `null` means never
     * accepted — the startup gate re-appears. Read via `lib/legal/terms.ts`.
     */
    "legal.termsAcceptedAt": string | null;
    /**
     * Page size per paged list, keyed by `PagedTableId`. A missing entry
     * means the list uses its own default page size.
     */
    "paging.pageSize": Partial<Record<PagedTableId, PageSize>>;
    /**
     * Whether dose reminders are enabled on this device. This only becomes
     * true after the user explicitly accepts the notification disclosure
     * (see `notifications.consentAt`).
     */
    "notifications.enabled": boolean;
    /**
     * ISO timestamp of the user's consent to the notification data-sharing
     * disclosure. `null` means never consented — the settings card requires
     * the opt-in checkbox again before notifications can be enabled.
     */
    "notifications.consentAt": string | null;
    /**
     * Version of the notification disclosure the user accepted. A newer
     * `NOTIFICATIONS_CONSENT_VERSION` invalidates older consents.
     */
    "notifications.consentVersion": string | null;
    /** Content level requested for background push payloads. */
    "notifications.detailLevel": NotificationDetailLevel;
    /** How many minutes before the scheduled time a reminder fires. */
    "notifications.leadMinutes": NotificationLeadMinutes;
    /** Snooze/skip actions from the notification centre, by occurrence key. */
    "notifications.overrides": NotificationOverrides;
}

const CHART_RANGE_IDS: readonly string[] = CHART_RANGES.map((range) => range.id);

/** Typed defaults used when a setting row is missing or unparseable. */
export const DEFAULT_SETTINGS: AppSettings = {
    "pk.chartRange": "week",
    "pk.chartUnit": "mcg",
    "pk.hiddenMedicationIds": [],
    "legal.termsAcceptedAt": null,
    "paging.pageSize": {},
    "notifications.enabled": false,
    "notifications.consentAt": null,
    "notifications.consentVersion": null,
    "notifications.detailLevel": "generic",
    "notifications.leadMinutes": 0,
    "notifications.overrides": {},
};

interface SettingDefinition<K extends SettingKey = SettingKey> {
    key: K;
    description: string;
    /** Converts a raw stored value to the typed setting (never throws). */
    parse: (raw: unknown) => AppSettings[K];
}

const definitions: { [K in SettingKey]: SettingDefinition<K> } = {
    "pk.chartRange": {
        key: "pk.chartRange",
        description: "Time range preset shown on the concentration chart",
        parse: (raw) =>
            typeof raw === "string" && CHART_RANGE_IDS.includes(raw)
                ? (raw as ChartRangeId)
                : DEFAULT_SETTINGS["pk.chartRange"],
    },
    "pk.chartUnit": {
        key: "pk.chartUnit",
        description: "Concentration display unit for the chart (mcg/mg/IU)",
        parse: (raw) =>
            typeof raw === "string" && (CONCENTRATION_UNITS as readonly string[]).includes(raw)
                ? (raw as ConcentrationDisplayUnit)
                : DEFAULT_SETTINGS["pk.chartUnit"],
    },
    "pk.hiddenMedicationIds": {
        key: "pk.hiddenMedicationIds",
        description: "Medications toggled off on the concentration chart",
        parse: (raw) =>
            Array.isArray(raw)
                ? raw.filter((id): id is string => typeof id === "string")
                : DEFAULT_SETTINGS["pk.hiddenMedicationIds"],
    },
    "legal.termsAcceptedAt": {
        key: "legal.termsAcceptedAt",
        description: "ISO timestamp of the last Terms & Legal Disclaimer acceptance",
        parse: (raw) => {
            if (typeof raw !== "string") return null;
            const time = Date.parse(raw);
            return Number.isFinite(time) ? new Date(time).toISOString() : null;
        },
    },
    "paging.pageSize": {
        key: "paging.pageSize",
        description: "Page size chosen per paged list (10/20/50/100/all)",
        parse: (raw) => {
            const result: Partial<Record<PagedTableId, PageSize>> = {};
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
            for (const [tableId, value] of Object.entries(raw)) {
                if (!PAGED_TABLE_IDS.includes(tableId)) continue; // unknown list — ignore
                const size: PageSize | undefined =
                    value === "all"
                        ? "all"
                        : typeof value === "number" &&
                        (PAGE_SIZES as readonly number[]).includes(value)
                            ? (value as PageSize)
                            : undefined;
                if (size !== undefined) result[tableId as PagedTableId] = size;
            }
            return result;
        },
    },
    "notifications.enabled": {
        key: "notifications.enabled",
        description: "Dose reminders enabled on this device (after explicit consent)",
        parse: (raw) =>
            typeof raw === "boolean"
                ? raw
                : DEFAULT_SETTINGS["notifications.enabled"],
    },
    "notifications.consentAt": {
        key: "notifications.consentAt",
        description: "ISO timestamp of the notification data-sharing consent",
        parse: (raw) => {
            if (typeof raw !== "string") return null;
            const time = Date.parse(raw);
            return Number.isFinite(time) ? new Date(time).toISOString() : null;
        },
    },
    "notifications.consentVersion": {
        key: "notifications.consentVersion",
        description: "Version of the notification disclosure the user accepted",
        parse: (raw) =>
            typeof raw === "string" && raw.trim() !== ""
                ? raw.trim()
                : DEFAULT_SETTINGS["notifications.consentVersion"],
    },
    "notifications.detailLevel": {
        key: "notifications.detailLevel",
        description: "Reminder content level for background push (generic/detailed)",
        parse: (raw) =>
            typeof raw === "string" &&
            (NOTIFICATION_DETAIL_LEVELS as readonly string[]).includes(raw)
                ? (raw as NotificationDetailLevel)
                : DEFAULT_SETTINGS["notifications.detailLevel"],
    },
    "notifications.leadMinutes": {
        key: "notifications.leadMinutes",
        description: "Minutes before a scheduled dose that a reminder fires",
        parse: (raw) =>
            typeof raw === "number" &&
            (NOTIFICATION_LEAD_MINUTES as readonly number[]).includes(raw)
                ? (raw as NotificationLeadMinutes)
                : DEFAULT_SETTINGS["notifications.leadMinutes"],
    },
    "notifications.overrides": {
        key: "notifications.overrides",
        description: "Per-occurrence snooze/skip actions from the notification centre",
        parse: (raw) => {
            const result: NotificationOverrides = {};
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
            let count = 0;
            for (const [key, value] of Object.entries(raw)) {
                if (count >= MAX_NOTIFICATION_OVERRIDES) break;
                if (typeof key !== "string" || key.length === 0 || key.length > 300) continue;
                if (!value || typeof value !== "object" || Array.isArray(value)) continue;
                const record = value as Record<string, unknown>;
                const snoozeUntil = parseIsoTimestamp(record.snoozeUntil);
                const skippedAt = parseIsoTimestamp(record.skippedAt);
                if (!snoozeUntil && !skippedAt) continue;
                result[key] = {
                    ...(snoozeUntil ? {snoozeUntil} : {}),
                    ...(skippedAt ? {skippedAt} : {}),
                };
                count += 1;
            }
            return result;
        },
    },
};

export const SETTING_KEYS = Object.keys(definitions) as SettingKey[];

export function settingDefinition<K extends SettingKey>(key: K): SettingDefinition<K> {
    return definitions[key];
}

export function settingDefault<K extends SettingKey>(key: K): AppSettings[K] {
    return DEFAULT_SETTINGS[key];
}

/** Parses a raw row value into the full typed settings map (defaults applied). */
export function normalizeSettings(rows: ReadonlyArray<{ key: string; value: unknown }>): AppSettings {
    const merged: AppSettings = {...DEFAULT_SETTINGS};
    for (const row of rows) {
        const definition = (definitions as Record<string, SettingDefinition>)[row.key];
        if (!definition) continue; // unknown key — ignore (forward compatible)
        Object.assign(merged, {[definition.key]: definition.parse(row.value)});
    }
    return merged;
}
