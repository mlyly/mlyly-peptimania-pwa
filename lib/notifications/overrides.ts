import {addDays, dateOnlyIso} from "@/lib/scheduling/dates";
import type {NotificationOverrides} from "@/lib/settings/definitions";

/** The notification centre only lists occurrences from the last two days. */
const RETENTION_DAYS = 3;

/**
 * Drops snooze/skip records for occurrences that can no longer be shown.
 * Keys are `scheduleId@YYYY-MM-DD`, so the day is the suffix after the last `@`.
 */
export function pruneOverrides(overrides: NotificationOverrides, now: Date): NotificationOverrides {
    const cutoff = dateOnlyIso(addDays(now, -RETENTION_DAYS));
    const result: NotificationOverrides = {};
    for (const [key, override] of Object.entries(overrides)) {
        const day = key.slice(key.lastIndexOf("@") + 1);
        if (day >= cutoff) result[key] = override;
    }
    return result;
}
