"use client";

import * as React from "react";
import {cva} from "class-variance-authority";
import {Toast as ToastPrimitive} from "radix-ui";

import {cn} from "@/lib/utils";

const toastVariants = cva(
    "group/toast pointer-events-auto relative flex w-full items-start gap-2.5 overflow-hidden rounded-lg border px-3.5 py-3 text-sm shadow-lg outline-none transition-all duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2 data-[swipe=cancel]:translate-x-0 data-[swipe=end]:animate-out data-[swipe=end]:fade-out-80 data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none sm:data-[state=closed]:slide-out-to-right-4 sm:data-[state=open]:slide-in-from-right-4",
    {
        variants: {
            variant: {
                default: "bg-background text-foreground",
                success:
                    "border-emerald-500/40 bg-background text-foreground",
                error:
                    "border-destructive/50 bg-destructive/10 text-foreground",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    }
);

function ToastViewport({
                           className,
                           ...props
                       }: React.ComponentProps<typeof ToastPrimitive.Viewport>) {
    return (
        <ToastPrimitive.Viewport
            data-slot="toast-viewport"
            className={cn(
                "pointer-events-none fixed inset-x-0 bottom-0 z-50 flex max-h-dvh w-full flex-col-reverse items-center gap-2 p-4 outline-none sm:inset-x-auto sm:right-0 sm:items-end",
                // Respect the PWA home-indicator safe area.
                "[padding-bottom:max(1rem,env(safe-area-inset-bottom))]",
                className
            )}
            {...props}
        />
    );
}

function ToastRoot({
                       className,
                       variant = "default",
                       ...props
                   }: React.ComponentProps<typeof ToastPrimitive.Root> & {
    variant?: "default" | "success" | "error";
}) {
    return (
        <ToastPrimitive.Root
            data-slot="toast"
            data-variant={variant}
            className={cn(toastVariants({variant}), className)}
            {...props}
        />
    );
}

function ToastTitle({
                        className,
                        ...props
                    }: React.ComponentProps<typeof ToastPrimitive.Title>) {
    return (
        <ToastPrimitive.Title
            data-slot="toast-title"
            className={cn("min-w-0 flex-1 font-medium leading-snug group-data-[variant=success]/toast:text-emerald-600 group-data-[variant=error]/toast:text-destructive dark:group-data-[variant=success]/toast:text-emerald-400", className)}
            {...props}
        />
    );
}

function ToastDescription({
                              className,
                              ...props
                          }: React.ComponentProps<typeof ToastPrimitive.Description>) {
    return (
        <ToastPrimitive.Description
            data-slot="toast-description"
            className={cn("text-muted-foreground mt-0.5 text-xs leading-snug", className)}
            {...props}
        />
    );
}

function ToastClose({
                        className,
                        ...props
                    }: React.ComponentProps<typeof ToastPrimitive.Close>) {
    return (
        <ToastPrimitive.Close
            data-slot="toast-close"
            aria-label="Dismiss"
            className={cn(
                "text-muted-foreground hover:text-foreground -m-1 shrink-0 p-1 outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                className
            )}
            {...props}
        />
    );
}

export {
    ToastPrimitive,
    ToastClose,
    ToastDescription,
    ToastRoot,
    ToastTitle,
    ToastViewport,
    toastVariants,
};
