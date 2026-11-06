/**
 * Small derived helpers shared by the scheduling and dose log modules.
 * Pure functions (no DB access) so the UI and smoke tests can reason about
 * them deterministically.
 */
import type {DoseLog, Medication, Schedule} from "@/lib/db/types";

/**
 * Dose amount to prefill a "log a dose" dialog for a medication: the dose of
 * its first active schedule, when that schedule uses the medication's own
 * unit (so the number is directly reusable); otherwise 1.
 */
export function prefilledDoseAmount(
    medication: Medication | null | undefined,
    schedules: readonly Schedule[]
): number {
    if (!medication) return 1;
    const schedule = schedules.find((s) => s.medicationId === medication.id && s.active);
    return schedule && schedule.unit === medication.unit ? schedule.doseAmount : 1;
}

/** Rolling window for "recently used" injection-site highlighting (days). */
export const RECENT_INJECTION_SITE_DAYS = 7;

/**
 * Distinct injection sites recorded in the rolling week leading up to `now`.
 * The body-map dialog paints matching regions red so users can rotate sites.
 * Logs without a site, outside the window, or with an unparseable timestamp
 * are ignored.
 */
export function recentInjectionSites(
    logs: readonly DoseLog[],
    now: Date = new Date()
): string[] {
    const cutoff = now.getTime() - RECENT_INJECTION_SITE_DAYS * 24 * 60 * 60 * 1000;
    const seen = new Set<string>();
    const sites: string[] = [];
    for (const log of logs) {
        const site = log.injectionSite?.trim();
        if (!site) continue;
        const takenAt = Date.parse(log.timestamp);
        if (!Number.isFinite(takenAt) || takenAt < cutoff) continue;
        const key = site.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        sites.push(site);
    }
    return sites;
}
