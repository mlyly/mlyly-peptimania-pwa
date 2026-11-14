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

/**
 * Client IP for coarse rate limiting only — never logged or stored.
 *
 * The reverse proxy appends the real peer address as the *last*
 * `X-Forwarded-For` hop; earlier hops are supplied by the client and must not
 * be trusted, otherwise a caller could rotate its rate-limit bucket at will.
 */
export function clientIp(request: Request): string {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
        const last = forwarded
            .split(",")
            .map((hop) => hop.trim())
            .filter(Boolean)
            .pop();
        if (last) return last;
    }
    return request.headers.get("x-real-ip")?.trim() || "unknown";
}
