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

export type SettingKey = "pk.chartRange" | "pk.chartUnit" | "pk.hiddenMedicationIds";

/** Typed view of every known setting, merged with its default. */
export interface AppSettings {
    "pk.chartRange": ChartRangeId;
    "pk.chartUnit": ConcentrationDisplayUnit;
    /** Medication ids hidden on the concentration chart (all shown by default). */
    "pk.hiddenMedicationIds": string[];
}

const CHART_RANGE_IDS: readonly string[] = CHART_RANGES.map((range) => range.id);

/** Typed defaults used when a setting row is missing or unparseable. */
export const DEFAULT_SETTINGS: AppSettings = {
    "pk.chartRange": "week",
    "pk.chartUnit": "mcg",
    "pk.hiddenMedicationIds": [],
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
