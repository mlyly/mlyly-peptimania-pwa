/**
 * Smoke test for the Terms-of-Service acceptance record, runnable in Node via
 * tsx + fake-indexeddb (no browser needed):
 *
 *   npx tsx scripts/terms-smoke.ts
 *
 * Exercises: default "not accepted", the 30-day validity window, corrupt
 * values, persistence round-trips, and that "restore defaults" keeps the
 * acknowledgement (it lives in the settings store but is not a feature
 * setting).
 */
import "fake-indexeddb/auto";

import {db, ensureDatabase} from "../lib/db";
import {isTermsAccepted, needsTermsAcceptance} from "../lib/legal/terms";
import {getSetting, loadSettings, resetAllSettings, setSetting,} from "../lib/settings";

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
    await ensureDatabase();

    // 1. Fresh install: never accepted → gate shows.
    check("default: not accepted", (await getSetting("legal.termsAcceptedAt")) === null);
    check("gate needed when null", needsTermsAcceptance(null, true));
    check("gate hidden while loading", !needsTermsAcceptance(null, false));

    // 2. Validity window (pure logic, fixed clock).
    const now = Date.now();
    check("fresh acceptance honored", isTermsAccepted(new Date(now).toISOString(), now));
    check("29 days old still valid", isTermsAccepted(new Date(now - 29 * 864e5).toISOString(), now));
    check("31 days old expires", !isTermsAccepted(new Date(now - 31 * 864e5).toISOString(), now));
    check("garbage rejected", !isTermsAccepted("not-a-date", now));

    // 3. Persistence round-trip through the settings service.
    await setSetting("legal.termsAcceptedAt", new Date(now).toISOString());
    check(
        "persisted round-trip",
        (await getSetting("legal.termsAcceptedAt")) === new Date(now).toISOString()
    );

    // 4. Feature reset must not clear the acknowledgement.
    await setSetting("pk.chartUnit", "mg");
    await resetAllSettings();
    check("reset keeps terms record", (await getSetting("legal.termsAcceptedAt")) !== null);
    check("reset restores chart defaults", (await loadSettings())["pk.chartUnit"] === "mcg");

    // 5. Clearing the row brings the gate back.
    await db.settings.delete("legal.termsAcceptedAt");
    check("deleted row => gate again", (await getSetting("legal.termsAcceptedAt")) === null);

    console.log(failed ? "\nSmoke test FAILED" : "\nSmoke test passed");
    process.exit(failed ? 1 : 0);
}

void main();
