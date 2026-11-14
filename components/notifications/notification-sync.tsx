"use client";

/**
 * Lifecycle bridge for background reminders.
 *
 * Keeps the relay horizon fresh without putting sync logic into individual
 * pages: app boot, tab visibility, reconnect, settings changes, schedule /
 * dose-log writes (via `requestNotificationSync`) and browser-initiated
 * subscription rotation all funnel into the debounced relay client.
 */
import * as React from "react";

import {requestNotificationSync} from "@/lib/notifications/relay";
import {useAppSettings} from "@/lib/settings";

export function NotificationSync() {
    const {settings, loaded} = useAppSettings();
    const enabled = settings["notifications.enabled"];
    const leadMinutes = settings["notifications.leadMinutes"];
    const detailLevel = settings["notifications.detailLevel"];

    // App boot: top up the horizon once the shell is mounted.
    React.useEffect(() => {
        requestNotificationSync({immediate: true});
    }, []);

    // Settings/import changes can enable notifications or alter the horizon.
    React.useEffect(() => {
        if (loaded) requestNotificationSync();
    }, [loaded, enabled, leadMinutes, detailLevel]);

    React.useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === "visible") requestNotificationSync();
        };
        const onOnline = () => requestNotificationSync({immediate: true});

        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("online", onOnline);

        let worker: ServiceWorkerContainer | null = null;
        const onWorkerMessage = (event: MessageEvent) => {
            const data: unknown = event.data;
            if (
                data &&
                typeof data === "object" &&
                (data as { type?: unknown }).type === "peptimania:pushsubscriptionchange"
            ) {
                // The browser rotated the subscription; re-subscribe and sync.
                requestNotificationSync({immediate: true});
            }
        };
        if ("serviceWorker" in navigator) {
            worker = navigator.serviceWorker;
            worker.addEventListener("message", onWorkerMessage);
        }

        return () => {
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("online", onOnline);
            worker?.removeEventListener("message", onWorkerMessage);
        };
    }, []);

    return null;
}
