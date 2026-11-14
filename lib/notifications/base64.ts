/**
 * Base64url helpers (RFC 4648 §5) used for VAPID keys and AES-GCM fields.
 * `atob`/`btoa` exist in browsers, service workers and modern Node.
 */

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
    const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Concatenates chunks into one contiguous buffer. */
export function concatBytes(...chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}
