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
// The relay sends either a generic payload (no medication data) or an
// end-to-end encrypted detailed payload. The AES-GCM key lives in the
// non-exported `peptimania-notifications` IndexedDB database, so the worker
// can decrypt locally. Any failure falls back to the generic text — a push is
// never dropped because of a stale key.
// ---------------------------------------------------------------------------

interface PushPayload {
    title: string;
    body: string;
    tag: string;
    url: string;
}

interface EncryptedEnvelope {
    alg: string;
    iv: string;
    ct: string;
}

const NOTIFICATION_STORAGE_DB = "peptimania-notifications";
const NOTIFICATION_STORAGE_STORE = "kv";
const DETAIL_KEY_KEY = "detailKey";

function base64UrlToBytes(value: string): Uint8Array {
    const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function readDetailKey(): Promise<CryptoKey | null> {
    return new Promise((resolve) => {
        let request: IDBOpenDBRequest;
        try {
            request = indexedDB.open(NOTIFICATION_STORAGE_DB, 1);
        } catch {
            resolve(null);
            return;
        }
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(NOTIFICATION_STORAGE_STORE)) {
                request.result.createObjectStore(NOTIFICATION_STORAGE_STORE);
            }
        };
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
            const database = request.result;
            try {
                const transaction = database.transaction(NOTIFICATION_STORAGE_STORE, "readonly");
                const get = transaction.objectStore(NOTIFICATION_STORAGE_STORE).get(DETAIL_KEY_KEY);
                get.onsuccess = () => {
                    const value: unknown = get.result;
                    database.close();
                    resolve(value instanceof CryptoKey ? value : null);
                };
                get.onerror = () => {
                    database.close();
                    resolve(null);
                };
            } catch {
                database.close();
                resolve(null);
            }
        };
    });
}

function readEncryptedEnvelope(value: unknown): EncryptedEnvelope | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (
        typeof record.alg !== "string" ||
        typeof record.iv !== "string" ||
        typeof record.ct !== "string"
    ) {
        return null;
    }
    return {alg: record.alg, iv: record.iv, ct: record.ct};
}

async function decryptDetailed(
    envelope: EncryptedEnvelope
): Promise<{ title: string; body: string } | null> {
    if (envelope.alg !== "A256GCM") return null;
    const key = await readDetailKey();
    if (!key) return null;
    try {
        const plaintext = await crypto.subtle.decrypt(
            {name: "AES-GCM", iv: base64UrlToBytes(envelope.iv) as BufferSource},
            key,
            base64UrlToBytes(envelope.ct) as BufferSource
        );
        const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
        if (!parsed || typeof parsed !== "object") return null;
        const record = parsed as Record<string, unknown>;
        return {
            title: typeof record.title === "string" ? record.title : "Dose due",
            body:
                typeof record.body === "string"
                    ? record.body
                    : "A scheduled dose is due.",
        };
    } catch {
        return null;
    }
}

interface RawPushData {
    raw: unknown;
    text: string | null;
}

function readPushData(event: PushEvent): RawPushData {
    const data = event.data;
    if (!data) return {raw: null, text: null};
    let text: string | null = null;
    try {
        text = data.text();
    } catch {
        text = null;
    }
    if (!text) return {raw: null, text: null};
    try {
        return {raw: JSON.parse(text), text};
    } catch {
        return {raw: null, text};
    }
}

async function resolvePushPayload(data: RawPushData): Promise<PushPayload> {
    const fallback: PushPayload = {
        title: "Peptimania",
        body:
            typeof data.text === "string" && data.text.trim() !== ""
                ? data.text
                : "A dose reminder is ready.",
        tag: "peptimania-reminder",
        url: "/notifications",
    };

    if (!data.raw || typeof data.raw !== "object" || Array.isArray(data.raw)) {
        return fallback;
    }
    const record = data.raw as Record<string, unknown>;
    const generic: PushPayload = {
        title: typeof record.title === "string" ? record.title : "Dose due",
        body:
            typeof record.body === "string"
                ? record.body
                : "A scheduled dose is due.",
        tag: typeof record.tag === "string" ? record.tag : "peptimania-reminder",
        url: typeof record.url === "string" ? record.url : "/notifications",
    };

    const encrypted = readEncryptedEnvelope(record.enc);
    if (encrypted) {
        const decrypted = await decryptDetailed(encrypted);
        if (decrypted) return {...generic, ...decrypted};
        // Key cleared or payload corrupt: keep the generic text.
    }
    return generic;
}

/** Only same-origin targets are allowed from notification data. */
function notificationTargetUrl(raw: unknown): string {
    if (typeof raw !== "string") return "/notifications";
    try {
        const url = new URL(raw, self.location.origin);
        if (url.origin !== self.location.origin) return "/notifications";
        return `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return "/notifications";
    }
}

self.addEventListener("push", (event) => {
    const data = readPushData(event);
    event.waitUntil(
        (async () => {
            const payload = await resolvePushPayload(data);
            // `renotify` is part of the Notifications spec used by browsers,
            // but is missing from this project's DOM lib version — keep it
            // typed locally.
            const options: NotificationOptions & { renotify?: boolean } = {
                body: payload.body,
                tag: payload.tag,
                // Re-alert when a reminder is replaced (e.g. a retry with the
                // same tag).
                renotify: true,
                icon: "/icons/icon-192.png",
                badge: "/icons/icon-192.png",
                data: {url: notificationTargetUrl(payload.url)},
            };
            await self.registration.showNotification(payload.title, options);
        })()
    );
});

// A browser-generated subscription can be rotated independently of the app.
// The page re-subscribes and re-syncs; without an open window the next app
// boot does the same.
self.addEventListener("pushsubscriptionchange", (event) => {
    event.waitUntil(
        (async () => {
            const windowClients = (await self.clients.matchAll({
                type: "window",
                includeUncontrolled: true,
            })) as WindowClient[];
            for (const client of windowClients) {
                client.postMessage({type: "peptimania:pushsubscriptionchange"});
            }
        })()
    );
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
