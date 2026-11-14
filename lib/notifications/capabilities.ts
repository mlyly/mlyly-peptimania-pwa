/**
 * Browser capability + permission detection for notifications.
 *
 * Kept out of render paths: `Notification`, `navigator` and `matchMedia` only
 * exist in the browser, so callers read this inside an effect or an event
 * handler (never during server rendering).
 */

export type NotificationPermissionState = NotificationPermission | "unsupported";

export interface NotificationSupportBase {
    /** Browser permission state (`unsupported` when the API is absent). */
    permission: NotificationPermissionState;
    /** Whether the app is running as an installed/home-screen PWA. */
    installed: boolean;
    /** iOS/iPadOS needs an installed PWA before Web Push is available. */
    isIos: boolean;
}

export type NotificationSupport =
    | (NotificationSupportBase & { supported: true; reason: null })
    | (NotificationSupportBase & { supported: false; reason: string });

function isIosDevice(): boolean {
    const ua = navigator.userAgent;
    const classicIos = /iPad|iPhone|iPod/.test(ua);
    // iPadOS 13+ reports a desktop macOS user agent; touch points reveal it.
    const iPadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    return classicIos || iPadOs;
}

function isInstalledApp(): boolean {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
    // Safari's legacy iOS flag.
    return Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function unsupported(
    reason: string,
    base: Omit<NotificationSupportBase, "permission"> & {
        permission?: NotificationPermissionState;
    }
): NotificationSupport {
    return {
        supported: false,
        reason,
        permission: base.permission ?? "unsupported",
        installed: base.installed,
        isIos: base.isIos,
    };
}

/**
 * Detects whether this browser can show reminders at all. Permission is
 * intentionally reported separately: a supported browser can still have
 * notifications blocked by the user.
 */
export function getNotificationSupport(): NotificationSupport {
    if (typeof window === "undefined" || typeof navigator === "undefined") {
        return unsupported("Notifications are only available in the browser.", {
            installed: false,
            isIos: false,
        });
    }

    const isIos = isIosDevice();
    const installed = isInstalledApp();
    const hasNotificationApi = "Notification" in window;
    const permission: NotificationPermissionState = hasNotificationApi
        ? window.Notification.permission
        : "unsupported";
    const base = {installed, isIos, permission};

    if (!window.isSecureContext) {
        return unsupported("Notifications require HTTPS (or localhost).", base);
    }
    if (!hasNotificationApi) {
        return unsupported("This browser does not support notifications.", base);
    }
    if (!("serviceWorker" in navigator)) {
        return unsupported(
            "This browser cannot show reminders because service workers are unavailable.",
            base
        );
    }
    if (isIos && !installed) {
        return unsupported(
            "On iPhone and iPad, add Peptimania to the Home Screen first, then enable notifications from the installed app.",
            base
        );
    }
    if (permission === "denied") {
        return unsupported(
            "Notifications are blocked for this site. Allow them in your browser settings, then try again.",
            base
        );
    }

    return {supported: true, reason: null, ...base};
}

/**
 * Requests permission if it has not been decided yet. Must be called from a
 * user gesture (the settings button's click handler) on Safari/iOS.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    if (window.Notification.permission !== "default") {
        return window.Notification.permission;
    }
    return window.Notification.requestPermission();
}
