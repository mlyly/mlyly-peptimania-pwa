# Notifications — server + client implementation plan

Status: **phase 0 implemented** (settings consent, on-device reminders, service-worker
display handlers). Phases 1–3 are planned below.

The app is a static export (`output: "export"`), so it cannot host API routes. Background
notifications therefore need a **separate relay service**. This document defines that
service, the client protocol, the privacy contract and the rollout.

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
┌──────────────────────────────┐
│ Peptimania PWA (static)      │
│                              │
│ IndexedDB: meds, schedules,  │
│ logs, settings, push key     │
│                              │
│ lib/notifications            │
│  - consent / capability      │
│  - subscription lifecycle    │
│  - reminder expansion        │
└──────────────┬───────────────┘
               │ HTTPS (subscribe / sync / delete)
               ▼
┌──────────────────────────────┐
│ Notification relay           │
│                              │
│  API (Hono/Fastify)          │
│  Postgres/SQLite             │
│  VAPID keys (secret)         │
│  cron tick every minute      │
└──────────────┬───────────────┘
               │ Web Push (RFC 8291/8292)
               ▼
┌──────────────────────────────┐
│ Browser push service         │
│ (FCM / APNs / Mozilla)       │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ Service worker `push` event  │
│ → showNotification           │
│ → click focuses/opens app    │
└──────────────────────────────┘
```

### Recommended server stack

| Option                                             | Fit             | Notes                                                                                         |
|----------------------------------------------------|-----------------|-----------------------------------------------------------------------------------------------|
| **Node 26 + Hono/Fastify + Postgres + `web-push`** | **Recommended** | Simple Web Push support, easy cron, portable. Deploy on Fly.io, Render or Railway.            |
| Cloudflare Worker + D1 + Cron Triggers             | Good            | Cheap, global, but needs a Worker-compatible Web Push implementation and careful crypto code. |
| Supabase Edge Functions + pg_cron                  | Possible        | More moving parts; reuse Postgres.                                                            |

The relay is a separate deployable (e.g. `notifications-server/` or its own repo). It must
not be served from the static app's host, because the app has no server runtime.

---

## 4. Server data model

Postgres example (SQLite equivalents are fine):

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
    status             text        not null default 'pending', -- pending | sent | failed | expired
    -- Generic mode: null (server builds the generic text).
    -- Detailed mode: opaque AES-GCM ciphertext; the relay cannot read it.
    payload_ciphertext text,
    payload_iv         text,
    sent_at            timestamptz,
    attempts           integer     not null default 0,
    last_error         text,
    expires_at         timestamptz not null,
    unique (subscription_id, occurrence_key)
);

create index reminders_due_idx on reminders (due_at) where status = 'pending';
```

Notes:

- `endpoint` and keys are the minimum needed to call the push service.
- No medication table, no dose log table, no measurement table.
- `occurrence_key` gives idempotency: re-syncing the same day's reminder does not duplicate.
- `expires_at` (e.g. 30 days after the occurrence) lets a cron prune abandoned rows.
- Keep `last_error` short and content-free (e.g. `410 gone`, `429 rate limited`).

---

## 5. API contract

All endpoints are HTTPS + JSON. Authentication for updates/deletes is a random bearer token
returned once at registration; only its SHA-256 hash is stored.

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
subscription that are not in the payload and are still in the future.

### `DELETE /v1/subscriptions/:id`

Revoke the token, delete reminder rows (cascade), and mark the subscription deleted. Return
`204`. This is what "Turn off" calls after `pushManager.unsubscribe()`.

### `POST /v1/subscriptions/:id/test`

Send one generic test push (`"Notifications are working."`). Useful for the Settings "Send
test" button once the relay is live. Rate limit: 3 per hour.

### `GET /v1/health`

Liveness only; no user data.

### Authentication

```
Authorization: Bearer <token>
```

Reject mismatched token hashes with `401`. Use constant-time comparison.

---

## 6. Scheduling and delivery

### 6.1 Client → relay horizon

The client already has the occurrence engine (`lib/scheduling/occurrences.ts`). On each sync:

1. Expand active schedules for the next **14–30 days** with `expandSchedules`.
2. Subtract the lead time (`notifications.leadMinutes`) from each `scheduledAt`.
3. Drop occurrences that are already logged (`matchingDoseLog`).
4. Send concrete UTC instants (`dueAt`) — **not** recurrence rules.
5. Cap the payload (e.g. 1,000 reminders) and chunk if needed.

Why concrete instants:

- No duplicated recurrence logic on the server.
- DST and timezone changes are handled by the existing local-date code.
- The relay only sees a list of instants, not medication cadence labels.

Tradeoff: if the app is not opened for the whole horizon, reminders run out. Phase 3 can add
server-side recurrence expansion (store schedule rule fields, still without medication
names) or a longer horizon.

### 6.2 Cron tick

Run every minute (platform scheduler or a small always-on worker):

1. Claim due rows with `FOR UPDATE SKIP LOCKED` (or a single-writer lease).
2. For each, call `web-push.sendNotification` with the stored subscription and a generic
   payload, or the opaque encrypted payload for detailed mode.
3. Mark `sent` / `failed`, increment `attempts`, store a content-free error.
4. On `404` / `410`, mark the subscription revoked and delete its reminders.
5. On `429` / `5xx`, retry with exponential backoff (max ~5 attempts, then `failed`).
6. Prune `sent` rows after 7 days and `expired` rows after their `expires_at`.

At-least-once delivery is acceptable; the notification `tag` (`dose-<occurrenceKey>`)
replaces duplicates on the device.

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
                    url: `/?focus=${encodeURIComponent(reminder.occurrenceKey)}`,
                })
                : JSON.stringify({
                    v: 1,
                    type: "dose-due",
                    title: "Dose due",
                    body: "A scheduled dose is due.",
                    tag: `dose-${reminder.occurrenceKey}`,
                    url: `/?focus=${encodeURIComponent(reminder.occurrenceKey)}`,
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
  "url": "/?focus=sched-1@2026-11-15"
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
  "url": "/?focus=sched-1@2026-11-15"
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
- Clicking a dose reminder should land on the dashboard/schedules and highlight the
  occurrence (`?focus=<occurrenceKey>`).

The `push` and `notificationclick` handlers are already added to `app/sw.ts`. Phase 2 adds
decryption and `pushsubscriptionchange`.

---

## 8. Client implementation plan

### Already in place (phase 0)

- `lib/notifications/consent.ts` — disclosure text, version, consent validation.
- `lib/notifications/capabilities.ts` — support, permission, iOS/install detection.
- `lib/settings/definitions.ts` — `notifications.*` settings (no schema bump; `settings` is
  generic and export/import already includes it).
- `components/settings/notification-settings.tsx` — disclosure, checkbox, permission
  request, enable/disable, lead time, detail level, test notification.
- `components/notifications/dose-reminder-watcher.tsx` — while the app is open, checks the
  local schedule every 30 s and shows a toast (visible) or a system notification (hidden).
- `app/sw.ts` — `push` display + `notificationclick` handlers.

### Phase 1 — relay + generic push

Add `lib/notifications/subscription.ts`:

- Convert the VAPID public key (base64url) to `Uint8Array`.
- `navigator.serviceWorker.ready` → `pushManager.subscribe({userVisibleOnly: true,
  applicationServerKey})`.
- `POST /v1/subscriptions` with the subscription, timezone, preferences and reminders.
- Persist `{subscriptionId, token, endpoint}` in a **non-exported** local store (dedicated
  IndexedDB store or localStorage; never the exported `settings` table).
- `DELETE` + `pushManager.unsubscribe()` on disable/wipe.
- Re-sync on `pushsubscriptionchange`.

Configuration:

```
NEXT_PUBLIC_NOTIFICATION_RELAY_URL=https://notify.example.com
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<base64url public key>
```

Keep the feature visible but disabled when either variable is missing, with a clear
"Background delivery is not configured in this build" state. The app must remain fully
functional without the relay.

### Phase 2 — encrypted details + notification centre

- AES-GCM key generation/storage in a non-exported IndexedDB store.
- Encrypt detailed reminders client-side; decrypt in the service worker.
- Add an in-app **notification centre** page (local only) that lists recent and upcoming
  occurrences, with "Log dose", "Snooze 15 min" and "Skip today" actions. All actions write
  to the local DB; nothing is sent to the relay except the updated reminder horizon.
- Add a dashboard banner for due/overdue doses when notifications are enabled.
- Handle `?focus=<occurrenceKey>` on the dashboard/schedules.

### Phase 3 — server-side recurrence and richer actions

- Let the relay expand recurring schedule rules for users who don't open the app for weeks.
  Store only the cadence fields needed (`timeOfDay`, weekdays, interval, cycle, timezone),
  never medication names.
- Optional notification action buttons (`Log dose`, `Snooze`) that open the app with a
  query parameter; the API is not called from the notification action directly.
- Long-horizon sync and “last synced” indicator in Settings.

---

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

## 12. Rollout

1. **Phase 0 (this change):** consent UI + on-device reminders + SW display handlers. No
   server calls. Ship behind the existing default-off setting.
2. **Phase 1:** deploy relay with generic push, VAPID keys, cron, deletion endpoint. Enable
   via build env. Monitor delivery failures and 410 rate.
3. **Phase 2:** encrypted detailed mode and in-app notification centre. Keep generic as the
   default.
4. **Phase 3:** long-horizon recurrence, snooze/actions, operational dashboards (aggregate
   counts only).

Each phase must preserve: app works offline, app works with notifications off, no user data
in server logs, and one-tap disable.

---

## 13. Open decisions

- Relay hosting: Fly.io/Render (Node) vs Cloudflare Worker + D1.
- Generic-only first launch vs detailed encrypted mode in phase 1.
- Sync horizon (14 vs 30 days) and whether to add server-side recurrence sooner.
- Whether the notification centre is a new route or a dashboard sheet.
- Retention windows for subscription and delivery records.
- Re-consent cadence (current plan: only when the disclosure version changes).
