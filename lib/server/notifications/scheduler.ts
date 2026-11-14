/**
 * In-process minute scheduler.
 *
 * Dokploy runs one long-lived Next.js server, so a timer started from
 * `instrumentation.ts` is enough — no external cron service is required. The
 * same DB claim/lease logic also makes a multi-container deployment safe if
 * they share the SQLite volume.
 *
 * Set `NOTIFICATIONS_SCHEDULER=0` to disable the timer (e.g. when an external
 * scheduler hits the API instead).
 */
import {getNotificationServerConfig} from "./config";
import {databaseIsHealthy} from "./db";
import {pushIsConfigured} from "./push";
import {processDueReminders} from "./service";

interface SchedulerState {
    timer: ReturnType<typeof setInterval> | null;
    running: boolean;
}

const globalForScheduler = globalThis as typeof globalThis & {
    __peptimaniaNotificationScheduler?: SchedulerState;
};

function state(): SchedulerState {
    globalForScheduler.__peptimaniaNotificationScheduler ??= {
        timer: null,
        running: false,
    };
    return globalForScheduler.__peptimaniaNotificationScheduler;
}

async function tick(): Promise<void> {
    const current = state();
    if (current.running) return;
    current.running = true;
    try {
        if (!databaseIsHealthy()) return;
        await processDueReminders();
    } catch {
        // Never log request/endpoint/medication content from a background
        // tick. A failed tick simply retries on the next interval.
    } finally {
        current.running = false;
    }
}

/** Starts the scheduler once per server process. */
export function startNotificationScheduler(): void {
    const config = getNotificationServerConfig();
    if (!config.schedulerEnabled) return;
    if (!pushIsConfigured()) return;

    const current = state();
    if (current.timer) return;

    current.timer = setInterval(() => void tick(), config.schedulerIntervalMs);
    // Do not keep the process alive solely for the timer.
    current.timer.unref?.();
    // Run once shortly after boot so a restart catches up on missed reminders.
    setTimeout(() => void tick(), 5_000).unref?.();
}

export function stopNotificationScheduler(): void {
    const current = state();
    if (current.timer) {
        clearInterval(current.timer);
        current.timer = null;
    }
}
