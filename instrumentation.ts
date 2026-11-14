/**
 * Next.js server bootstrap hook.
 *
 * Starts the notification relay's in-process delivery timer in the Node
 * runtime. The import is dynamic and guarded by `NEXT_RUNTIME` so the Edge
 * runtime never tries to load `node:sqlite`.
 */
export async function register(): Promise<void> {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;
    try {
        const {startNotificationScheduler} = await import(
            "@/lib/server/notifications/scheduler"
            );
        startNotificationScheduler();
    } catch {
        // The relay is optional; a scheduler failure must never prevent the
        // app from starting. The API reports its health separately.
    }
}
