"use client";

/**
 * Compact dashboard banner for due/overdue doses. Only appears after the user
 * has opted into reminders, and links to the notification centre where each
 * occurrence can be logged, snoozed or skipped.
 */
import Link from "next/link";
import {ArrowRight, BellRing, TriangleAlert} from "lucide-react";

import {useTrackerData} from "@/components/scheduling/use-tracker-data";
import {hasCurrentNotificationConsent} from "@/lib/notifications";
import {dayOccurrences} from "@/lib/scheduling/occurrences";
import {useAppSettings} from "@/lib/settings";
import {cn} from "@/lib/utils";

export function NotificationDueBanner() {
    const {phase, data} = useTrackerData();
    const {settings, loaded} = useAppSettings();

    if (!loaded || phase.phase !== "ready") return null;

    const consentCurrent = hasCurrentNotificationConsent(
        settings["notifications.consentAt"],
        settings["notifications.consentVersion"]
    );
    if (!settings["notifications.enabled"] || !consentCurrent) return null;

    const today = dayOccurrences(data.schedules, data.doseLogs, new Date(), new Date());
    const overdue = today.filter((occurrence) => occurrence.status === "overdue").length;
    const due = today.filter((occurrence) => occurrence.status === "due").length;
    if (overdue === 0 && due === 0) return null;

    const tone = overdue > 0
        ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
        : "border-sky-500/40 bg-sky-500/10 text-sky-900 dark:text-sky-200";

    const parts: string[] = [];
    if (overdue > 0) parts.push(`${overdue} overdue`);
    if (due > 0) parts.push(`${due} due now`);

    return (
        <Link
            href="/notifications"
            className={cn(
                "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors hover:brightness-105",
                tone
            )}
        >
            {overdue > 0 ? (
                <TriangleAlert className="size-4 shrink-0" aria-hidden/>
            ) : (
                <BellRing className="size-4 shrink-0" aria-hidden/>
            )}
            <span className="min-w-0 flex-1">
                <span className="font-medium">{parts.join(" · ")}</span>
                <span className="block text-xs opacity-80">
                    Open Reminders to log, snooze for 15 minutes or skip today’s dose.
                </span>
            </span>
            <ArrowRight className="size-4 shrink-0" aria-hidden/>
        </Link>
    );
}
