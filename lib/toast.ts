// ---------------------------------------------------------------------------
// Application toasts — a tiny framework-free notification store.
//
// Managers call `toast.success("BPC-157 updated.")` / `toast.error(...)`
// from any event handler; the <Toaster/> mounted in the root layout
// subscribes and renders them in a bottom Radix Toast viewport. Success
// toasts auto-dismiss; error toasts stay until dismissed — mirroring the
// semantics of the inline feedback lines this replaced.
// ---------------------------------------------------------------------------

export type ToastVariant = "default" | "success" | "error";

export interface ToastItem {
    id: number;
    /** Main message (rendered as the toast title). */
    title: string;
    /** Optional secondary line. */
    description?: string;
    variant: ToastVariant;
    /** Auto-dismiss delay in ms; <= 0 means persistent until dismissed. */
    duration: number;
}

export interface ToastOptions {
    /** Reuse an id to replace an in-flight toast instead of stacking a new one. */
    id?: number;
    description?: string;
    /** Override the per-variant auto-dismiss delay (<= 0 → persistent). */
    duration?: number;
}

const DEFAULT_DURATIONS: Record<ToastVariant, number> = {
    default: 4000,
    success: 4000,
    error: 0,
};

/** Never stack more than this many toasts; the oldest is dropped. */
const MAX_VISIBLE = 4;

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) listener();
}

/** Subscribe to queue changes; returns an unsubscribe function. */
export function subscribeToasts(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Current immutable snapshot (stable reference between pushes/dismissals). */
export function getToasts(): readonly ToastItem[] {
    return toasts;
}

function push(variant: ToastVariant, title: string, options?: ToastOptions): number {
    const id = options?.id ?? nextId++;
    const item: ToastItem = {
        id,
        title,
        description: options?.description,
        variant,
        duration: options?.duration ?? DEFAULT_DURATIONS[variant],
    };
    // Replace by id (upsert semantics), then trim to the newest MAX_VISIBLE.
    toasts = [...toasts.filter((t) => t.id !== id), item].slice(-MAX_VISIBLE);
    emit();
    return id;
}

/** Remove one toast by id, or the whole queue when called without an id. */
export function dismissToast(id?: number): void {
    toasts = id === undefined ? [] : toasts.filter((t) => t.id !== id);
    emit();
}

export interface Toast {
    (title: string, options?: ToastOptions): number;

    success(title: string, options?: ToastOptions): number;

    error(title: string, options?: ToastOptions): number;

    dismiss(id?: number): void;
}

/**
 * Imperative toast API: `toast("Saved.")`, `toast.success(...)`,
 * `toast.error(...)`, `toast.dismiss(id?)`.
 */
export const toast: Toast = Object.assign(
    (title: string, options?: ToastOptions) => push("default", title, options),
    {
        success: (title: string, options?: ToastOptions) =>
            push("success", title, options),
        error: (title: string, options?: ToastOptions) =>
            push("error", title, options),
        dismiss: dismissToast,
    }
);
