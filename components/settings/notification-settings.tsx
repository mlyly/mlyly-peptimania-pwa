"use client";

/**
 * Settings → Notifications.
 *
 * Enabling reminders is the only optional feature that can send data off the
 * device, so the card requires an explicit, versioned consent before the
 * browser permission prompt. The embedded relay is optional: when it is not
 * configured, reminders still work while the app is open (on-device watcher).
 *
 * Background state is read from `lib/notifications/relay.ts`; the bearer token
 * and AES key never appear in this component or in exported settings.
 */
import * as React from "react";
import Link from "next/link";
import {
    ArrowRight,
    BellRing,
    Lock,
    Power,
    RefreshCw,
    Send,
    ShieldAlert,
    ShieldCheck,
    TriangleAlert,
} from "lucide-react";

import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Checkbox} from "@/components/ui/checkbox";
import {Label} from "@/components/ui/label";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Skeleton} from "@/components/ui/skeleton";
import {
    getNotificationSupport,
    hasCurrentNotificationConsent,
    NOTIFICATION_LOCAL_ONLY_DATA,
    NOTIFICATION_RELAY_DATA,
    NOTIFICATIONS_CONSENT_VERSION,
    type NotificationSupport,
    requestNotificationPermission,
} from "@/lib/notifications";
import {
    disableNotificationRelay,
    getRelayStatus,
    refreshRelayStatus,
    requestNotificationSync,
    sendRelayTestPush,
    syncNotificationsNow,
    useRelayStatus,
} from "@/lib/notifications/relay";
import {
    NOTIFICATION_DETAIL_LEVELS,
    NOTIFICATION_LEAD_MINUTES,
    type NotificationDetailLevel,
    type NotificationLeadMinutes,
    useAppSettings,
} from "@/lib/settings";
import {toast} from "@/lib/toast";
import {cn} from "@/lib/utils";

function leadLabel(minutes: NotificationLeadMinutes): string {
    if (minutes === 0) return "At dose time";
    return `${minutes} min before`;
}

function detailLabel(level: NotificationDetailLevel): string {
    return level === "generic" ? "Generic (recommended)" : "Detailed (encrypted)";
}

function detailHint(level: NotificationDetailLevel): string {
    return level === "generic"
        ? "The relay only sends “a dose is due”. No medication name or dose."
        : "Medication name and dose are encrypted end-to-end; the relay cannot read them.";
}

async function showLocalTestNotification(): Promise<void> {
    if (!("Notification" in window) || window.Notification.permission !== "granted") {
        throw new Error("Notification permission is not granted.");
    }
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active) {
        throw new Error(
            "The notification worker is not active yet. Open the installed app and try again."
        );
    }
    await registration.showNotification("Peptimania test notification", {
        body: "Reminders are working on this device.",
        tag: "peptimania-test",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: {url: "/settings"},
    });
}

export function NotificationSettings() {
    const {settings, loaded, setSetting} = useAppSettings();
    const relay = useRelayStatus();
    const [support, setSupport] = React.useState<NotificationSupport | null>(null);
    const [agreed, setAgreed] = React.useState(false);
    const [busy, setBusy] = React.useState<string | null>(null);

    const enabled = settings["notifications.enabled"];
    const consentCurrent = hasCurrentNotificationConsent(
        settings["notifications.consentAt"],
        settings["notifications.consentVersion"]
    );
    const active = enabled && consentCurrent;
    const relayConfigured = relay.configured === true;
    const backgroundConnected = relayConfigured && relay.subscriptionActive;

    // Permission, install state and relay availability can change outside
    // React (browser settings, iOS install, deploy with/without VAPID keys).
    React.useEffect(() => {
        const refresh = () => {
            setSupport(getNotificationSupport());
            void refreshRelayStatus();
        };
        refresh();
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refresh);
        return () => {
            window.removeEventListener("focus", refresh);
            document.removeEventListener("visibilitychange", refresh);
        };
    }, []);

    async function enable(): Promise<void> {
        if (!support?.supported) {
            toast.error(support?.reason ?? "Notifications are not available in this browser.");
            return;
        }
        if (!consentCurrent && !agreed) return;

        setBusy("Requesting permission…");
        try {
            const permission = await requestNotificationPermission();
            if (permission !== "granted") {
                setSupport(getNotificationSupport());
                toast.error(
                    permission === "denied"
                        ? "Notifications are blocked for this site. Allow them in your browser settings, then try again."
                        : "Notification permission was not granted."
                );
                return;
            }

            const now = new Date().toISOString();
            await setSetting("notifications.consentAt", now);
            await setSetting("notifications.consentVersion", NOTIFICATIONS_CONSENT_VERSION);
            await setSetting("notifications.enabled", true);

            if (relayConfigured) {
                setBusy("Connecting to the relay…");
                await syncNotificationsNow();
                if (!getRelayStatus().subscriptionActive) {
                    // Consent/permission are kept; only background delivery
                    // failed. Leave reminders off so the retry is explicit.
                    await setSetting("notifications.enabled", false);
                    toast.error("Background delivery could not connect.", {
                        description:
                            getRelayStatus().lastError ??
                            "Check your connection and try again, or use on-device reminders.",
                    });
                    return;
                }
                toast.success("Notifications enabled.", {
                    description:
                        "Background reminders are connected. On-device alerts also work while the app is open.",
                });
            } else {
                toast.success("On-device reminders enabled.", {
                    description:
                        relay.configured === false
                            ? "This deployment has no notification relay, so background delivery is unavailable. Reminders appear while the app is open."
                            : "The relay could not be verified. Reminders appear while the app is open; background delivery retries automatically.",
                });
            }
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(null);
            if (!getRelayStatus().subscriptionActive) {
                // Keep status fresh even when the flow failed early.
                void refreshRelayStatus();
            }
        }
    }

    async function disable(): Promise<void> {
        setBusy("Turning off…");
        try {
            await setSetting("notifications.enabled", false);
            await disableNotificationRelay();
            toast.success("Notifications turned off.");
        } finally {
            setBusy(null);
        }
    }

    async function test(): Promise<void> {
        setBusy("Sending test…");
        try {
            if (relayConfigured) {
                await sendRelayTestPush();
                toast.success("Test push sent through the relay.");
            } else {
                await showLocalTestNotification();
                toast.success("Local test notification sent.");
            }
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(null);
        }
    }

    async function reconnect(): Promise<void> {
        setBusy("Reconnecting…");
        try {
            await syncNotificationsNow();
            if (getRelayStatus().subscriptionActive) {
                toast.success("Background delivery reconnected.");
            } else {
                toast.error("Background delivery could not connect.", {
                    description:
                        getRelayStatus().lastError ??
                        "Check your connection and try again.",
                });
            }
        } finally {
            setBusy(null);
        }
    }

    if (!loaded || support === null) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <BellRing className="size-4" aria-hidden/>
                        Notifications
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3" aria-busy="true">
                    <Skeleton className="h-20 w-full"/>
                    <Skeleton className="h-9 w-2/3"/>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader className="border-b py-4">
                <CardTitle className="flex items-center gap-2 text-base">
                    <BellRing className="size-4" aria-hidden/>
                    Notifications
                </CardTitle>
                <CardDescription>
                    Optional dose reminders. Off by default — the app remains fully
                    local-only unless you opt in below.
                </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-4 py-4">
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                    <p className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
                        <ShieldAlert className="size-4 shrink-0" aria-hidden/>
                        The only optional feature that can leave your device
                    </p>
                    <p className="text-muted-foreground mt-1.5">
                        Background dose reminders require a relay server. If you enable
                        background delivery, the relay receives only a{" "}
                        <strong>minimal</strong> set of data:
                    </p>
                    <ul className="text-muted-foreground mt-2 flex list-disc flex-col gap-1 pl-5">
                        {NOTIFICATION_RELAY_DATA.map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                    <p className="text-muted-foreground mt-2">It never receives:</p>
                    <ul className="text-muted-foreground mt-1 flex list-disc flex-col gap-1 pl-5">
                        {NOTIFICATION_LOCAL_ONLY_DATA.map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                    <p className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden/>
                        {relay.configured === true ? (
                            <>
                                Background delivery is configured for this deployment. The
                                relay database stores reminder instants, not your medication
                                history.
                            </>
                        ) : relay.configured === false ? (
                            <>
                                This deployment has no relay configured. Reminders appear
                                while the app is open; no server is contacted.
                            </>
                        ) : (
                            <>
                                Relay availability could not be checked right now. On-device
                                reminders still work; background delivery is retried when
                                the relay is reachable.
                            </>
                        )}{" "}
                        Contract and deployment notes:{" "}
                        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
                            docs/notifications-plan.md
                        </code>
                        .
                    </p>
                </div>

                <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5">
                        <span className="text-muted-foreground">Browser support</span>
                        <Badge variant={support.supported ? "secondary" : "destructive"}>
                            {support.supported ? "Available" : "Unavailable"}
                        </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5">
                        <span className="text-muted-foreground">Permission</span>
                        <Badge
                            variant={
                                support.permission === "granted"
                                    ? "secondary"
                                    : support.permission === "denied"
                                        ? "destructive"
                                        : "outline"
                            }
                        >
                            {support.permission === "unsupported"
                                ? "Unsupported"
                                : support.permission === "granted"
                                    ? "Granted"
                                    : support.permission === "denied"
                                        ? "Blocked"
                                        : "Not requested"}
                        </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5">
                        <span className="text-muted-foreground">Background delivery</span>
                        <Badge
                            variant={
                                backgroundConnected
                                    ? "secondary"
                                    : relay.configured === false
                                        ? "outline"
                                        : "outline"
                            }
                        >
                            {backgroundConnected
                                ? "Connected"
                                : relay.configured === false
                                    ? "Not configured"
                                    : relay.configured === null
                                        ? "Unknown"
                                        : "Not connected"}
                        </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5">
                        <span className="text-muted-foreground">Last relay sync</span>
                        <span className="text-xs tabular-nums">
                            {enabled && relay.lastSyncedAt
                                ? new Date(relay.lastSyncedAt).toLocaleString()
                                : "—"}
                        </span>
                    </div>
                </div>

                {relay.lastError && (
                    <p className="text-destructive flex items-start gap-2 text-sm" role="alert">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden/>
                        {relay.lastError}
                    </p>
                )}

                {!support.supported && support.reason && (
                    <p className="text-destructive flex items-start gap-2 text-sm" role="alert">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden/>
                        {support.reason}
                    </p>
                )}

                {enabled && !consentCurrent && (
                    <p className="text-destructive flex items-start gap-2 text-sm" role="alert">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden/>
                        Reminders are paused because the consent record is missing or out of
                        date. Re-confirm the disclosure below to turn them back on.
                    </p>
                )}

                {active ? (
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge className="gap-1">
                                <ShieldCheck className="size-3" aria-hidden/>
                                Enabled
                            </Badge>
                            <span className="text-muted-foreground text-xs">
                                On-device reminders while the app is open
                                {backgroundConnected ? " · background push connected" : ""}.
                            </span>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="notification-lead" className="text-xs font-medium">
                                    Remind me
                                </Label>
                                <Select
                                    value={String(settings["notifications.leadMinutes"])}
                                    onValueChange={(value) => {
                                        void setSetting(
                                            "notifications.leadMinutes",
                                            Number(value) as NotificationLeadMinutes
                                        );
                                        requestNotificationSync();
                                    }}
                                >
                                    <SelectTrigger
                                        id="notification-lead"
                                        size="sm"
                                        aria-label="Reminder lead time"
                                    >
                                        <SelectValue/>
                                    </SelectTrigger>
                                    <SelectContent>
                                        {NOTIFICATION_LEAD_MINUTES.map((minutes) => (
                                            <SelectItem key={minutes} value={String(minutes)}>
                                                {leadLabel(minutes)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <span className="text-xs font-medium">Background content</span>
                                <div className="grid gap-2">
                                    {NOTIFICATION_DETAIL_LEVELS.map((level) => {
                                        const selected =
                                            settings["notifications.detailLevel"] === level;
                                        return (
                                            <button
                                                key={level}
                                                type="button"
                                                aria-pressed={selected}
                                                onClick={() => {
                                                    void setSetting(
                                                        "notifications.detailLevel",
                                                        level
                                                    );
                                                    requestNotificationSync({immediate: true});
                                                }}
                                                className={cn(
                                                    "flex flex-col items-start gap-0.5 rounded-lg border p-2.5 text-left transition-colors",
                                                    selected
                                                        ? "border-ring bg-accent/40"
                                                        : "hover:bg-accent/20"
                                                )}
                                            >
                                                <span className="flex items-center gap-1.5 text-sm font-medium">
                                                    {level === "generic" ? (
                                                        <ShieldCheck className="size-3.5" aria-hidden/>
                                                    ) : (
                                                        <Lock className="size-3.5" aria-hidden/>
                                                    )}
                                                    {detailLabel(level)}
                                                </span>
                                                <span className="text-muted-foreground text-xs">
                                                    {detailHint(level)}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                            <p className="text-muted-foreground text-xs">
                                {consentCurrent && settings["notifications.consentAt"]
                                    ? `Consent recorded ${new Date(
                                        settings["notifications.consentAt"]
                                    ).toLocaleDateString()}.`
                                    : "No current consent record."}
                            </p>
                            <div className="flex flex-wrap gap-2">
                                <Button asChild size="sm" variant="outline" className="h-8">
                                    <Link href="/notifications">
                                        <BellRing className="size-3.5" aria-hidden/>
                                        Reminder centre
                                        <ArrowRight className="size-3" aria-hidden/>
                                    </Link>
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-8"
                                    disabled={busy !== null || !support.supported}
                                    onClick={() => void test()}
                                >
                                    <Send className="size-3.5" aria-hidden/>
                                    {relayConfigured ? "Send test push" : "Send test"}
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-8"
                                    disabled={busy !== null}
                                    onClick={() => void disable()}
                                >
                                    <Power className="size-3.5" aria-hidden/>
                                    Turn off
                                </Button>
                            </div>
                        </div>

                        {relayConfigured && !backgroundConnected && (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 self-start"
                                disabled={busy !== null}
                                onClick={() => void reconnect()}
                            >
                                <RefreshCw
                                    className={cn("size-3.5", relay.syncing && "animate-spin")}
                                    aria-hidden
                                />
                                {busy ?? "Reconnect background delivery"}
                            </Button>
                        )}
                        {busy && <p className="text-muted-foreground text-xs">{busy}</p>}
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {consentCurrent && settings["notifications.consentAt"] ? (
                            <p className="text-muted-foreground flex items-center gap-2 text-sm">
                                <ShieldCheck className="size-4 shrink-0 text-emerald-500" aria-hidden/>
                                You accepted this disclosure on{" "}
                                {new Date(settings["notifications.consentAt"]).toLocaleDateString()}.
                            </p>
                        ) : (
                            <div className="flex items-start gap-3">
                                <Checkbox
                                    id="notification-consent"
                                    checked={agreed}
                                    onCheckedChange={(checked) => setAgreed(checked === true)}
                                />
                                <Label
                                    htmlFor="notification-consent"
                                    className="cursor-pointer text-sm font-medium leading-snug"
                                >
                                    I understand and agree to the disclosure above, including
                                    the minimal data sharing that applies if background
                                    delivery is enabled. I understand this is the only
                                    exception to “all data stays in this browser”.
                                </Label>
                            </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                type="button"
                                disabled={
                                    !support.supported ||
                                    busy !== null ||
                                    (!consentCurrent && !agreed)
                                }
                                onClick={() => void enable()}
                            >
                                <BellRing className="size-4" aria-hidden/>
                                {busy ??
                                    (enabled
                                        ? "Re-confirm & enable"
                                        : relayConfigured
                                            ? "Enable notifications"
                                            : "Enable on-device reminders")}
                            </Button>
                            <p className="text-muted-foreground text-xs">
                                {relayConfigured
                                    ? "Your browser will ask for permission, then this device connects to the relay."
                                    : "Your browser will ask for permission. No server is contacted."}
                            </p>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
