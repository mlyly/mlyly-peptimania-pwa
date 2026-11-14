/**
 * Request validation for the relay API. Keep limits strict: reminder bodies
 * are small and the payload cap bounds both storage and CPU use.
 */
import {z} from "zod";

const isoDateString = z
    .string()
    .trim()
    .max(64)
    .refine((value) => Number.isFinite(Date.parse(value)), "Invalid ISO timestamp");

const base64UrlString = z
    .string()
    .min(1)
    .max(32_768)
    .regex(/^[A-Za-z0-9_-]+={0,2}$/, "Invalid base64url value");

export const pushSubscriptionSchema = z.object({
    endpoint: z
        .string()
        .trim()
        .max(4096)
        .refine((value) => {
            try {
                return new URL(value).protocol === "https:";
            } catch {
                return false;
            }
        }, "Push endpoint must be an HTTPS URL"),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
        p256dh: z.string().trim().min(16).max(512),
        auth: z.string().trim().min(8).max(512),
    }),
});

export const clientSchema = z.object({
    timezone: z.string().trim().min(1).max(100),
    appVersion: z.string().trim().max(64).optional(),
});

export const preferencesSchema = z.object({
    detailLevel: z.enum(["generic", "detailed"]),
    leadMinutes: z.number().int().min(0).max(1440),
});

export const consentSchema = z.object({
    version: z.string().trim().min(1).max(64),
    acceptedAt: isoDateString,
});

export const reminderSchema = z.object({
    occurrenceKey: z.string().trim().min(1).max(300),
    dueAt: isoDateString,
    /** Phase 2: opaque client-encrypted `{title, body}` (detailed mode). */
    encryptedPayload: z
        .object({
            iv: base64UrlString,
            ct: base64UrlString,
        })
        .optional(),
});

export const syncPayloadSchema = z.object({
    subscription: pushSubscriptionSchema.optional(),
    client: clientSchema,
    preferences: preferencesSchema,
    consent: consentSchema,
    reminders: z.array(reminderSchema).max(5000),
});

export const createSubscriptionSchema = syncPayloadSchema.extend({
    subscription: pushSubscriptionSchema,
});

export type SyncPayload = z.infer<typeof syncPayloadSchema>;
export type CreateSubscriptionPayload = z.infer<typeof createSubscriptionSchema>;
export type PushSubscriptionBody = z.infer<typeof pushSubscriptionSchema>;
