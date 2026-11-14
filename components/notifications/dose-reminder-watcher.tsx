"use client";

/**
 * On-device reminder display (phase 0 of the notifications plan).
 *
 * While the app is open this watcher checks the local schedule every 30 s and
 * surfaces a reminder for any occurrence that is due (or within the user's
 * lead window) and not yet logged. Visible tabs get an in-app toast; hidden
 * tabs ask the service worker to show a system notification.
 *
 * This path never contacts a server. Background push while the app is closed
 * requires the relay described in `docs/notifications-plan.md`.
 */
import * as React from "react";

import {ensureDatabase} from "@/lib/db";
import {listMedications} from "@/lib/medications/service";
import {hasCurrentNotificationConsent} from "@/lib/notifications";
import {useAppSettings} from "@/lib/settings";
import {rangeAgenda} from "@/lib/scheduling/occurrences";
import {addDays, formatClockTime} from "@/lib/scheduling/dates";
import {listDoseLogs, listSchedules} from "@/lib/scheduling/service";
import {toast} from "@/lib/toast";

const CHECK_INTERVAL_MS = 30_000;
const SENT_STORAGE_KEY = "peptimania.notifications.sent";
/** How long a shown reminder stays in the dedupe map. */
const SENT_TTL_MS = 48 * 60 * 60 * 1000;
/** Remind for doses that became due up to this long ago (app was closed). */
const LATE_WINDOW_MS = 15 * 60 * 1000;
/** Cap a single tick so a long absence doesn't flood the user. */
const MAX_PER_TICK = 3;

type SentMap = Record<string, number>;

function readSentMap(now: number): SentMap {
    try {
        const raw = window.localStorage.getItem(SENT_STORAGE_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const result: SentMap = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === "number" && now - value < SENT_TTL_MS) {
                result[key] = value;
            }
        }
        return result;
    } catch {
        return {};
    }
}

function writeSentMap(map: SentMap): void {
    try {
        window.localStorage.setItem(SENT_STORAGE_KEY, JSON.stringify(map));
    } catch {
        // Private mode / quota: duplicate reminders are better than a crash.
    }
}

async function showSystemNotification(
    title: string,
    body: string,
    tag: string
): Promise<void> {
    if (!("Notification" in window) || window.Notification.permission !== "granted") return;
    try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration?.active) return;
        await registration.showNotification(title, {
            body,
            tag,
            icon: "/icons/icon-192.png",
            badge: "/icons/icon-192.png",
            // The service worker's notificationclick handler opens this URL.
            data: {url: "/"},
        });
    } catch {
        // No active worker (e.g. dev server) — the tab may still be visible;
        // the next tick will retry without disrupting the app.
    }
}

export function DoseReminderWatcher() {
    const {settings, loaded} = useAppSettings();
    const consentCurrent = hasCurrentNotificationConsent(
        settings["notifications.consentAt"],
        settings["notifications.consentVersion"]
    );
    // Reminders pause if consent is missing/outdated (e.g. after a disclosure
    // version bump or a hand-edited import), even if `enabled` is still true.
    const enabled = loaded && settings["notifications.enabled"] && consentCurrent;
    const leadMinutes = settings["notifications.leadMinutes"];

    React.useEffect(() => {
        if (!enabled) return;

        let cancelled = false;
        let running = false;

        const tick = async () => {
            if (running || cancelled) return;
            running = true;
            try {
                const now = new Date();
                await ensureDatabase();
                const [medications, schedules, doseLogs] = await Promise.all([
                    listMedications(),
                    listSchedules(),
                    listDoseLogs(),
                ]);
                if (cancelled) return;

                const medicationNames = new Map(
                    medications.map((medication) => [medication.id, medication.name])
                );
                const agenda = rangeAgenda(
                    schedules,
                    doseLogs,
                    addDays(now, -1),
                    addDays(now, 1),
                    now
                );
                const leadMs = leadMinutes * 60_000;
                const sent = readSentMap(now.getTime());
                let changed = false;

                const due = agenda
                    .filter((occurrence) => {
                        if (occurrence.status === "done") return false;
                        const at = occurrence.scheduledAt.getTime();
                        return at - leadMs <= now.getTime() && at >= now.getTime() - LATE_WINDOW_MS;
                    })
                    .slice(0, MAX_PER_TICK);

                for (const occurrence of due) {
                    if (sent[occurrence.key]) continue;
                    sent[occurrence.key] = now.getTime();
                    changed = true;

                    const medicationName = medicationNames.get(occurrence.medicationId);
                    const dose = `${occurrence.doseAmount} ${occurrence.unit}`;
                    const title = medicationName ? `${medicationName} dose due` : "Dose due";
                    const body = `${medicationName ? `${dose} · ` : ""}scheduled for ${formatClockTime(
                        occurrence.scheduledAt
                    )}.`;

                    if (document.visibilityState === "visible") {
                        toast(title, {description: body, duration: 10_000});
                    } else {
                        await showSystemNotification(title, body, `dose-${occurrence.key}`);
                    }
                }

                if (changed) writeSentMap(sent);
            } catch {
                // Reminders are best-effort; never surface storage errors here.
            } finally {
                running = false;
            }
        };

        void tick();
        const interval = window.setInterval(() => void tick(), CHECK_INTERVAL_MS);
        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") void tick();
        };
        document.addEventListener("visibilitychange", onVisibilityChange);

        return () => {
            cancelled = true;
            window.clearInterval(interval);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [enabled, leadMinutes]);

    return null;
}
