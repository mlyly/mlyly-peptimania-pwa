"use client";

import * as React from "react";
import {AlertCircle, AlertTriangle, CheckCircle2, Info, X} from "lucide-react";

import {cn} from "@/lib/utils";
import {
    ToastClose,
    ToastDescription,
    ToastPrimitive,
    ToastRoot,
    ToastTitle,
    ToastViewport,
} from "@/components/ui/toast";
import {dismissToast, getToasts, subscribeToasts, type ToastItem,} from "@/lib/toast";

const EMPTY_TOASTS: readonly ToastItem[] = [];

/**
 * > 3.5 days so Radix's auto-close timer effectively never fires — used for
 * persistent error toasts (setTimeout overflows past 2^31 ms).
 */
const PERSISTENT_DURATION = 2_147_483_647;

/** Unmount delay matching the toast's exit animation (~200 ms + buffer). */
const EXIT_MS = 350;

const TOAST_ICONS = {
    default: Info,
    success: CheckCircle2,
    warning: AlertTriangle,
    error: AlertCircle,
} as const;

const ICON_CLASSES = {
    default: "text-muted-foreground",
    success: "text-emerald-600 dark:text-emerald-400",
    warning: "text-amber-600 dark:text-amber-400",
    error: "text-destructive",
} as const;

function ToastListItem({toast}: { toast: ToastItem }) {
    const [open, setOpen] = React.useState(true);
    const Icon = TOAST_ICONS[toast.variant];

    // Keep the toast mounted through its exit animation, then drop it from
    // the store (which unmounts this row).
    React.useEffect(() => {
        if (open) return;
        const timer = window.setTimeout(() => dismissToast(toast.id), EXIT_MS);
        return () => window.clearTimeout(timer);
    }, [open, toast.id]);

    return (
        <ToastRoot
            variant={toast.variant}
            open={open}
            duration={toast.duration > 0 ? toast.duration : PERSISTENT_DURATION}
            onOpenChange={(next) => {
                if (!next) setOpen(false);
            }}
        >
            <Icon
                className={cn("mt-0.5 size-4 shrink-0", ICON_CLASSES[toast.variant])}
                aria-hidden
            />
            <div className="min-w-0 flex-1">
                <ToastTitle>{toast.title}</ToastTitle>
                {toast.description && (
                    <ToastDescription>{toast.description}</ToastDescription>
                )}
            </div>
            <ToastClose>
                <X className="size-3.5" aria-hidden/>
            </ToastClose>
        </ToastRoot>
    );
}

/**
 * Application-wide toast host. Subscribes to the `lib/toast` store and
 * renders the queue in a bottom Radix Toast viewport (centered on mobile,
 * bottom-right from `sm` up). Mounted once in the root layout.
 */
export function Toaster() {
    const toasts = React.useSyncExternalStore(
        subscribeToasts,
        getToasts,
        () => EMPTY_TOASTS
    );

    return (
        <ToastPrimitive.Provider label="Notifications">
            {toasts.map((toast) => (
                <ToastListItem key={toast.id} toast={toast}/>
            ))}
            <ToastViewport/>
        </ToastPrimitive.Provider>
    );
}
