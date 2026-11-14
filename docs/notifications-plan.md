# Notifications — server + client implementation plan

Status: **phases 0–2 implemented** (consent, on-device reminders, embedded Web Push relay,
generic + end-to-end encrypted detailed delivery, notification centre, sync lifecycle,
service-worker decryption). Phase 3 remains optional/deferred.

The app is now a normal Next.js server build. User data still lives entirely in the browser;
the server runtime exists only for the optional relay, which is served from the same
application under `/v1/*` and stores state in a file-based SQLite database
(`node:sqlite`) on a persistent volume. `NEXT_PUBLIC_NOTIFICATION_RELAY_URL` may point the
client at a separately hosted relay, but it defaults to the same origin.

This document defines the relay, the client protocol, the privacy contract, the deployment
and the rollout.

---

## 1. Goals and non-goals

### Goals

- Optional dose reminders that work while the app is closed (background push).
- Explicit, versioned opt-in with a clear warning that notifications are the only feature
  that sends data off the device.
- Default experience remains fully local: no account, no telemetry, no server calls.
- Minimise server knowledge: generic content by default, end-to-end encrypted content for
  detailed reminders.
- Reliable delivery across Chrome/Android, desktop browsers and iOS 16.4+ installed PWAs.
- One-tap disable that unsubscribes and deletes relay data.

### Non-goals

- Delivering reminders without any server. (True background delivery requires push.)
- Syncing medication data, logs, inventory or measurements between devices.
- Analytics, engagement tracking, read receipts or marketing notifications.
- Reminder delivery when the user has denied browser notification permission.

---

## 2. Privacy contract

Notifications are **off by default**. Turning them on is the only action that breaks the
"all data stays in this browser" guarantee.

### 2.1 What the relay may receive

| Data                                                  | Generic mode (default)      | Detailed mode                            |
|-------------------------------------------------------|-----------------------------|------------------------------------------|
| Push endpoint + `p256dh` / `auth` keys                | Yes                         | Yes                                      |
| IANA time zone                                        | Yes                         | Yes                                      |
| Reminder timestamps (`dueAt`)                         | Yes                         | Yes                                      |
| IP address / request metadata                         | Yes (transport requirement) | Yes                                      |
| Medication name, dose, unit                           | **No**                      | Only inside an end-to-end encrypted blob |
| Dose history, inventory, measurements, notes, backups | **No**                      | **No**                                   |
| Name, email, account identity                         | **No**                      | **No**                                   |

The relay must never log request bodies, endpoints, medication content or notification text.
It may keep operational state (subscription present/revoked, reminder due/sent, attempt
counts) for the shortest period needed to operate the service.

### 2.2 Detailed-mode encryption

- The client generates an AES-256-GCM key and stores the raw key in a **non-exported**
  IndexedDB store.
- The client encrypts the title/body locally and sends only `{v, alg, iv, ciphertext}`.
- The relay stores and forwards the opaque blob; it cannot decrypt it.
- The service worker decrypts with the local key before calling
  `registration.showNotification`.
- If decryption fails (key cleared, old subscription), the service worker shows the generic
  fallback body. The relay still knows **when** reminders fire and how many there are; this is
  disclosed in Settings.

### 2.3 Consent

- Consent is stored locally as `notifications.consentAt` +
  `notifications.consentVersion` (schema v8 `settings` store; no migration needed).
- `NOTIFICATIONS_CONSENT_VERSION` in `lib/notifications/consent.ts` is the source of truth.
  Bumping it invalidates old consent and the settings card asks again.
- Consent is recorded only after the browser permission is granted.
- Disabling notifications turns reminders off but keeps the consent record, so re-enabling
  does not require re-reading the disclosure. "Restore defaults" also preserves consent.
- A future disclosure change requires a new checkbox acknowledgement.

---

## 3. Architecture

```
┌──────────────────────────────────────────────┐
│ Browser (Peptimania PWA)                     │
│                                              │
│ IndexedDB `peptimania`: meds, schedules,     │
│ logs, settings                               │
│ IndexedDB `peptimania-notifications`:        │
│ relay token + AES-GCM key (never exported)   │
│                                              │
│ lib/notifications                            │
│  - consent / capability                      │
│  - subscription + sync lifecycle             │
│  - reminder expansion / encryption           │
└───────────────────┬──────────────────────────┘
                    │ HTTPS (config / subscribe / sync / delete)
                    ▼
┌──────────────────────────────────────────────┐
│ Next.js server — same deployment             │
│                                              │
│  app/v1/[...path]/route.ts                   │
│  lib/server/notifications                    │
│  SQLite file on a persistent volume          │
│  VAPID keys (server env only)                │
│  in-process tick every minute                │
└───────────────────┬──────────────────────────┘
                    │ Web Push (RFC 8291/8292)
                    ▼
┌──────────────────────────────────────────────┐
│ Browser push service                         │
│ (FCM / APNs / Mozilla)                       │
└───────────────────┬──────────────────────────┘
                    ▼
┌──────────────────────────────────────────────┐
│ Service worker `push` event                  │
│ → decrypt (detailed) or generic fallback     │
│ → showNotification                           │
│ → click focuses/opens `/notifications`       │
└──────────────────────────────────────────────┘
```

### Server stack

| Choice                | Why                                                                        |
|-----------------------|----------------------------------------------------------------------------|
| Next.js route handler | Runs in the same app/image; no second deployable, no public relay base URL |
| `node:sqlite`         | One file, no native module, no database service; fits a single Dokploy app |
| `web-push`            | RFC 8291/8292 Web Push + VAPID                                             |
| In-process scheduler  | Dokploy runs a long-lived Node server; no external cron required           |

The SQLite claim/lease logic is safe if more than one container shares the same volume, but
SQLite should stay on a single writer volume (do not run replicas against a network FS).

---

## 4. Server data model

The implementation uses SQLite (`lib/server/notifications/db.ts`). The equivalent schema is:

```sql
create table push_subscriptions
(
    id              uuid primary key,
    token_hash      text        not null,                   -- SHA-256 of the bearer token
    endpoint        text        not null unique,
    p256dh          text        not null,
    auth            text        not null,
    timezone        text        not null,
    detail_level    text        not null default 'generic', -- 'generic' | 'detailed'
    consent_version text        not null,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    last_seen_at    timestamptz not null default now(),
    revoked_at      timestamptz
);

create table reminders
(
    id                 uuid primary key,
    subscription_id    uuid        not null references push_subscriptions (id) on delete cascade,
    occurrence_key     text        not null,                   -- stable client key: scheduleId@YYYY-MM-DD
    due_at             timestamptz not null,
    status     text not null default 'pending',                -- pending | sending | sent | failed | expired
    -- Generic mode: null (server builds the generic text).
    -- Detailed mode: opaque AES-GCM ciphertext; the relay cannot read it.
    payload_ciphertext text,
    payload_iv         text,
    sent_at            timestamptz,
    attempts           integer     not null default 0,
    last_error         text,
    expires_at         timestamptz not null,
    retry_at   timestamptz,                                    -- backoff for transient failures
    claimed_at timestamptz,                                    -- 5-minute sending lease
    unique (subscription_id, occurrence_key)
);

create index reminders_due_idx on reminders (status, due_at);
create index reminders_subscription_idx on reminders (subscription_id);
```

Notes:

- `endpoint` and keys are the minimum needed to call the push service.
- No medication table, no dose log table, no measurement table.
- `occurrence_key` gives idempotency: re-syncing the same day's reminder does not duplicate.
- `expires_at` (30 days after the occurrence) lets a cron prune abandoned rows.
- `claimed_at` + `status = 'sending'` prevents duplicate sends. Stale leases (older than
  5 minutes) are released on the next tick.
- `retry_at` provides exponential backoff between attempts (max 5, then `failed`).
- Keep `last_error` short and content-free (e.g. `http-410`, `http-429`, `retry`).
- The database runs in WAL mode with `busy_timeout = 5000` and foreign keys enabled.
  `NOTIFICATIONS_DB_PATH` selects the file (default `.data/notifications.sqlite`).

---

## 5. API contract

All endpoints are HTTPS + JSON. Authentication for updates/deletes is a random bearer token
returned once at registration; only its SHA-256 hash is stored. The embedded relay is
mounted at `/v1/*`; a separately hosted relay must expose the same paths.

### `GET /v1/config`

Public, no authentication. The client reads this before subscribing:

```json
{
  "configured": true,
  "vapidPublicKey": "B…",
  "maxReminders": 1000,
  "horizonDays": 30,
  "detailLevels": [
    "generic",
    "detailed"
  ],
  "schedulerEnabled": true,
  "version": 1
}
```

`configured: false` (and a `null` public key) means the deployment has no VAPID keys. The
app then keeps on-device reminders only and never contacts the relay. The VAPID **private**
key is never part of this response or the client bundle.

### `POST /v1/subscriptions`

Create or upsert a subscription. Rate limit by IP. No account required.

```json
{
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/fcm/send/…",
    "expirationTime": null,
    "keys": {
      "p256dh": "…",
      "auth": "…"
    }
  },
  "client": {
    "timezone": "Europe/Berlin",
    "appVersion": "0.1.0"
  },
  "preferences": {
    "detailLevel": "generic",
    "leadMinutes": 10
  },
  "consent": {
    "version": "2026-11-14",
    "acceptedAt": "2026-11-14T10:00:00.000Z"
  },
  "reminders": [
    {
      "occurrenceKey": "sched-1@2026-11-15",
      "dueAt": "2026-11-15T08:00:00.000Z"
    },
    {
      "occurrenceKey": "sched-1@2026-11-16",
      "dueAt": "2026-11-16T08:00:00.000Z"
    },
    {
      "occurrenceKey": "sched-1@2026-11-17",
      "dueAt": "2026-11-17T08:00:00.000Z",
      "encryptedPayload": {
        "iv": "base64url-12-byte-nonce",
        "ct": "base64url-aes-gcm-ciphertext"
      }
    }
  ]
}
```

Response `201`:

```json
{
  "subscriptionId": "uuid",
  "token": "one-time-visible-random-token"
}
```

### `PUT /v1/subscriptions/:id`

Replace timezone, preferences and the pending reminder horizon. Send every current future
occurrence (idempotent by `occurrenceKey`); the server deletes pending rows for the
subscription that are not in the payload and are still in the future. A different push
endpoint for the same subscription id returns `409`, which tells the client to create a new
subscription.

### `DELETE /v1/subscriptions/:id`

Revoke the token, delete reminder rows (cascade), and keep a tombstone so a repeated DELETE
is idempotent. Return `204`. This is what "Turn off" and "wipe" call before unsubscribing
the browser.

### `POST /v1/subscriptions/:id/test`

Send one generic test push (`"Peptimania test notification"`). Used by the Settings "Send
test push" button. Rate limit: 3 per hour per subscription, 10 per hour per IP.

### `GET /v1/health`

Liveness only; no user data. Returns `200` when the SQLite handle is readable and `503`
otherwise.

### Authentication and abuse limits

```
Authorization: Bearer <token>
```

Reject mismatched token hashes with `401`. Use constant-time comparison. Registration is
rate-limited by IP; sync, test and delete by subscription/IP. Request bodies are capped at
1 MiB and validated with Zod. Mutation requests from an `Origin` other than the app's own
must be allowlisted via `NOTIFICATIONS_ALLOWED_ORIGINS`.

---

## 6. Scheduling and delivery

### 6.1 Client → relay horizon

The client already has the occurrence engine (`lib/scheduling/occurrences.ts`). On each sync
(`lib/notifications/relay.ts`):

1. Expand active schedules over the server-advertised horizon (default **30 days**,
   `NOTIFICATIONS_HORIZON_DAYS`) with `rangeAgenda`.
2. Subtract the lead time (`notifications.leadMinutes`) from each `scheduledAt`.
3. Apply notification-centre overrides: skip `skippedAt`, replace the instant with
   `snoozeUntil`, and include occurrences only from ~15 minutes in the past onward.
4. Drop occurrences that are already logged (`status === "done"`).
5. Send concrete UTC instants (`dueAt`) — **not** recurrence rules.
6. Cap the payload at `NOTIFICATIONS_MAX_REMINDERS` (default 1,000).
7. In detailed mode, encrypt `{title, body}` per reminder and send only `{iv, ct}`.

Why concrete instants:

- No duplicated recurrence logic on the server.
- DST and timezone changes are handled by the existing local-date code.
- The relay only sees a list of instants, not medication cadence labels.

Tradeoff: if the app is not opened for the whole horizon, reminders run out. Phase 3 can add
server-side recurrence expansion (store schedule rule fields, still without medication
names) or a longer horizon.

### 6.2 Delivery tick

`instrumentation.ts` starts the in-process scheduler (`NOTIFICATIONS_SCHEDULER=1`, default).
It runs every 60 seconds (`NOTIFICATIONS_SCHEDULER_INTERVAL_MS`) and once ~5 seconds after
boot to catch up after a restart. Each tick:

1. Releases stale `sending` leases and claims due rows inside one `BEGIN IMMEDIATE`
   transaction (single-writer claim + 5-minute lease).
2. For each, calls `web-push.sendNotification` with the stored subscription and either the
   generic payload or the opaque encrypted payload.
3. Marks `sent`, or schedules a retry with exponential backoff (max 5 attempts, then
   `failed`), storing a content-free error code.
4. On `404` / `410`, revokes the subscription and deletes its reminders.
5. Periodically prunes expired/sent reminders (7 days) and revoked subscriptions (90 days).

At-least-once delivery is acceptable; the notification `tag` (`dose-<occurrenceKey>`)
replaces duplicates on the device. Set `NOTIFICATIONS_SCHEDULER=0` when an external
scheduler drives the same database instead.

### 6.3 Client sync triggers

Debounce a `syncNotifications()` call on:

- app boot (after `ensureDatabase()` and settings load);
- `visibilitychange` → visible (top up the horizon);
- schedule create / update / delete / pause;
- dose log create / delete (remove or restore reminders);
- notification settings change (lead time, detail level);
- `pushsubscriptionchange` (re-subscribe, then sync);
- after import/replace (settings may say enabled but credentials may be missing).

`syncNotifications()` must be a no-op when notifications are disabled or the relay is not
configured.

### 6.4 Reference sketches

Relay (Node + Hono + `web-push`; adapt to your stack):

```ts
import {Hono} from "hono";
import webpush from "web-push";

webpush.setVapidDetails(
    "mailto:ops@example.com",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
);

const app = new Hono();

app.post("/v1/subscriptions", async (c) => {
    const body = subscriptionSchema.parse(await c.req.json()); // zod
    const token = crypto.randomBytes(32).toString("base64url");
    const id = crypto.randomUUID();

    await db.upsertSubscription({
        id,
        tokenHash: sha256(token),
        endpoint: body.subscription.endpoint,
        p256dh: body.subscription.keys.p256dh,
        auth: body.subscription.keys.auth,
        timezone: body.client.timezone,
        detailLevel: body.preferences.detailLevel,
        consentVersion: body.consent.version,
    });
    await db.replaceReminders(id, body.reminders);

    return c.json({subscriptionId: id, token}, 201);
});

app.delete("/v1/subscriptions/:id", async (c) => {
    await requireToken(c);
    await db.deleteSubscription(c.req.param("id"));
    return c.body(null, 204);
});

// Cron: run every minute via platform scheduler.
export async function tick() {
    const due = await db.claimDueReminders({limit: 100}); // FOR UPDATE SKIP LOCKED
    for (const reminder of due) {
        try {
            const payload = reminder.payloadCiphertext
                ? JSON.stringify({
                    v: 1,
                    type: "dose-due",
                    enc: {alg: "A256GCM", iv: reminder.payloadIv, ct: reminder.payloadCiphertext},
                    tag: `dose-${reminder.occurrenceKey}`,
                    url: `/notifications?focus=${encodeURIComponent(reminder.occurrenceKey)}`,
                })
                : JSON.stringify({
                    v: 1,
                    type: "dose-due",
                    title: "Dose due",
                    body: "A scheduled dose is due.",
                    tag: `dose-${reminder.occurrenceKey}`,
                    url: `/notifications?focus=${encodeURIComponent(reminder.occurrenceKey)}`,
                });

            await webpush.sendNotification(reminder.pushSubscription, payload);
            await db.markSent(reminder.id);
        } catch (error) {
            if (isGone(error)) await db.revokeSubscription(reminder.subscriptionId);
            else await db.markRetry(reminder.id, safeErrorCode(error));
        }
    }
}
```

Client sync (phase 1):

```ts
async function syncNotifications(settings: AppSettings) {
    if (!settings["notifications.enabled"]) return;
    if (!relayUrl || !vapidPublicKey) return;

    const registration = await navigator.serviceWorker.ready;
    const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64UrlToBytes(vapidPublicKey),
        }));

    const [schedules, doseLogs] = await Promise.all([listSchedules(), listDoseLogs()]);
    const from = new Date();
    const to = addDays(from, SYNC_HORIZON_DAYS);
    const reminders = rangeAgenda(schedules, doseLogs, from, to)
        .filter((o) => o.status !== "done")
        .map((o) => ({
            occurrenceKey: o.key,
            dueAt: new Date(o.scheduledAt.getTime() - settings["notifications.leadMinutes"] * 60_000)
                .toISOString(),
        }));

    await api.put(`/v1/subscriptions/${stored.subscriptionId}`, {
        headers: {Authorization: `Bearer ${stored.token}`},
        json: {
            subscription: subscription.toJSON(),
            client: {timezone: Intl.DateTimeFormat().resolvedOptions().timeZone},
            preferences: {
                detailLevel: settings["notifications.detailLevel"],
                leadMinutes: settings["notifications.leadMinutes"],
            },
            consent: {
                version: settings["notifications.consentVersion"],
                acceptedAt: settings["notifications.consentAt"],
            },
            reminders,
        },
    });
}
```

---

## 7. Push payload contract

### Generic (default)

```json
{
  "v": 1,
  "type": "dose-due",
  "title": "Dose due",
  "body": "A scheduled dose is due.",
  "tag": "dose-sched-1@2026-11-15",
  "url": "/notifications?focus=sched-1@2026-11-15"
}
```

The relay builds this text itself; it never knows which medication it belongs to.

### Detailed (opt-in, encrypted)

```json
{
  "v": 1,
  "type": "dose-due",
  "enc": {
    "alg": "A256GCM",
    "iv": "base64url…",
    "ct": "base64url…"
  },
  "tag": "dose-sched-1@2026-11-15",
  "url": "/notifications?focus=sched-1@2026-11-15"
}
```

Encrypted plaintext:

```json
{
  "title": "BPC-157 dose due",
  "body": "250 mcg · scheduled for 8:00 AM"
}
```

The service worker:

1. reads the key from a non-exported IndexedDB store;
2. decrypts with WebCrypto;
3. calls `showNotification` with the decrypted title/body;
4. falls back to the generic text if anything fails.

### Display requirements

- `tag` = occurrence key so retries replace rather than stack.
- `renotify: true` for replacement alerts.
- `icon` / `badge` use `/icons/icon-192.png`.
- `data.url` is same-origin only; `notificationclick` focuses an existing window or opens a
  new one at that URL.
- Clicking a dose reminder lands on the notification centre and highlights the occurrence
  (`/notifications?focus=<occurrenceKey>`).

`app/sw.ts` implements `push` (with detailed-payload decryption and generic fallback),
`notificationclick` (same-origin focus/open) and `pushsubscriptionchange` (asks an open page
to re-subscribe and re-sync).

---

## 8. Implemented modules

### Client (browser)

- `lib/notifications/consent.ts` — disclosure text, version, consent validation.
- `lib/notifications/capabilities.ts` — support, permission, iOS/install detection.
- `lib/notifications/relay.ts` — runtime config, push subscription lifecycle, horizon sync,
  test push, status store and disable/unsubscribe.
- `lib/notifications/storage.ts` — non-exported IndexedDB (`peptimania-notifications`) for
  relay credentials and the AES-GCM detail key.
- `lib/notifications/detail-crypto.ts` / `base64.ts` — AES-256-GCM encryption and base64url.
- `lib/notifications/sync-events.ts` — dynamic, no-op-safe trigger used by domain services.
- `components/notifications/notification-sync.tsx` — boot/visibility/online/subscription-
  change triggers.
- `components/notifications/notification-centre.tsx` + `app/notifications/page.tsx` — due,
  upcoming and recently logged occurrences with Log / Snooze 15m / Skip / Restore.
- `components/notifications/due-banner.tsx` — dashboard due/overdue banner.
- `components/settings/notification-settings.tsx` — staged disclosure, permission, connect /
  reconnect / disable, lead time, generic vs detailed, test push, relay status.
- `components/notifications/dose-reminder-watcher.tsx` — on-device reminders while the app is
  open; honours snooze/skip overrides and links to the reminder centre.
- `app/sw.ts` — encrypted detailed payloads with generic fallback, same-origin click target,
  `pushsubscriptionchange` notification to open pages.

### Client data (`settings`, exportable)

- `notifications.enabled`, `notifications.consentAt`, `notifications.consentVersion`,
  `notifications.detailLevel`, `notifications.leadMinutes`.
- `notifications.overrides` — per-occurrence `snoozeUntil` / `skippedAt` (phase 2; additive,
  no Dexie schema change).
- Secrets are **not** settings: relay token, subscription id and AES key live only in
  `peptimania-notifications` and are erased by wipe.

### Server (`lib/server/notifications`, `app/v1/[...path]/route.ts`)

- `config.ts` — env parsing (VAPID, DB path, limits, retention, scheduler).
- `db.ts` — `node:sqlite` schema, token hashing, reminder replacement, claim/lease, retry,
  revocation, pruning.
- `schemas.ts` — Zod request validation.
- `auth.ts` / `cors.ts` / `rate-limit.ts` — bearer auth, origin allowlist, fixed-window limits.
- `push.ts` — `web-push` delivery, generic + detailed payloads, gone/retry classification.
- `service.ts` — create/update/delete/test, horizon sanitising, one delivery tick.
- `scheduler.ts` + `instrumentation.ts` — in-process minute timer.

### Configuration

| Variable                                    | Default                          | Purpose                                          |
|---------------------------------------------|----------------------------------|--------------------------------------------------|
| `VAPID_PUBLIC_KEY`                          | —                                | Enables the relay; exposed via `/v1/config`      |
| `VAPID_PRIVATE_KEY`                         | —                                | Server-only signing key                          |
| `VAPID_SUBJECT`                             | `mailto:notifications@localhost` | Web Push contact (`mailto:` / `https:`)          |
| `NOTIFICATIONS_DB_PATH`                     | `.data/notifications.sqlite`     | SQLite file (Dokploy: `/data/...`)               |
| `NOTIFICATIONS_ALLOWED_ORIGINS`             | —                                | Extra origins allowed to call mutation endpoints |
| `NOTIFICATIONS_SCHEDULER`                   | `1`                              | In-process delivery timer                        |
| `NOTIFICATIONS_SCHEDULER_INTERVAL_MS`       | `60000`                          | Tick interval (10s–1h)                           |
| `NOTIFICATIONS_MAX_REMINDERS`               | `1000`                           | Sync cap                                         |
| `NOTIFICATIONS_HORIZON_DAYS`                | `30`                             | Horizon advertised to clients                    |
| `NOTIFICATIONS_SUBSCRIPTION_RETENTION_DAYS` | `90`                             | Revoked-subscription tombstone retention         |
| `NOTIFICATIONS_SENT_RETENTION_DAYS`         | `7`                              | Delivered-reminder retention                     |
| `NEXT_PUBLIC_NOTIFICATION_RELAY_URL`        | same origin                      | Optional external relay base URL                 |

Without VAPID keys the app builds and runs normally: `/v1/config` returns
`configured: false`, Settings explains that background delivery is unavailable, and only
on-device reminders are offered. The VAPID private key is never a `NEXT_PUBLIC_*` variable
and is never included in the client bundle.

### Phase 3 — optional / deferred

- Server-side recurrence expansion for users who do not open the app for weeks.
- Notification action buttons (Log / Snooze) that open the app with a query parameter.
- Long-horizon sync and richer operational dashboards (aggregate counts only).

## 9. UX states

| State                                       | Settings card                                                             |
|---------------------------------------------|---------------------------------------------------------------------------|
| Relay not configured                        | Consent + on-device reminders; note background delivery is unavailable    |
| Supported, permission default               | Consent checkbox → Enable → browser prompt                                |
| Permission granted, enabled                 | Enabled badge, lead-time select, detail mode, test, turn off              |
| Permission denied                           | Blocked message + browser-settings instructions; enable disabled          |
| iOS not installed                           | "Add to Home Screen first" message; enable disabled                       |
| Relay error on enable                       | Permission/consent kept, `enabled` stays false, retry button; error toast |
| Import restored `enabled=true` but no token | Re-subscribe or show "Reconnect notifications"                            |
| Wipe                                        | Best-effort relay delete, then local wipe                                 |

Accessibility: the disclosure is plain text (no hidden legalese), the checkbox has a visible
label, statuses use `role="alert"` for errors, and the enable button is a real user gesture
(Safari/iOS requires this for `requestPermission`).

---

## 10. Security checklist

- VAPID private key only in the relay's secret manager; never in the PWA bundle.
- HTTPS everywhere; HSTS on the relay.
- Bearer token: 256-bit random, stored hashed, constant-time comparison.
- CORS allowlist the app origin; reject unknown origins on mutation endpoints.
- Validate all bodies with Zod (or equivalent); cap reminders per request and body size.
- Rate limit registration, updates and test sends by IP + subscription.
- Do not log endpoints, keys, payloads or medication content. Scrub error messages.
- Encrypt the database at rest; restrict operator access.
- Prune inactive subscriptions (e.g. 90 days) and sent reminders (7 days).
- Dependency updates for `web-push`; monitor Web Push protocol changes.
- Document that the push service (FCM/APNs/Mozilla) is also a third party in the delivery
  path.

---

## 11. Testing

### Unit / smoke (local)

- `hasCurrentNotificationConsent` version and timestamp behavior.
- `getNotificationSupport` branches (unsupported, insecure, iOS not installed, denied).
- Reminder expansion / dedupe map / lead window in `dose-reminder-watcher`.
- Base64url VAPID conversion.
- AES-GCM encrypt/decrypt round trip (phase 2).
- Settings parsers reject invalid rows and preserve consent on reset.

### Server

- Subscription create/update/delete auth and token hashing.
- Idempotent reminder sync; stale pending rows removed.
- Cron claims rows once; retries; 410 cleanup; no duplicate sends.
- Rate limits and payload validation.
- Generic payload contains no medication data.

### Manual device matrix

- Chrome Android (installed and browser tab).
- Safari iOS 16.4+ installed PWA (permission, push, click).
- Chrome/Firefox/Safari desktop.
- Permission denied, then re-allowed in browser settings.
- Offline app open, then online.
- Disable → relay row deleted; re-enable → new subscription.
- Wipe → relay delete attempted, local keys removed.
- Import/replace with notifications enabled.

---

## 12. Rollout status

1. **Phase 0 — done:** consent UI, on-device reminders, service-worker display handlers.
2. **Phase 1 — done:** embedded relay, VAPID keys (server-side only), generic push,
   subscription lifecycle, deletion endpoint, in-process delivery tick.
3. **Phase 2 — done:** end-to-end encrypted detailed mode, notification centre, dashboard
   banner, snooze/skip overrides, sync lifecycle, encrypted SW decryption.
4. **Phase 3 — optional/deferred:** server-side recurrence, notification actions, operational
   dashboards.

Every phase preserves: the app works offline, the app works with notifications off, no
medication data in server logs, and one-tap disable.

---

## 13. Deployment (Dokploy)

The app is a single Node container; the relay is part of it.

1. Create an application from this repository (Dockerfile build) and expose port `3000`.
2. Add a **persistent volume** mounted at `/data` (owned by uid `1000` / the `node` user if
   using a host bind mount). The SQLite file, WAL and SHM files live there.
3. Set the environment variables:
    - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (from `npm run vapid:generate`),
    - `VAPID_SUBJECT=mailto:you@example.com`,
    - `NOTIFICATIONS_DB_PATH=/data/notifications.sqlite` (already the Docker default).
4. Configure the health check as `GET /v1/health` (the image also has a Docker
   `HEALTHCHECK`).
5. Serve the app over HTTPS. Web Push requires a secure context; installed iOS PWAs also
   require HTTPS.

The image runs `node:26-bookworm-slim`, builds with `npm run build` and starts with
`next start`. Serwist writes `public/sw.js` after `next build`; the Docker image copies the
built `public/` and `.next/` into the runtime stage.

Local equivalent:

```bash
cp .env.example .env.local   # fill VAPID keys; use .data/ for the DB
npm run build
npm start                    # http://localhost:3000
```

Back up `/data/notifications.sqlite` if you want to preserve subscriptions across a
migration. Losing it only forces devices to re-subscribe on their next sync; it contains no
medication or dose history.

---

## 14. Open decisions

- Whether to add server-side recurrence expansion (phase 3) before the 30-day horizon
  becomes a problem for users who rarely open the app.
- Notification action buttons (Log / Snooze) and their deep-link contract.
- External scheduler vs the in-process timer for multi-instance deployments.
- Re-consent cadence (current: only when the disclosure version changes).
