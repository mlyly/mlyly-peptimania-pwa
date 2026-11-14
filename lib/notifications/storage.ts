/**
 * Non-exported local storage for notification secrets.
 *
 * Relay credentials (subscription id + bearer token), the detailed-mode AES
 * key and the last sync snapshot live in their own IndexedDB database — never
 * in the exported `settings` table and never in a backup. `wipeAllLocalData()`
 * removes this database because its name starts with `peptimania`.
 *
 * The service worker opens the same database to decrypt push payloads and to
 * renew its subscription when the browser rotates it.
 */
export const NOTIFICATION_STORAGE_DB = "peptimania-notifications";
export const NOTIFICATION_STORAGE_STORE = "kv";
export const RELAY_CREDENTIALS_KEY = "relayCredentials";
export const DETAIL_KEY_KEY = "detailKey";
export const SYNC_SNAPSHOT_KEY = "syncSnapshot";
export const PENDING_REVOCATIONS_KEY = "pendingRevocations";

export interface RelayCredentials {
    subscriptionId: string;
    /** Bearer token returned once by `POST /v1/subscriptions`. */
    token: string;
    /** The push endpoint these credentials belong to. */
    endpoint: string;
}

/**
 * What the last successful sync sent, so the service worker can register a new
 * push subscription on `pushsubscriptionchange` without an open page. Contains
 * only what the relay already has (instants, opaque ciphertext, keys).
 */
export interface SyncSnapshot {
    /** Relay base URL the snapshot was synced against ("" = same origin). */
    baseUrl: string;
    vapidPublicKey: string;
    body: Record<string, unknown>;
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
            request.onsuccess = () => {
                const database = request.result;
                // Release our handle when something (e.g. a wipe) wants to delete the database.
                database.onversionchange = () => {
                    database.close();
                    globalForStorage.__peptimaniaNotificationStorage = undefined;
                };
                resolve(database);
            };
            request.onerror = () => reject(request.error ?? new Error("Cannot open storage."));
            request.onblocked = () => reject(new Error("Notification storage is blocked."));
        }
    );
    return globalForStorage.__peptimaniaNotificationStorage;
}

/** Closes the cached connection so the database can be deleted. */
export async function closeNotificationStorage(): Promise<void> {
    const pending = globalForStorage.__peptimaniaNotificationStorage;
    globalForStorage.__peptimaniaNotificationStorage = undefined;
    if (!pending) return;
    try {
        (await pending).close();
    } catch {
        // Never opened: nothing to close.
    }
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

function isRelayCredentials(value: unknown): value is RelayCredentials {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return (
        typeof record.subscriptionId === "string" &&
        typeof record.token === "string" &&
        typeof record.endpoint === "string"
    );
}

export async function getRelayCredentials(): Promise<RelayCredentials | null> {
    try {
        const value = await readValue<unknown>(RELAY_CREDENTIALS_KEY);
        return isRelayCredentials(value) ? value : null;
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

export async function getSyncSnapshot(): Promise<SyncSnapshot | null> {
    try {
        const value = await readValue<SyncSnapshot>(SYNC_SNAPSHOT_KEY);
        return value && typeof value === "object" ? value : null;
    } catch {
        return null;
    }
}

export async function saveSyncSnapshot(snapshot: SyncSnapshot): Promise<void> {
    await writeValue(SYNC_SNAPSHOT_KEY, snapshot);
}

/**
 * Relay subscriptions that could not be deleted remotely (offline disable,
 * endpoint rotation). They are retried on the next sync so the relay does not
 * keep an orphaned row with pending reminders.
 */
export async function getPendingRevocations(): Promise<RelayCredentials[]> {
    try {
        const value = await readValue<unknown>(PENDING_REVOCATIONS_KEY);
        return Array.isArray(value) ? value.filter(isRelayCredentials) : [];
    } catch {
        return [];
    }
}

export async function addPendingRevocation(credentials: RelayCredentials): Promise<void> {
    const current = (await getPendingRevocations()).filter(
        (entry) => entry.subscriptionId !== credentials.subscriptionId
    );
    await writeValue(PENDING_REVOCATIONS_KEY, [...current, credentials]);
}

export async function removePendingRevocation(subscriptionId: string): Promise<void> {
    const current = await getPendingRevocations();
    await writeValue(
        PENDING_REVOCATIONS_KEY,
        current.filter((entry) => entry.subscriptionId !== subscriptionId)
    );
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

/** Removes relay credentials, the sync snapshot and the detailed-mode key. */
export async function clearNotificationSecrets(): Promise<void> {
    await Promise.all([
        clearRelayCredentials(),
        clearDetailKey(),
        deleteValue(SYNC_SNAPSHOT_KEY).catch(() => undefined),
    ]);
}
