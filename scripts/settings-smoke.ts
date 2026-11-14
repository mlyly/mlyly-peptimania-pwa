/**
 * Smoke test for the app configuration layer (schema v8 `settings` store),
 * runnable in Node via tsx + fake-indexeddb (no browser needed):
 *
 *   npx tsx scripts/settings-smoke.ts
 *
 * Exercises: migration to v8, typed reads with default fallback, corrupt /
 * unknown-row tolerance, persistence round-trips and export/import of
 * settings entries (including pre-v8 payloads without a settings key).
 */
import "fake-indexeddb/auto";

import {
    buildExportPayload,
    canonicalChecksum,
    db,
    ensureDatabase,
    LATEST_SCHEMA_VERSION,
    validateExportPayload,
    writeImportedPayload,
} from "../lib/db";
import {DEFAULT_SETTINGS, getSetting, loadSettings, resetAllSettings, setSetting, SETTING_KEYS,} from "../lib/settings";

let failed = false;

function check(label: string, condition: boolean) {
    if (condition) {
        console.log(`✓ ${label}`);
    } else {
        console.error(`✗ ${label}`);
        failed = true;
    }
}

async function main() {
    const result = await ensureDatabase();
    check(`migrated to v${LATEST_SCHEMA_VERSION}`, result.to === LATEST_SCHEMA_VERSION);
    check("settings store exists", (await db.settings.count()) === 0);

    // 1. Absent rows read as defaults.
    check("default range", (await getSetting("pk.chartRange")) === DEFAULT_SETTINGS["pk.chartRange"]);

    // 2. Round-trip a typed value.
    await setSetting("pk.chartRange", "month");
    check("range persists", (await getSetting("pk.chartRange")) === "month");
    await setSetting("pk.chartUnit", "mg");
    await setSetting("pk.hiddenMedicationIds", ["med-1", "med-2"]);
    const all = await loadSettings();
    check(
        "all settings load",
        all["pk.chartRange"] === "month" &&
        all["pk.chartUnit"] === "mg" &&
        all["pk.hiddenMedicationIds"].join(",") === "med-1,med-2"
    );

    // 3. Corrupt stored values fall back to defaults; unknown keys are ignored.
    await db.settings.put({key: "pk.chartRange", value: "not-a-range"});
    await db.settings.put({key: "pk.hiddenMedicationIds", value: [1, "med-9", null]});
    await db.settings.put({key: "some.future.key", value: {nested: true}});
    const sanitized = await loadSettings();
    check(
        "invalid value falls back to default",
        sanitized["pk.chartRange"] === DEFAULT_SETTINGS["pk.chartRange"]
    );
    check("junk array entries dropped", sanitized["pk.hiddenMedicationIds"].join(",") === "med-9");
    check(
        "unknown key ignored",
        !("some.future.key" in sanitized) && Object.keys(sanitized).length === SETTING_KEYS.length
    );

    // 4. Export includes settings rows; wipe + reimport restores them.
    await setSetting("pk.chartRange", "2months");
    const payload = await buildExportPayload();
    check(
        "export carries settings",
        Array.isArray(payload.data.settings) &&
        payload.data.settings.some((row) => (row as { key: string }).key === "pk.chartRange")
    );
    await db.settings.clear();
    const validated = await validateExportPayload(JSON.stringify(payload));
    await writeImportedPayload(validated, "replace");
    check("reimport restores settings", (await getSetting("pk.chartRange")) === "2months");

    // 5. Pre-v8 payload (no `settings` key) validates, migrates and imports.
    const legacyData = {
        schemaVersion: 7,
        medications: [],
        schedules: [],
        doseLogs: [],
        measurementTypes: [],
        measurementLogs: [],
    };
    const legacyPayload = {
        app: "peptimania-pwa",
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        data: legacyData,
        checksum: await canonicalChecksum(legacyData),
    };
    const legacyValidated = await validateExportPayload(JSON.stringify(legacyPayload));
    check("legacy payload promoted to v8", legacyValidated.data.schemaVersion === LATEST_SCHEMA_VERSION);
    await writeImportedPayload(legacyValidated, "replace");
    check("legacy import leaves defaults", (await db.settings.count()) === 0);

    // 6. Reset deletes the entries (not writes junk defaults back).
    await setSetting("pk.chartUnit", "IU");
    await resetAllSettings();
    check("reset removes rows", (await db.settings.count()) === 0);
    check(
        "reset restores default value",
        (await getSetting("pk.chartUnit")) === DEFAULT_SETTINGS["pk.chartUnit"]
    );

    // 7. Notifications are off by default; reset turns reminders off but keeps
    // the versioned consent acknowledgement (it is not a UI preference).
    check(
        "notifications default off",
        (await getSetting("notifications.enabled")) === false
    );
    check(
        "notification consent default absent",
        (await getSetting("notifications.consentAt")) === null
    );
    await setSetting("notifications.enabled", true);
    await setSetting("notifications.consentAt", "2026-11-14T10:00:00.000Z");
    await setSetting("notifications.consentVersion", "2026-11-14");
    await setSetting("notifications.leadMinutes", 15);
    await setSetting("notifications.detailLevel", "detailed");
    await resetAllSettings();
    check(
        "reset disables notifications",
        (await getSetting("notifications.enabled")) === false
    );
    check(
        "reset preserves consent",
        (await getSetting("notifications.consentAt")) === "2026-11-14T10:00:00.000Z" &&
        (await getSetting("notifications.consentVersion")) === "2026-11-14"
    );
    check(
        "reset restores notification preferences",
        (await getSetting("notifications.leadMinutes")) === 0 &&
        (await getSetting("notifications.detailLevel")) === "generic"
    );

    // 8. Invalid notification values fall back to defaults without throwing.
    await db.settings.put({key: "notifications.leadMinutes", value: 7});
    await db.settings.put({key: "notifications.detailLevel", value: "verbose"});
    const notificationDefaults = await loadSettings();
    check(
        "invalid notification values fall back",
        notificationDefaults["notifications.leadMinutes"] === 0 &&
        notificationDefaults["notifications.detailLevel"] === "generic"
    );

    if (failed) {
        console.error("\nSmoke test FAILED");
        process.exit(1);
    }
    console.log("\nSmoke test passed");
    process.exit(0);
}

main().catch((error) => {
    console.error("Smoke test crashed:", error);
    process.exit(1);
});
