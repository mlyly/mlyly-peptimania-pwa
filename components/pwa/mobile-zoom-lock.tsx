"use client";

import {useEffect} from "react";

/**
 * Disables pinch-to-zoom gestures on touch-first (mobile) devices while
 * leaving desktop zoom untouched.
 *
 * Why this exists on top of the viewport metadata:
 *  - iOS Safari respects `user-scalable=no`, but also exposes proprietary
 *    `gesturestart`/`gesturechange`/`gestureend` events that can still zoom.
 *  - Chrome on Android intentionally ignores `user-scalable=no`, so a
 *    non-passive multi-touch `touchmove` guard is needed there.
 *  - Desktop browsers ignore the viewport meta for page zoom and their
 *    trackpad/mouse gestures never reach this guard, so Ctrl/Cmd +/- and
 *    pinch-to-zoom continue to work on desktop.
 *
 * Only runs when the primary input is a coarse pointer without hover, which
 * matches phones/tablets but not typical desktops (including touch laptops
 * whose primary pointer is a mouse).
 */
export function MobileZoomLock() {
    useEffect(() => {
        if (typeof window === "undefined") return;

        const media = window.matchMedia("(hover: none) and (pointer: coarse)");
        let teardown: (() => void) | undefined;

        const preventDefault = (event: Event) => {
            if (event.cancelable) event.preventDefault();
        };

        const preventMultiTouch = (event: TouchEvent) => {
            if (event.touches.length > 1 && event.cancelable) {
                event.preventDefault();
            }
        };

        const apply = () => {
            teardown?.();
            teardown = undefined;

            if (!media.matches) return;

            // iOS Safari's non-standard pinch gesture events.
            document.addEventListener("gesturestart", preventDefault, {passive: false});
            document.addEventListener("gesturechange", preventDefault, {passive: false});
            document.addEventListener("gestureend", preventDefault, {passive: false});

            // Android Chrome (and iOS fallback) multi-touch pinch guard.
            document.addEventListener("touchmove", preventMultiTouch, {passive: false});

            teardown = () => {
                document.removeEventListener("gesturestart", preventDefault);
                document.removeEventListener("gesturechange", preventDefault);
                document.removeEventListener("gestureend", preventDefault);
                document.removeEventListener("touchmove", preventMultiTouch);
            };
        };

        apply();
        media.addEventListener("change", apply);

        return () => {
            media.removeEventListener("change", apply);
            teardown?.();
        };
    }, []);

    return null;
}
