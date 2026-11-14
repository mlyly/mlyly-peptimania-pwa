/**
 * CORS + origin checks for the embedded relay.
 *
 * By default only the app's own origin may call mutation endpoints. Extra
 * origins (e.g. a separately hosted PWA build) can be allowlisted with
 * `NOTIFICATIONS_ALLOWED_ORIGINS`. Requests without an `Origin` header
 * (server-to-server, curl) are allowed because mutations still require a
 * bearer token.
 */
import {getNotificationServerConfig} from "./config";

export interface CorsDecision {
    allowed: boolean;
    headers: Record<string, string>;
}

const ALLOW_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const ALLOW_HEADERS = "authorization, content-type";
const MAX_AGE = "600";

function normalizedOrigin(value: string): string {
    return value.trim().replace(/\/$/, "");
}

function requestOrigin(request: Request): string {
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    try {
        const url = new URL(request.url);
        const protocol = forwardedProto || url.protocol.replace(":", "");
        const host = forwardedHost || request.headers.get("host") || url.host;
        return `${protocol}://${host}`;
    } catch {
        return "";
    }
}

export function evaluateCors(
    request: Request,
    options: { publicEndpoint?: boolean } = {}
): CorsDecision {
    const originHeader = request.headers.get("origin");
    if (!originHeader) return {allowed: true, headers: {}};

    if (options.publicEndpoint) {
        return {
            allowed: true,
            headers: {
                "access-control-allow-origin": "*",
                "access-control-allow-methods": "GET, OPTIONS",
                "access-control-allow-headers": ALLOW_HEADERS,
                "access-control-max-age": MAX_AGE,
            },
        };
    }

    const origin = normalizedOrigin(originHeader);
    const allowedOrigins = getNotificationServerConfig().allowedOrigins;
    const sameOrigin = origin === normalizedOrigin(requestOrigin(request));
    if (!sameOrigin && !allowedOrigins.includes(origin)) {
        return {allowed: false, headers: {}};
    }

    return {
        allowed: true,
        headers: {
            "access-control-allow-origin": origin,
            "access-control-allow-methods": ALLOW_METHODS,
            "access-control-allow-headers": ALLOW_HEADERS,
            "access-control-max-age": MAX_AGE,
            vary: "Origin",
        },
    };
}

export function preflightResponse(decision: CorsDecision): Response {
    if (!decision.allowed) return new Response(null, {status: 403});
    return new Response(null, {status: 204, headers: decision.headers});
}
