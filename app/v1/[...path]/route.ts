/**
 * Embedded notification relay API.
 *
 * A single catch-all handler keeps CORS/OPTIONS handling in one place:
 *   GET    /v1/config
 *   GET    /v1/health
 *   POST   /v1/subscriptions
 *   PUT    /v1/subscriptions/:id
 *   DELETE /v1/subscriptions/:id
 *   POST   /v1/subscriptions/:id/test
 *
 * Authentication: `Authorization: Bearer <token>` for every mutation.
 * The server never logs request bodies, push endpoints or reminder content.
 */
import {z} from "zod";

import {authenticate, clientIp} from "@/lib/server/notifications/auth";
import {evaluateCors, preflightResponse} from "@/lib/server/notifications/cors";
import {databaseIsHealthy} from "@/lib/server/notifications/db";
import {consumeRateLimit, rateLimitResponse} from "@/lib/server/notifications/rate-limit";
import {
    createSubscription,
    deleteSubscription,
    publicRelayConfig,
    RelayError,
    sendTestNotification,
    updateSubscription,
} from "@/lib/server/notifications/service";
import {createSubscriptionSchema, syncPayloadSchema,} from "@/lib/server/notifications/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024 * 1024;
const NO_STORE = "no-store";

type RouteContext = { params: Promise<{ path: string[] }> };

function json(
    body: unknown,
    status: number,
    headers: Record<string, string> = {}
): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": NO_STORE,
            ...headers,
        },
    });
}

function mutationCors(request: Request): {
    allowed: boolean;
    headers: Record<string, string>;
} {
    return evaluateCors(request);
}

async function readJson(request: Request): Promise<unknown> {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        throw new BodyTooLargeError();
    }
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) throw new BodyTooLargeError();
    try {
        return JSON.parse(text);
    } catch {
        throw new InvalidJsonError();
    }
}

class BodyTooLargeError extends Error {
}

class InvalidJsonError extends Error {
}

function validationError(
    error: z.ZodError,
    headers: Record<string, string>
): Response {
    return json(
        {
            error: "invalid_request",
            issues: error.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
            })),
        },
        400,
        headers
    );
}

function relayErrorResponse(error: RelayError, headers: Record<string, string>): Response {
    return json({error: error.code}, error.status, headers);
}

function tooMany(
    result: { allowed: boolean; retryAfterSeconds: number },
    headers: Record<string, string>
): Response {
    const response = rateLimitResponse(result);
    return new Response(response.body, {
        status: response.status,
        headers: {...Object.fromEntries(response.headers), ...headers},
    });
}

async function handleConfig(request: Request): Promise<Response> {
    const cors = evaluateCors(request, {publicEndpoint: true});
    return json(publicRelayConfig(), 200, cors.headers);
}

function handleHealth(request: Request): Response {
    const cors = evaluateCors(request, {publicEndpoint: true});
    return json(
        {
            status: databaseIsHealthy() ? "ok" : "degraded",
            configured: publicRelayConfig().configured,
        },
        databaseIsHealthy() ? 200 : 503,
        cors.headers
    );
}

async function handleCreate(request: Request): Promise<Response> {
    const cors = mutationCors(request);
    if (!cors.allowed) return json({error: "origin_not_allowed"}, 403);

    const limited = consumeRateLimit("subscribe", clientIp(request), 20, 60 * 60 * 1000);
    if (!limited.allowed) return tooMany(limited, cors.headers);

    try {
        const payload = createSubscriptionSchema.parse(await readJson(request));
        const created = createSubscription(payload);
        return json(created, 201, cors.headers);
    } catch (error) {
        if (error instanceof BodyTooLargeError) return json({error: "body_too_large"}, 413, cors.headers);
        if (error instanceof InvalidJsonError) return json({error: "invalid_json"}, 400, cors.headers);
        if (error instanceof z.ZodError) return validationError(error, cors.headers);
        if (error instanceof RelayError) return relayErrorResponse(error, cors.headers);
        return json({error: "internal_error"}, 500, cors.headers);
    }
}

async function handleUpdate(request: Request, id: string): Promise<Response> {
    const cors = mutationCors(request);
    if (!cors.allowed) return json({error: "origin_not_allowed"}, 403);
    if (!authenticate(request, id)) return json({error: "unauthorized"}, 401, cors.headers);

    const limited = consumeRateLimit("sync", id, 240, 60_000);
    if (!limited.allowed) return tooMany(limited, cors.headers);

    try {
        const payload = syncPayloadSchema.parse(await readJson(request));
        updateSubscription(id, payload);
        return json({ok: true}, 200, cors.headers);
    } catch (error) {
        if (error instanceof BodyTooLargeError) return json({error: "body_too_large"}, 413, cors.headers);
        if (error instanceof InvalidJsonError) return json({error: "invalid_json"}, 400, cors.headers);
        if (error instanceof z.ZodError) return validationError(error, cors.headers);
        if (error instanceof RelayError) return relayErrorResponse(error, cors.headers);
        return json({error: "internal_error"}, 500, cors.headers);
    }
}

async function handleDelete(request: Request, id: string): Promise<Response> {
    const cors = mutationCors(request);
    if (!cors.allowed) return json({error: "origin_not_allowed"}, 403);
    if (!authenticate(request, id)) return json({error: "unauthorized"}, 401, cors.headers);

    try {
        deleteSubscription(id);
        return new Response(null, {status: 204, headers: cors.headers});
    } catch {
        return json({error: "internal_error"}, 500, cors.headers);
    }
}

async function handleTest(request: Request, id: string): Promise<Response> {
    const cors = mutationCors(request);
    if (!cors.allowed) return json({error: "origin_not_allowed"}, 403);
    const subscription = authenticate(request, id);
    if (!subscription) return json({error: "unauthorized"}, 401, cors.headers);

    const perSubscription = consumeRateLimit("test-sub", id, 3, 60 * 60 * 1000);
    if (!perSubscription.allowed) return tooMany(perSubscription, cors.headers);
    const perIp = consumeRateLimit("test-ip", clientIp(request), 10, 60 * 60 * 1000);
    if (!perIp.allowed) return tooMany(perIp, cors.headers);

    try {
        await sendTestNotification(subscription);
        return json({ok: true}, 200, cors.headers);
    } catch (error) {
        if (error instanceof RelayError) return relayErrorResponse(error, cors.headers);
        return json({error: "push_failed"}, 502, cors.headers);
    }
}

export async function OPTIONS(request: Request): Promise<Response> {
    return preflightResponse(evaluateCors(request));
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
    const {path} = await context.params;
    const route = path.join("/");
    if (route === "config") return handleConfig(request);
    if (route === "health") return handleHealth(request);
    return json({error: "not_found"}, 404);
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
    const {path} = await context.params;
    if (path.length === 1 && path[0] === "subscriptions") return handleCreate(request);
    if (
        path.length === 3 &&
        path[0] === "subscriptions" &&
        path[2] === "test"
    ) {
        return handleTest(request, path[1]);
    }
    return json({error: "not_found"}, 404);
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
    const {path} = await context.params;
    if (path.length === 2 && path[0] === "subscriptions") {
        return handleUpdate(request, path[1]);
    }
    return json({error: "not_found"}, 404);
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
    const {path} = await context.params;
    if (path.length === 2 && path[0] === "subscriptions") {
        return handleDelete(request, path[1]);
    }
    return json({error: "not_found"}, 404);
}
