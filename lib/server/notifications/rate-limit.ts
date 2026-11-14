/**
 * Tiny in-process fixed-window rate limiter.
 *
 * The relay is a single self-hosted instance backed by one SQLite file, so an
 * in-memory limiter is sufficient and avoids another table. It bound memory by
 * pruning expired buckets opportunistically.
 */
interface Bucket {
    count: number;
    resetAt: number;
}

const globalForLimiter = globalThis as typeof globalThis & {
    __peptimaniaRateLimits?: Map<string, Bucket>;
};

function buckets(): Map<string, Bucket> {
    globalForLimiter.__peptimaniaRateLimits ??= new Map();
    return globalForLimiter.__peptimaniaRateLimits;
}

export interface RateLimitResult {
    allowed: boolean;
    retryAfterSeconds: number;
}

export function consumeRateLimit(
    scope: string,
    key: string,
    limit: number,
    windowMs: number,
    now: number = Date.now()
): RateLimitResult {
    const map = buckets();
    const bucketKey = `${scope}:${key}`;
    const existing = map.get(bucketKey);

    if (!existing || existing.resetAt <= now) {
        map.set(bucketKey, {count: 1, resetAt: now + windowMs});
        if (map.size > 10_000) {
            for (const [candidate, bucket] of map) {
                if (bucket.resetAt <= now) map.delete(candidate);
            }
        }
        return {allowed: true, retryAfterSeconds: 0};
    }

    if (existing.count >= limit) {
        return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
        };
    }

    existing.count += 1;
    return {allowed: true, retryAfterSeconds: 0};
}

export function rateLimitResponse(result: RateLimitResult): Response {
    return new Response(JSON.stringify({error: "rate_limited"}), {
        status: 429,
        headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "retry-after": String(result.retryAfterSeconds),
        },
    });
}
