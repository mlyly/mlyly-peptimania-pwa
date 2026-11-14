/**
 * Non-exported local storage for notification secrets.
 *
 * Relay credentials (subscription id + bearer token) and the detailed-mode AES
 * key live in their own IndexedDB database — never in the exported `settings`
 * table and never in a backup. `wipeAllLocalData()` removes this database
 * because its name starts with `peptimania`.
 *
 * The service worker opens the same database to decrypt push payloads.
 */
export const NOTIFICATION_STORAGE_DB = "peptimania-notifications";
export const NOTIFICATION_STORAGE_STORE = "kv";
export const RELAY_CREDENTIALS_KEY = "relayCredentials";
export const DETAIL_KEY_KEY = "detailKey";

export interface RelayCredentials {
    subscriptionId: string;
    /** Bearer token returned once by `POST /v1/subscriptions`. */
    token: string;
    /** The push endpoint these credentials belong to. */
    endpoint: string;
}

const globalForStorage = globalThis as typeof globalThis & {
    __peptimaniaNotificationStorage?: Promise<IDBDatabase>;
};

function openStorage(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") {
        return Promise.reject(new Error("IndexedDB is not available."));
    }
    globalForStorage.__peptimaniaNotificationStorage ??= new Promise<IDBDatabase>(
        (resolve, reject) => {
            const request = indexedDB.open(NOTIFICATION_STORAGE_DB, 1);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(NOTIFICATION_STORAGE_STORE)) {
                    request.result.createObjectStore(NOTIFICATION_STORAGE_STORE);
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error("Cannot open storage."));
            request.onblocked = () => reject(new Error("Notification storage is blocked."));
        }
    );
    return globalForStorage.__peptimaniaNotificationStorage;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Storage request failed."));
    });
}

async function readValue<T>(key: string): Promise<T | undefined> {
    const database = await openStorage();
    const transaction = database.transaction(NOTIFICATION_STORAGE_STORE, "readonly");
    return requestResult(transaction.objectStore(NOTIFICATION_STORAGE_STORE).get(key)) as Promise<
        T | undefined
    >;
}

async function writeValue(key: string, value: unknown): Promise<void> {
    const database = await openStorage();
    const transaction = database.transaction(NOTIFICATION_STORAGE_STORE, "readwrite");
    await requestResult(transaction.objectStore(NOTIFICATION_STORAGE_STORE).put(value, key));
}

async function deleteValue(key: string): Promise<void> {
    const database = await openStorage();
    const transaction = database.transaction(NOTIFICATION_STORAGE_STORE, "readwrite");
    await requestResult(transaction.objectStore(NOTIFICATION_STORAGE_STORE).delete(key));
}

export async function getRelayCredentials(): Promise<RelayCredentials | null> {
    try {
        const value = await readValue<RelayCredentials>(RELAY_CREDENTIALS_KEY);
        if (
            !value ||
            typeof value.subscriptionId !== "string" ||
            typeof value.token !== "string" ||
            typeof value.endpoint !== "string"
        ) {
            return null;
        }
        return value;
    } catch {
        return null;
    }
}

export async function saveRelayCredentials(credentials: RelayCredentials): Promise<void> {
    await writeValue(RELAY_CREDENTIALS_KEY, credentials);
}

export async function clearRelayCredentials(): Promise<void> {
    try {
        await deleteValue(RELAY_CREDENTIALS_KEY);
    } catch {
        // Storage may be unavailable (private mode); nothing else to do.
    }
}

/** Returns the AES-GCM key used for detailed payloads, creating it if needed. */
export async function getOrCreateDetailKey(): Promise<CryptoKey> {
    const existing = await readValue<CryptoKey>(DETAIL_KEY_KEY);
    if (existing) return existing;
    const key = await crypto.subtle.generateKey(
        {name: "AES-GCM", length: 256},
        false,
        ["encrypt", "decrypt"]
    );
    await writeValue(DETAIL_KEY_KEY, key);
    return key;
}

export async function clearDetailKey(): Promise<void> {
    try {
        await deleteValue(DETAIL_KEY_KEY);
    } catch {
        // Ignore storage failures.
    }
}

/** Removes both relay credentials and the detailed-mode key. */
export async function clearNotificationSecrets(): Promise<void> {
    await Promise.all([clearRelayCredentials(), clearDetailKey()]);
}
