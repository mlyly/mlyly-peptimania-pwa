"use client";

/**
 * In-app notification centre (phase 2).
 *
 * Everything here is local: due/upcoming occurrences come from the same
 * occurrence engine as the dashboard, and actions write to IndexedDB. The only
 * network effect is refreshing the relay's future-reminder horizon after a
 * log/snooze/skip (and only when background delivery is enabled).
 */
import * as React from "react";
import {useSearchParams} from "next/navigation";
import {BellOff, BellRing, Check, Clock3, RefreshCw, RotateCcw, SkipForward, TriangleAlert,} from "lucide-react";

import {InjectionSiteDialog} from "@/components/dose-logs/injection-site-dialog";
import {DoseReadout} from "@/components/medications/dose-readout";
import {useTrackerData} from "@/components/scheduling/use-tracker-data";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Skeleton} from "@/components/ui/skeleton";
import type {Medication, Schedule} from "@/lib/db/types";
import {isInjectableMedicationType} from "@/lib/medications/constants";
import {hasCurrentNotificationConsent} from "@/lib/notifications";
import {requestNotificationSync, useRelayStatus} from "@/lib/notifications/relay";
import {addDays, formatClockTime, formatRelativeDay} from "@/lib/scheduling/dates";
import {recentInjectionSites} from "@/lib/scheduling/derived";
import {type Occurrence, rangeAgenda} from "@/lib/scheduling/occurrences";
import {logDose} from "@/lib/scheduling/service";
import {useAppSettings} from "@/lib/settings";
import {toast} from "@/lib/toast";
import {cn} from "@/lib/utils";

type Status = "upcoming" | "due" | "overdue" | "done";
type AgendaItem = Occurrence & { status: Status };

interface CentreItem {
    occurrence: AgendaItem;
    medication: Medication | null;
    schedule: Schedule | null;
}

function useNow(): Date {
    const [now, setNow] = React.useState(() => new Date());
    React.useEffect(() => {
        const timer = window.setInterval(() => setNow(new Date()), 30_000);
        return () => window.clearInterval(timer);
    }, []);
    return now;
}

function statusLabel(status: Status): string {
    switch (status) {
        case "due":
            return "Due now";
        case "overdue":
            return "Overdue";
        case "done":
            return "Logged";
        default:
            return "Upcoming";
    }
}

function statusTone(status: Status): string {
    switch (status) {
        case "due":
            return "text-sky-600 dark:text-sky-400";
        case "overdue":
            return "text-amber-600 dark:text-amber-400";
        case "done":
            return "text-emerald-600 dark:text-emerald-400";
        default:
            return "text-muted-foreground";
    }
}

export function NotificationCentre() {
    const {phase, data, reloading, reload} = useTrackerData();
    const {settings, loaded, setSetting} = useAppSettings();
    const relay = useRelayStatus();
    const now = useNow();
    const searchParams = useSearchParams();
    const focus = searchParams.get("focus");
    const [busyKey, setBusyKey] = React.useState<string | null>(null);
    const [siteItem, setSiteItem] = React.useState<CentreItem | null>(null);
    const focusRef = React.useRef<HTMLLIElement | null>(null);

    const medications = React.useMemo(
        () => new Map(data.medications.map((medication) => [medication.id, medication])),
        [data.medications]
    );
    const schedules = React.useMemo(
        () => new Map(data.schedules.map((schedule) => [schedule.id, schedule])),
        [data.schedules]
    );
    const overrides = settings["notifications.overrides"];
    const recentSites = React.useMemo(
        () => recentInjectionSites(data.doseLogs, now),
        [data.doseLogs, now]
    );

    const agenda = React.useMemo(() => {
        const occurrences = rangeAgenda(
            data.schedules,
            data.doseLogs,
            addDays(now, -2),
            addDays(now, 7),
            now
        );
        return occurrences.map<CentreItem>((occurrence) => ({
            occurrence,
            medication: medications.get(occurrence.medicationId) ?? null,
            schedule: schedules.get(occurrence.scheduleId) ?? null,
        }));
    }, [data.schedules, data.doseLogs, medications, schedules, now]);

    const attention = agenda.filter(
        (item) => item.occurrence.status === "due" || item.occurrence.status === "overdue"
    );
    const upcoming = agenda.filter((item) => item.occurrence.status === "upcoming");
    const recent = agenda
        .filter(
            (item) =>
                item.occurrence.status === "done" &&
                item.occurrence.scheduledAt.getTime() > now.getTime() - 24 * 60 * 60 * 1000
        )
        .reverse();

    React.useEffect(() => {
        if (!focus || !focusRef.current) return;
        focusRef.current.scrollIntoView({block: "center", behavior: "smooth"});
    }, [focus, agenda.length]);

    const setOverride = React.useCallback(
        async (key: string, value: { snoozeUntil?: string; skippedAt?: string } | null) => {
            const next = {...overrides};
            if (value) next[key] = value;
            else delete next[key];
            await setSetting("notifications.overrides", next);
        },
        [overrides, setSetting]
    );

    const logOccurrence = React.useCallback(
        async (item: CentreItem, injectionSite?: string) => {
            const {occurrence} = item;
            setBusyKey(occurrence.key);
            try {
                await logDose({
                    medicationId: occurrence.medicationId,
                    scheduleId: occurrence.scheduleId,
                    doseAmount: occurrence.doseAmount,
                    unit: occurrence.unit,
                    scheduledFor: occurrence.scheduledFor,
                    injectionSite,
                });
                await setOverride(occurrence.key, null);
                await reload();
                requestNotificationSync({immediate: true});
                toast.success("Dose logged.", {
                    description: `${item.medication?.name ?? "Dose"} · ${formatClockTime(
                        occurrence.scheduledAt
                    )}`,
                });
                return true;
            } catch (error: unknown) {
                toast.error(error instanceof Error ? error.message : "Could not log the dose.");
                return false;
            } finally {
                setBusyKey(null);
            }
        },
        [reload, setOverride]
    );

    const requestLog = React.useCallback(
        (item: CentreItem) => {
            if (isInjectableMedicationType(item.medication?.type)) {
                setSiteItem(item);
                return;
            }
            void logOccurrence(item);
        },
        [logOccurrence]
    );

    const snooze = React.useCallback(
        async (item: CentreItem) => {
            const key = item.occurrence.key;
            setBusyKey(key);
            try {
                await setOverride(key, {
                    snoozeUntil: new Date(Date.now() + 15 * 60_000).toISOString(),
                });
                requestNotificationSync({immediate: true});
                toast.success("Reminder snoozed for 15 minutes.");
            } finally {
                setBusyKey(null);
            }
        },
        [setOverride]
    );

    const skip = React.useCallback(
        async (item: CentreItem) => {
            const key = item.occurrence.key;
            setBusyKey(key);
            try {
                await setOverride(key, {skippedAt: new Date().toISOString()});
                requestNotificationSync({immediate: true});
                toast.success("Reminder skipped for this occurrence.");
            } finally {
                setBusyKey(null);
            }
        },
        [setOverride]
    );

    const clearOverride = React.useCallback(
        async (item: CentreItem) => {
            const key = item.occurrence.key;
            setBusyKey(key);
            try {
                await setOverride(key, null);
                requestNotificationSync({immediate: true});
                toast.success("Reminder restored.");
            } finally {
                setBusyKey(null);
            }
        },
        [setOverride]
    );

    if (phase.phase === "loading" || !loaded) {
        return (
            <Card aria-busy="true">
                <CardHeader className="gap-2">
                    <Skeleton className="h-5 w-40"/>
                    <Skeleton className="h-3 w-64"/>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                    <Skeleton className="h-16 w-full rounded-lg"/>
                    <Skeleton className="h-16 w-full rounded-lg"/>
                    <Skeleton className="h-16 w-full rounded-lg"/>
                </CardContent>
            </Card>
        );
    }

    if (phase.phase === "error") {
        return (
            <p className="text-destructive text-sm" role="alert">
                Reminders could not be loaded: {phase.message}
            </p>
        );
    }

    const consentCurrent = hasCurrentNotificationConsent(
        settings["notifications.consentAt"],
        settings["notifications.consentVersion"]
    );
    const enabled = settings["notifications.enabled"] && consentCurrent;

    return (
        <div className="flex flex-col gap-4">
            <RelayStatusCard enabled={enabled} relay={relay}/>

            {!enabled && (
                <p className="text-muted-foreground flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-xs">
                    <BellOff className="mt-0.5 size-3.5 shrink-0" aria-hidden/>
                    Reminders are off. You can still log doses here; enable notifications in
                    Settings for alerts and background delivery.
                </p>
            )}

            <AgendaSection
                title="Needs attention"
                description="Due now or overdue in the last two days."
                items={attention}
                empty="Nothing is due right now."
                focus={focus}
                focusRef={focusRef}
                busyKey={busyKey}
                busy={reloading}
                overrides={overrides}
                onLog={requestLog}
                onSnooze={(item) => void snooze(item)}
                onSkip={(item) => void skip(item)}
                onClear={(item) => void clearOverride(item)}
                tone="attention"
            />

            <AgendaSection
                title="Next 7 days"
                description="Upcoming scheduled doses from your active schedules."
                items={upcoming.slice(0, 60)}
                empty="No upcoming doses in the next week."
                focus={focus}
                focusRef={focusRef}
                busyKey={busyKey}
                busy={reloading}
                overrides={overrides}
                onLog={requestLog}
                onSnooze={(item) => void snooze(item)}
                onSkip={(item) => void skip(item)}
                onClear={(item) => void clearOverride(item)}
            />

            {recent.length > 0 && (
                <AgendaSection
                    title="Logged in the last 24 hours"
                    description="Completed occurrences from your schedules."
                    items={recent.slice(0, 30)}
                    empty=""
                    focus={focus}
                    focusRef={focusRef}
                    busyKey={busyKey}
                    busy={reloading}
                    overrides={overrides}
                    onLog={requestLog}
                    onSnooze={(item) => void snooze(item)}
                    onSkip={(item) => void skip(item)}
                    onClear={(item) => void clearOverride(item)}
                    readOnly
                />
            )}

            <InjectionSiteDialog
                open={siteItem !== null}
                onOpenChange={(open) => {
                    if (!open) setSiteItem(null);
                }}
                medicationName={siteItem?.medication?.name}
                busy={busyKey !== null}
                recentSites={recentSites}
                onConfirm={(site) => {
                    if (!siteItem) return Promise.resolve(false);
                    const item = siteItem;
                    setSiteItem(null);
                    return logOccurrence(item, site);
                }}
            />
        </div>
    );
}

// Kept as a thin wrapper so the hook order stays obvious and testable.
function RelayStatusCard({
                             enabled,
                             relay,
                         }: {
    enabled: boolean;
    relay: ReturnType<typeof useRelayStatus>;
}) {
    const configured = relay.configured;
    const connected = configured && relay.subscriptionActive;
    const lastSync = relay.lastSyncedAt
        ? new Date(relay.lastSyncedAt).toLocaleString()
        : "Never";

    return (
        <Card>
            <CardHeader className="border-b py-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                    <BellRing className="size-4" aria-hidden/>
                    Reminder delivery
                </CardTitle>
                <CardDescription className="text-xs">
                    On-device alerts work while the app is open. Background delivery needs
                    the relay configured by this deployment.
                </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 py-3 text-xs sm:grid-cols-3">
                <StatusCell
                    label="Relay"
                    value={
                        configured === null
                            ? "Unavailable"
                            : configured
                                ? "Configured"
                                : "Not configured"
                    }
                />
                <StatusCell
                    label="This device"
                    value={
                        !enabled
                            ? "Off"
                            : connected
                                ? "Connected"
                                : "On-device only"
                    }
                />
                <StatusCell label="Last sync" value={enabled ? lastSync : "—"}/>
                {relay.lastError && (
                    <p className="text-destructive sm:col-span-3" role="alert">
                        {relay.lastError}
                    </p>
                )}
                {enabled && configured && !connected && (
                    <div className="sm:col-span-3">
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={() => requestNotificationSync({immediate: true})}
                            disabled={relay.syncing}
                        >
                            <RefreshCw
                                className={cn("size-3.5", relay.syncing && "animate-spin")}
                                aria-hidden
                            />
                            {relay.syncing ? "Connecting…" : "Reconnect background delivery"}
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function StatusCell({label, value}: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
            <span className="text-muted-foreground">{label}</span>
            <span className="truncate font-medium">{value}</span>
        </div>
    );
}

function AgendaSection({
                           title,
                           description,
                           items,
                           empty,
                           focus,
                           focusRef,
                           busyKey,
                           busy,
                           overrides,
                           onLog,
                           onSnooze,
                           onSkip,
                           onClear,
                           tone,
                           readOnly = false,
                       }: {
    title: string;
    description: string;
    items: CentreItem[];
    empty: string;
    focus: string | null;
    focusRef: React.RefObject<HTMLLIElement | null>;
    busyKey: string | null;
    busy: boolean;
    overrides: Record<string, { snoozeUntil?: string; skippedAt?: string }>;
    onLog: (item: CentreItem) => void;
    onSnooze: (item: CentreItem) => void;
    onSkip: (item: CentreItem) => void;
    onClear: (item: CentreItem) => void;
    tone?: "attention";
    readOnly?: boolean;
}) {
    return (
        <Card>
            <CardHeader className="border-b py-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                    {tone === "attention" ? (
                        <TriangleAlert className="size-4 text-amber-500" aria-hidden/>
                    ) : (
                        <Clock3 className="size-4" aria-hidden/>
                    )}
                    {title}
                    <Badge variant="secondary" className="ml-auto tabular-nums">
                        {items.length}
                    </Badge>
                </CardTitle>
                <CardDescription className="text-xs">{description}</CardDescription>
            </CardHeader>
            <CardContent className="py-2">
                {items.length === 0 ? (
                    <p className="text-muted-foreground py-4 text-center text-xs">{empty}</p>
                ) : (
                    <ul className="divide-y">
                        {items.map((item) => (
                            <ReminderRow
                                key={item.occurrence.key}
                                item={item}
                                focused={focus === item.occurrence.key}
                                focusRef={focus === item.occurrence.key ? focusRef : undefined}
                                busy={busy || busyKey === item.occurrence.key}
                                override={overrides[item.occurrence.key]}
                                onLog={onLog}
                                onSnooze={onSnooze}
                                onSkip={onSkip}
                                onClear={onClear}
                                readOnly={readOnly}
                            />
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}

function ReminderRow({
                         item,
                         focused,
                         focusRef,
                         busy,
                         override,
                         onLog,
                         onSnooze,
                         onSkip,
                         onClear,
                         readOnly,
                     }: {
    item: CentreItem;
    focused: boolean;
    focusRef?: React.RefObject<HTMLLIElement | null>;
    busy: boolean;
    override?: { snoozeUntil?: string; skippedAt?: string };
    onLog: (item: CentreItem) => void;
    onSnooze: (item: CentreItem) => void;
    onSkip: (item: CentreItem) => void;
    onClear: (item: CentreItem) => void;
    readOnly: boolean;
}) {
    const {occurrence, medication} = item;
    const skipped = Boolean(override?.skippedAt);
    const snoozedUntil = override?.snoozeUntil ? new Date(override.snoozeUntil) : null;
    const status = occurrence.status;

    return (
        <li
            ref={focusRef}
            className={cn(
                "flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center",
                focused && "ring-ring rounded-md ring-2 ring-offset-2 ring-offset-background",
                skipped && "opacity-60"
            )}
        >
            <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {medication?.name ?? "Unknown medication"}
                    {skipped && (
                        <Badge variant="outline" className="text-[10px]">
                            Skipped
                        </Badge>
                    )}
                    {snoozedUntil && (
                        <Badge variant="outline" className="text-[10px]">
                            Snoozed
                        </Badge>
                    )}
                </p>
                <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs tabular-nums">
                    <DoseReadout
                        amount={occurrence.doseAmount}
                        unit={occurrence.unit}
                        medication={medication}
                    />
                    <span>
                        {formatRelativeDay(occurrence.scheduledAt)} ·{" "}
                        {formatClockTime(occurrence.scheduledAt)}
                    </span>
                    <span className={cn("font-medium", statusTone(status))}>
                        {statusLabel(status)}
                    </span>
                </p>
                {snoozedUntil && (
                    <p className="text-muted-foreground mt-0.5 text-[11px]">
                        Reminder at {formatClockTime(snoozedUntil)}
                    </p>
                )}
            </div>

            {!readOnly && (
                <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={() => onLog(item)}
                        disabled={busy}
                    >
                        <Check className="size-3" aria-hidden/>
                        Log
                    </Button>
                    {skipped || snoozedUntil ? (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            onClick={() => onClear(item)}
                            disabled={busy}
                        >
                            <RotateCcw className="size-3" aria-hidden/>
                            Restore
                        </Button>
                    ) : (
                        <>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7"
                                onClick={() => onSnooze(item)}
                                disabled={busy}
                            >
                                <Clock3 className="size-3" aria-hidden/>
                                Snooze 15m
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7"
                                onClick={() => onSkip(item)}
                                disabled={busy}
                            >
                                <SkipForward className="size-3" aria-hidden/>
                                Skip
                            </Button>
                        </>
                    )}
                </div>
            )}
        </li>
    );
}
