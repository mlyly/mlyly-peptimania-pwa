/**
 * Detailed reminder content, encrypted end-to-end in the browser.
 *
 * The relay stores only `{iv, ct}` and the service worker decrypts with the
 * non-extractable AES-GCM key in `peptimania-notifications`. If decryption
 * fails (key cleared, old subscription), the worker shows the generic
 * "a dose is due" fallback.
 */
import {base64UrlToBytes, bytesToBase64Url} from "./base64";
import {getOrCreateDetailKey} from "./storage";

export interface DetailedNotificationContent {
    title: string;
    body: string;
}

export interface EncryptedDetailPayload {
    /** base64url 12-byte AES-GCM nonce. */
    iv: string;
    /** base64url ciphertext (includes the GCM tag). */
    ct: string;
}

const IV_BYTES = 12;

export async function encryptDetailedPayload(
    content: DetailedNotificationContent
): Promise<EncryptedDetailPayload> {
    const key = await getOrCreateDetailKey();
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const plaintext = new TextEncoder().encode(JSON.stringify(content));
    const ciphertext = await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, plaintext);
    return {
        iv: bytesToBase64Url(iv),
        ct: bytesToBase64Url(new Uint8Array(ciphertext)),
    };
}

/** Used by tests and local debugging; the service worker has its own copy. */
export async function decryptDetailedPayload(
    payload: EncryptedDetailPayload
): Promise<DetailedNotificationContent> {
    const key = await getOrCreateDetailKey();
    const plaintext = await crypto.subtle.decrypt(
        {name: "AES-GCM", iv: base64UrlToBytes(payload.iv)},
        key,
        base64UrlToBytes(payload.ct)
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid payload.");
    const record = parsed as Record<string, unknown>;
    return {
        title: typeof record.title === "string" ? record.title : "Dose due",
        body: typeof record.body === "string" ? record.body : "A scheduled dose is due.",
    };
}
