/// <reference lib="webworker" />

import {defaultCache} from "@serwist/next/worker";
import type {PrecacheEntry, SerwistGlobalConfig} from "serwist";
import {Serwist} from "serwist";

declare global {
    interface WorkerGlobalScope extends SerwistGlobalConfig {
        // Replaced at build time by `serwist build` with the generated
        // precache manifest (see `serwist.config.ts`).
        __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
    }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
    precacheEntries: self.__SW_MANIFEST,
    // Activate new versions immediately and take control of open pages. This
    // matters on iOS, where a standalone PWA can stay "open" for days and a
    // waiting worker would otherwise never activate.
    skipWaiting: true,
    clientsClaim: true,
    // Safari/WebKit does not implement the Navigation Preload API. Enabling it
    // is a no-op at best and breaks offline navigations at worst.
    navigationPreload: false,
    runtimeCaching: defaultCache,
    precacheOptions: {
        cleanupOutdatedCaches: true,
        // The manifest uses clean route URLs (`/medications`, `/dose-logs`).
        // `cleanURLs` also lets a request for `/medications.html` (or an older
        // bookmark) resolve to the same precached route.
        cleanURLs: true,
        // Ignore query parameters so iOS launch tracking (`?source=pwa`) and
        // cache-busting strings still hit the precached route instead of
        // falling through to the network.
        ignoreURLParametersMatching: [/.*/],
        // If a navigation was not precached (deep link, unknown path, or a
        // route added after this worker was installed), boot the app shell.
        // This is what lets an installed iOS PWA open while fully offline.
        navigateFallback: "/",
    },
    fallbacks: {
        entries: [
            {
                url: "/",
                matcher({request}) {
                    return request.destination === "document";
                },
            },
        ],
    },
});

serwist.addEventListeners();

// ---------------------------------------------------------------------------
// Web Push display (background delivery) — see `docs/notifications-plan.md`.
//
// The relay sends a small, generic JSON payload; detailed payloads will be
// end-to-end encrypted before they reach the relay, and the service worker
// could decrypt them here with a key kept in IndexedDB. Until the relay is
// deployed, these handlers are dormant: the on-device watcher in the app is
// what shows reminders.
// ---------------------------------------------------------------------------

interface PushPayload {
    title: string;
    body: string;
    tag: string;
    url: string;
}

function readPushPayload(event: PushEvent): PushPayload {
    let raw: unknown = null;
    try {
        raw = event.data?.json();
    } catch {
        // Fall through to the plain-text/fallback path.
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        const text = event.data?.text();
        return {
            title: "Peptimania",
            body: typeof text === "string" && text.trim() !== ""
                ? text
                : "A dose reminder is ready.",
            tag: "peptimania-reminder",
            url: "/",
        };
    }
    const record = raw as Record<string, unknown>;
    return {
        title: typeof record.title === "string" ? record.title : "Peptimania",
        body: typeof record.body === "string" ? record.body : "A dose reminder is ready.",
        tag: typeof record.tag === "string" ? record.tag : "peptimania-reminder",
        url: typeof record.url === "string" ? record.url : "/",
    };
}

/** Only same-origin targets are allowed from notification data. */
function notificationTargetUrl(raw: unknown): string {
    if (typeof raw !== "string") return "/";
    try {
        const url = new URL(raw, self.location.origin);
        if (url.origin !== self.location.origin) return "/";
        return `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return "/";
    }
}

self.addEventListener("push", (event) => {
    const payload = readPushPayload(event);
    // `renotify` is part of the Notifications spec used by browsers, but is
    // missing from this project's DOM lib version — keep it typed locally.
    const options: NotificationOptions & { renotify?: boolean } = {
        body: payload.body,
        tag: payload.tag,
        // Re-alert when a reminder is replaced (e.g. a retry with the same tag).
        renotify: true,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: {url: notificationTargetUrl(payload.url)},
    };
    event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const target = notificationTargetUrl(event.notification.data?.url);

    event.waitUntil(
        (async () => {
            const windowClients = (await self.clients.matchAll({
                type: "window",
                includeUncontrolled: true,
            })) as WindowClient[];

            for (const client of windowClients) {
                try {
                    await client.navigate(target);
                    return await client.focus();
                } catch {
                    // A client that cannot navigate (e.g. a closing tab) is
                    // skipped; another open window or a new one will handle it.
                }
            }
            return self.clients.openWindow(target);
        })()
    );
});
