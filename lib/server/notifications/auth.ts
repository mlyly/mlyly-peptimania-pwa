/**
 * Bearer authentication for subscription mutations.
 *
 * The raw token is returned once at registration; only its SHA-256 hash is
 * stored. Comparison is constant-time (see `db.authenticateSubscription`).
 */
import type {SubscriptionRow} from "./db";
import {authenticateSubscription} from "./db";

export function bearerToken(request: Request): string | null {
    const header = request.headers.get("authorization");
    if (!header) return null;
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    return match ? match[1] : null;
}

export function authenticate(
    request: Request,
    subscriptionId: string
): SubscriptionRow | null {
    const token = bearerToken(request);
    if (!token) return null;
    return authenticateSubscription(subscriptionId, token);
}

/** Client IP for coarse rate limiting only — never logged or stored. */
export function clientIp(request: Request): string {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
        const first = forwarded.split(",")[0]?.trim();
        if (first) return first;
    }
    return request.headers.get("x-real-ip")?.trim() || "unknown";
}
