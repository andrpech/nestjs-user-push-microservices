# Plan: Notifications v2

> Source PRD: [`docs/prds/prd-notifications-v2.md`](../prds/prd-notifications-v2.md)

## Architectural decisions

Durable decisions that apply across all phases.

### Rollout posture

- v2 is breaking. No dual-write, no parallel-read, no backfill.
- `make nuke` is the canonical reset between phases in dev. No production data exists.
- The three deployable apps (`users`, `notifier`, `scheduler`) and their replica counts (2/2/1) do not change.

### Routes

- `POST /users` — unchanged contract.
- Health: `/lhealth`, `/rhealth` — unchanged.
- Admin (notifier app, behind internal network):
  - `GET /admin/notifications` — gains optional `type` and `channel` query filters; existing `status`, `limit`, `cursor` continue to work.
  - `GET /admin/notifications/:id` — response shape evolves: same row fields **minus** the dropped `history` JSON, **plus** a `history: NotificationHistoryEntry[]` joined from `notification_history`.
  - `POST /admin/notifications/:id/retry` — semantics unchanged; appends a `MANUAL_RETRY` history row in the new table.
  - `POST /admin/dlq/inbox/republish` — semantics unchanged; the DLQ now holds ingest-path failures rather than `user.created` failures.

### Broker topology

- New exchange: `notifications.ingest` (topic). Producers publish here with routing key `ingest.<type>` (e.g. `ingest.user-welcome`).
- New queue: `notifier.ingest` bound to `notifications.ingest` with routing pattern matching `ingest.*` (or `ingest.#`).
- Removed: `users.events` exchange and its `user.created` binding into the notifier.
- Unchanged: `notifications.work`, `notifications.retry.events`, `notifications.retry.work`, `notifications.dlx`, `system.cron`.

### Schema

**`users` database**

- `users` — domain only. Columns: `id`, `name`, `created_at`. Drops `published_at` and `publishing_started_at`.
- `users_outbox` — new. Columns: `id` (ULID PK), `aggregate_id` (FK `users.id`), `event_type`, `payload` (Json), `source_event_id` (ULID, set in same tx as the row), `published_at` (nullable), `publishing_started_at` (nullable), `created_at`.
- Partial index on `users_outbox(created_at) WHERE published_at IS NULL AND publishing_started_at IS NULL`.

**`notifications` database**

- `notifications` — work + state only. Columns: `id` (ULID PK), `type`, `source_event_id`, `recipient` (Json), `params` (Json), `channel`, `scheduled_for` (TIMESTAMPTZ), `status`, `attempts`, `processing_started_at`, `redrive_count`, `last_redriven_at`, `last_error`, `sent_at`, `created_at`, `updated_at`. `UNIQUE(type, source_event_id)`. The old `userId @unique`, `name`, and `history` JSON column are gone.
- `notification_history` — new. Columns: `id` (ULID PK), `notification_id` (FK `notifications.id`), `at`, `event_type`, `payload` (Json). Append-only.
- Partial index on `notifications(scheduled_for) WHERE status='PENDING'`.
- Partial index on `notifications(processing_started_at) WHERE status='PROCESSING'`.

### Key models / modules

- **`TypeCatalog`** (notifier, code): TS registry keyed by `type` string. Each entry: `{ paramsSchema, render, channel, defaultDelayMs, retryPolicy: { maxAttempts, backoff, baseMs, jitter } }`. Single source of truth for type semantics.
- **`NotificationTransport`** (notifier, code): interface `{ send(envelope): Promise<TransportResult> }`. Concrete adapters: `WebhookTransport`, `EmailTransport` (stub), `SmsTransport` (stub). Decorators: `RateLimitedTransport`, `CircuitBreakerTransport`. Test fixture: `FakeTransport`. Per-channel composed stack registered through a `TransportRegistry` DI token.
- **`NotificationsRepository`** (notifier): thin SQL surface for `notifications` and `notification_history`. No business logic.
- **`NotificationStateMachine`** (notifier): owns all status transitions and history-append; transactional verdict for send outcomes. Consumes the repository.
- **`UsersOutboxRepository`** (users): thin SQL surface for `users_outbox`. Enqueue, claim, sweep-stuck, mark-published.

### Idempotency invariant

- `source_event_id` is a ULID generated **inside the producing transaction** at the row that owns the event (`users_outbox.source_event_id`). It is carried unchanged through every retry, redelivery, and outbox republish.
- The notifier enforces dedup via `UNIQUE(type, source_event_id)`. On constraint violation the ingest path returns the existing row and logs `deduped: true`.

### Ingest event contract

- Payload (zod-validated at the consumer): `{ type: string, sourceEventId: string, scheduledFor?: string (ISO), recipient: { email?, phone?, pushToken?, userId? }, params: Json }`.
- `channel` is **not** in the payload; it is resolved from `TYPE_CATALOG[type].channel` by the ingest consumer and persisted on the row.

### Metrics

- All notification counters/histograms carry labels `{ type, channel }`. `notifications_failed_total` additionally carries `reason`.
- Ingest-path failures: `notifications_ingest_failed_total{reason}` (`unknown_type`, `params_invalid`, `db_error`).
- Cardinality bounded by type catalog size (<50) × channel set (<5).

### CB-open behavior (codified across phases)

- `CircuitBreakerTransport` throws `CircuitOpenError` when open.
- `SendNotificationConsumer` catches it, NACKs with a long expiration (~30s via the retry exchange), does **not** increment `attempts`, does **not** append history, leaves status as `PROCESSING`. Stuck-recovery is the safety net for crashes during this nack.

### Testing posture

- `vitest` introduced for the first time in this repo as part of Phase 1.
- Focus tests cover four deep modules: `TypeCatalog`, `NotificationStateMachine`, `NotificationTransport` decorators (rate-limit, circuit breaker, `Retry-After` parsing), `UsersOutboxRepository`.
- State-machine and repository tests run against a real Postgres (assumes `make infra-up`). Decorator tests use `FakeTransport`. `WebhookTransport` parsing tests use a local fastify-based fake; no `global.fetch` mocking.
- Consumers, controllers, producers, health, DI wiring — verified by smoke only, per `PRD v1` posture.

### Producer-side rule (users service)

- `CreateUserCommand` inserts `users` row and `users_outbox` row in one Prisma transaction.
- The outbox row's `payload` carries the full ingest envelope: `{ type: 'USER_WELCOME', sourceEventId: <outbox.source_event_id>, recipient: { userId }, params: { name } }`.
- `ClaimAndPublishUsersCommand` operates on `users_outbox` instead of `users`. Publish target: `notifications.ingest` with routing key `ingest.user-welcome`.

---

## Phase 1: V2 tracer bullet — new schema, generic ingest, minimal send path

**User stories**: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 21, 22, 23, 24, 25, 27, 28, 30, 31, 32, 33, 35, 36, 37, 38; partial 34.

### What to build

The end-to-end v2 path with a single notification type wired in. A `POST /users` request causes a row to land in `users` and a sibling row in `users_outbox` in one transaction. The users-side outbox cron claims the outbox row, publishes an ingest envelope to `notifications.ingest` with routing key `ingest.user-welcome`, and marks the row published. The notifier's `IngestConsumer` (single consumer, generic route binding) validates the envelope against `TYPE_CATALOG['USER_WELCOME'].paramsSchema`, resolves `channel` and `scheduled_for`, and inserts a `notifications` row plus a `CREATED` entry in `notification_history`, all dedup'd by `UNIQUE(type, source_event_id)`. The notifier's cron tick (`NotifierCronConsumer` against `cron.notifier`) drives `ClaimDueNotificationsCommand` through the state machine to transition `PENDING → PROCESSING` (with a `CLAIMED_BY_TICK` history row) and dispatches a `push.send` work message. The `SendNotificationConsumer` reads the row, calls a `WebhookTransport` (raw `fetch` behind a class boundary, **no** interface or decorators yet), and routes the outcome through `RecordSendAttemptCommand` — a single command that does the increment-or-finalize work in one transaction and appends the appropriate history row.

The cut over is total: the old `UserCreatedConsumer`, the old `CreateNotificationCommand` with `userId` dedup, the four split `Mark*` commands, the `history` JSON column, the `name` column on `notifications`, the `published_at`/`publishing_started_at` columns on `users`, and the `users.events` exchange/binding are all deleted in this phase.

`vitest` is introduced as part of this phase. Focus tests cover the three deep modules that land in Phase 1: `TypeCatalog` (params validation, render output), `NotificationStateMachine` (ingest dedup, claim transitions, terminal-vs-retry verdict from `recordAttempt`, stuck-recovery), and `UsersOutboxRepository` (enqueue/claim/mark idempotency under SKIP LOCKED).

### Acceptance criteria

- [ ] New schema applied via Prisma migrations: `users` (domain only), `users_outbox`, `notifications` with `UNIQUE(type, source_event_id)`, `notification_history`. Old columns and old unique constraints are gone.
- [ ] Both required partial indexes exist on `users_outbox` and on `notifications` (one for `status='PENDING'`, one for `status='PROCESSING'`).
- [ ] `CreateUserCommand` writes `users` row and `users_outbox` row in one transaction, with `source_event_id` ULID set on the outbox row.
- [ ] `ClaimAndPublishUsersCommand` reads from `users_outbox` and publishes to `notifications.ingest` with the v2 envelope shape; the old `users.events` exchange is no longer asserted.
- [ ] `TYPE_CATALOG` contains exactly one entry (`USER_WELCOME`) with `paramsSchema`, `render`, `channel='webhook'`, `defaultDelayMs`, and `retryPolicy` populated.
- [ ] `IngestConsumer` is the only ingest-side consumer; it parses the envelope, validates `params` against the type's schema, inserts a `notifications` row plus a `CREATED` history row, and acks. Unknown type, invalid params, or repeated processing failure lands in `notifications.dlx`.
- [ ] `NotificationsRepository` and `NotificationStateMachine` are the only paths that touch `notifications` and `notification_history` SQL outside of tests. Consumers and use-case commands do not call Prisma directly.
- [ ] `RecordSendAttemptCommand` runs the increment + optional terminal-FAILED transition in one `$transaction`, returning a verdict that the consumer acts on. There is no remaining two-update split.
- [ ] Re-publishing the same `users_outbox` row after a simulated crash produces no duplicate `notifications` row.
- [ ] Smoke: `curl -X POST /users -d '{"name":"smoke"}'` results in exactly one `notifications` row, one `PUSH_SENT` entry in `notification_history`, status `SENT`, and one webhook POST observed at the receiver.
- [ ] `vitest` runs in CI / locally. Focus tests pass for `TypeCatalog`, `NotificationStateMachine`, and `UsersOutboxRepository`.
- [ ] All removed-code listed above (UserCreatedConsumer, split commands, history JSON, `users.events`) is gone from the repo — no dead exports, no commented-out blocks.

---

## Phase 2: Transport interface + decorators + circuit breaker + rate limit + `Retry-After`

**User stories**: 14, 15, 16, 17, 18, 19, 20; partial 34.

### What to build

The webhook send path acquires a real abstraction and the safety guarantees the PRD calls for. `NotificationTransport` becomes an explicit interface; the existing `WebhookTransport` is refactored to implement it without changing its delivery semantics. Stub implementations for `EmailTransport` and `SmsTransport` ship so the DI map is complete — they reject calls with a clear "not configured" error, exercising the path where a notification of unsupported channel terminates cleanly. `RateLimitedTransport` (backed by `p-limit`) and `CircuitBreakerTransport` (backed by `opossum`) are introduced as decorators composed at module wiring: each channel's stack is `Circuit → RateLimit → Real`. A `TransportRegistry` DI token resolves `channel → transport`, and `SendNotificationConsumer` looks up the right one per notification.

The send consumer learns to distinguish two failure modes that were merged in Phase 1. A `CircuitOpenError` thrown by the breaker means "downstream is unreachable, do not even try" — the consumer NACKs with a long expiration onto the existing retry exchange, **does not** call `RecordSendAttemptCommand`, **does not** append history, and leaves the row in `PROCESSING`. Any other `TransportResult` (success or non-circuit failure) flows through `RecordSendAttemptCommand` as in Phase 1. `WebhookTransport` parses `Retry-After` (seconds form and HTTP-date form), surfaces it via `result.retryAfterMs`, and the consumer uses `result.retryAfterMs ?? typeCatalog.retryPolicy.computeBackoff(attempts)` to pick the next backoff. The `retryPolicy` shape (`maxAttempts`, `backoff`, `baseMs`, `jitter`) gets a small helper that turns those fields into a milliseconds value.

`FakeTransport` is introduced as a test fixture. Focus tests cover the decorator behaviors and the `Retry-After` parser. Other parts of the system (state machine, repository) remain unchanged from Phase 1.

### Acceptance criteria

- [ ] `NotificationTransport` interface is declared and is the only type the send command depends on.
- [ ] `WebhookTransport`, `EmailTransport` (stub), `SmsTransport` (stub) all implement it.
- [ ] `RateLimitedTransport` enforces a configurable per-channel concurrency limit; a burst above the limit serializes observably.
- [ ] `CircuitBreakerTransport` opens after the configured failure threshold and surfaces `CircuitOpenError` without invoking the inner transport.
- [ ] `TransportRegistry` is the only thing `SendNotificationConsumer` knows about — it does not import a concrete transport class.
- [ ] On `CircuitOpenError`, the consumer NACKs with the configured expiration and **does not** increment `attempts`, write `last_error`, or append history; the row stays in `PROCESSING` and is observable via admin GET.
- [ ] On any non-circuit transport result, `RecordSendAttemptCommand` runs unchanged from Phase 1.
- [ ] `WebhookTransport` parses `Retry-After` in both seconds and HTTP-date forms; the value reaches the consumer via `TransportResult.retryAfterMs` and is used as the next backoff when present.
- [ ] `retryPolicy` fields are honored from `TYPE_CATALOG`; changing `maxAttempts` for `USER_WELCOME` changes how many attempts before terminal-FAILED.
- [ ] Focus tests pass for `RateLimitedTransport`, `CircuitBreakerTransport`, and `WebhookTransport`'s `Retry-After` parsing (using a local fastify-based fake, not `global.fetch` mocks).
- [ ] Smoke: pointing `PUSH_WEBHOOK_URL` at a closed port produces `CircuitOpenError` after the failure threshold; the affected notifications stay `PROCESSING` with bounded `attempts`, and recover automatically once the receiver comes back up.

---

## Phase 3: Operability v2 — admin filters, history join, labeled metrics

**User stories**: 26, 29.

### What to build

Admin endpoints and Prometheus output gain the multi-type-aware shape the PRD specifies. `GET /admin/notifications` accepts optional `type` and `channel` query parameters in addition to the existing `status`, `limit`, `cursor`. `GET /admin/notifications/:id` joins `notification_history` and returns a `history: NotificationHistoryEntry[]` array alongside the row fields — replacing the `history` JSON column that no longer exists on `notifications`. `POST /admin/notifications/:id/retry` continues to flip `FAILED → PENDING`, but the `MANUAL_RETRY` audit entry is now an insert into `notification_history` rather than a JSON append. `POST /admin/dlq/inbox/republish` behaves as before, with the DLQ now keyed on ingest-path failures.

Every notification-related Prometheus metric gains `{ type, channel }` labels. `notifications_failed_total` additionally carries `reason` (already labeled in v1 but constants change to reflect the v2 reason taxonomy). A new ingest-path counter `notifications_ingest_failed_total{reason}` covers `unknown_type`, `params_invalid`, `db_error`. The existing Grafana provisioning files are updated to use the new labels in queries that previously had no `type` dimension; a couple of demo panels filtered by `type='USER_WELCOME'` ship so the labeling is exercised end-to-end.

No new deep modules — this phase is wiring through the existing `NotificationsRepository`, the existing admin controllers, and the metrics service.

### Acceptance criteria

- [ ] `GET /admin/notifications?status=FAILED&type=USER_WELCOME&channel=webhook` returns the filtered subset; absent filters behave as before.
- [ ] `GET /admin/notifications/:id` response includes a populated `history` array from `notification_history`, ordered by `at`; field names match the new schema.
- [ ] `POST /admin/notifications/:id/retry` appends a row to `notification_history` with `event_type='MANUAL_RETRY'`.
- [ ] All notification counters and histograms expose `type` and `channel` labels on `/metrics`; cardinality is bounded by the type catalog size.
- [ ] `notifications_ingest_failed_total{reason}` exposes the three documented reasons; sending a payload with an unknown type increments `unknown_type`; sending a payload with a malformed `params` increments `params_invalid`.
- [ ] Grafana dashboards updated so that a `type` template variable filters all notification panels; default view shows `USER_WELCOME` data.
- [ ] Smoke: triage a deliberately-failed notification through admin endpoints end to end — list filtered by `status=FAILED`, fetch by id with `history`, retry, observe `MANUAL_RETRY` history entry and eventual `SENT`.

---

## Phase 4: Multi-type proof

**User stories**: 7, 32, 36 (validation in vivo); partial 1.

### What to build

A second entry in `TYPE_CATALOG` to actually exercise the multi-type architecture built across Phases 1-3. The chosen second type is a low-risk synthetic — `SAMPLE_PING` — with a distinct `paramsSchema` (e.g. `{ message: string }`), its own `render`, `channel='webhook'`, a different `defaultDelayMs` and `retryPolicy` from `USER_WELCOME` so per-type configurability is observably tested. A minimal producer for this type ships as an admin-only endpoint `POST /admin/notifications/sample` (body: `{ recipient: { userId }, params: { message } }`) that publishes an ingest envelope with `type='SAMPLE_PING'` and a server-generated `sourceEventId` directly into `notifications.ingest`. No new producer service or upstream signal is required.

The phase validates two PRD claims end to end: (a) a user can hold both a `USER_WELCOME` row and a `SAMPLE_PING` row simultaneously — `UNIQUE(type, source_event_id)` does not falsely dedup across types; (b) per-type configuration actually flows through — the second type's `defaultDelayMs` and `retryPolicy` are honored at claim and retry time. A few targeted tests on `TypeCatalog` (multi-entry lookup, unknown-type rejection) and the existing state machine tests (run against both types) confirm the wiring.

No new deep modules. No infrastructure changes. The phase exists specifically to prove the architecture works the way the PRD promises, before declaring v2 done.

### Acceptance criteria

- [ ] `TYPE_CATALOG` contains two entries (`USER_WELCOME`, `SAMPLE_PING`) with non-overlapping `paramsSchema`, distinct `defaultDelayMs`, distinct `retryPolicy.maxAttempts`.
- [ ] `POST /admin/notifications/sample` publishes a valid ingest envelope to `notifications.ingest` and returns the resulting `notificationId`.
- [ ] Smoke: `POST /users` followed by `POST /admin/notifications/sample` for the same `userId` produces two distinct `notifications` rows that both reach `SENT`; the admin `list` filtered by `type=SAMPLE_PING` returns the second one and not the first.
- [ ] Smoke: sending `POST /admin/notifications/sample` twice with the same `sourceEventId` produces exactly one row (proving the new dedup); sending it twice with different `sourceEventId` produces two rows.
- [ ] Smoke: configuring a different `maxAttempts` for `SAMPLE_PING` than for `USER_WELCOME` is observable — pointing the webhook at a permanent-failure receiver causes `SAMPLE_PING` to terminate at its own attempt limit, independently of `USER_WELCOME`.
- [ ] No regressions on the Phase 1 smoke path (a fresh user still receives a `USER_WELCOME` push end to end).
