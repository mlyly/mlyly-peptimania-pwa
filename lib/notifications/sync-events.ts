/**
 * Decoupled sync trigger.
 *
 * Domain services (`lib/scheduling/service.ts`) and import/wipe flows call
 * `requestNotificationSync()` after a write. The relay module is loaded with a
 * dynamic import so those services never statically depend on the relay client
 * (and no import cycle is created).
 *
 * No-op outside the browser (smoke tests, server rendering).
 */
export interface NotificationSyncOptions {
    /** Skip the debounce (settings toggles, import/wipe, reconnect). */
    immediate?: boolean;
}

export function requestNotificationSync(options: NotificationSyncOptions = {}): void {
    if (typeof window === "undefined") return;
    void import("./relay")
        .then(({requestNotificationSync: request}) => request(options))
        .catch(() => {
            // Notifications are optional; a failed dynamic import (e.g. dev
            // server before the worker exists) must never break a write.
        });
}
