"use client";

import {useEffect, useRef} from "react";

import {useOffline} from "next/offline";

import {toast} from "@/lib/toast";

/** Reserved toast id so repeated offline transitions replace the same toast. */
const OFFLINE_TOAST_ID = -1;

/**
 * Shows a one-shot warning toast when the device drops offline. The app is
 * fully functional without a network, so this is a heads-up (changes are
 * saved locally), not an error — and it auto-dismisses instead of occupying
 * a permanent banner. Going back online clears any toast still visible.
 */
export function OfflineNotice() {
    const isOffline = useOffline();
    const wasOffline = useRef(false);

    useEffect(() => {
        if (isOffline && !wasOffline.current) {
            toast.warning(
                "You’re offline — everything still works, and changes are saved on this device.",
                {id: OFFLINE_TOAST_ID}
            );
        } else if (!isOffline) {
            toast.dismiss(OFFLINE_TOAST_ID);
        }

        wasOffline.current = isOffline;
    }, [isOffline]);

    return null;
}
