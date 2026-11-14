/**
 * CRUD for the `settings` table (schema v8). One `{key, value}` row per known
 * configuration entry; a missing row means "use the default", so reads always
 * return a full typed map and writes only touch the changed key.
 *
 * The caller is responsible for having run `ensureDatabase()` first (the
 * store in `store.ts` does that itself for UI consumers).
 */
import {type AppSetting, db} from "@/lib/db";
import {type AppSettings, normalizeSettings, SETTING_KEYS, settingDefinition, type SettingKey,} from "./definitions";

/** Reads every recognized settings row from the database. */
export async function loadSettings(): Promise<AppSettings> {
    const rows = await db.settings
        .where("key")
        .anyOf(SETTING_KEYS)
        .toArray();
    return normalizeSettings(rows);
}

/** Reads one setting (typed), falling back to its default. */
export async function getSetting<K extends SettingKey>(key: K): Promise<AppSettings[K]> {
    const row = await db.settings.get(key);
    return settingDefinition(key).parse(row?.value);
}

/** Persists one setting entry. Only recognized keys are written. */
export async function setSetting<K extends SettingKey>(key: K, value: AppSettings[K]): Promise<void> {
    // Validate through the definition's parser so the stored row is always
    // in canonical shape (e.g. hides an id list without non-strings).
    const canonical = settingDefinition(key).parse(value);
    const row: AppSetting = {key, value: canonical};
    await db.settings.put(row);
}

/** Removes one setting entry (next read falls back to the default). */
export async function clearSetting(key: SettingKey): Promise<void> {
    await db.settings.delete(key);
}

/**
 * Removes every toggleable *feature* setting entry, restoring app defaults.
 * `legal.*` and notification-consent entries are deliberately not reset —
 * they are acknowledgements, not UI preferences. (Resetting
 * `notifications.enabled` to false does turn reminders off; the recorded
 * consent remains valid until the disclosure version changes.)
 */
export async function resetAllSettings(): Promise<void> {
    const featureKeys = SETTING_KEYS.filter(
        (key) =>
            !key.startsWith("legal.") &&
            key !== "notifications.consentAt" &&
            key !== "notifications.consentVersion"
    );
    await db.settings.bulkDelete(featureKeys);
}
