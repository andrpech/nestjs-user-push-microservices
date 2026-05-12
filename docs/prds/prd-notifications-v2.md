# PRD: Notifications v2 — Multi-type, Decoupled Outbox/Inbox, Pluggable Transport

## Problem Statement

The current notification service ships exactly one notification type ("welcome push 24h after signup"), and its design encodes that single use case at every layer. A product engineer asked to add a second type — say `PASSWORD_CHANGED` — discovers it is not a feature, it is a rewrite. Eight specific leaks make the system rigid and unsafe:

1. **Idempotency is fused to the domain model.** A `UNIQUE(userId)` constraint on `notifications` codes the business rule "one notification per user, ever" into the schema. A legitimate repeat notification for the same user produces a `P2002` violation that the ingest path silently swallows as `deduped: true`. The schema cannot tell a true duplicate from a legitimate second event.

2. **Domain tables doubling as outbox/inbox.** The `users` table itself acts as the outbox slot (`published_at`, `publishing_started_at` columns live on the domain row); the `notifications` table acts as both inbox dedup record and work queue and audit log (an `history` JSON column on every row). Domain reads suffer row bloat from append-only history, outbox claims contend with normal domain reads under `FOR UPDATE`, and retention policy is forced to be uniform across data that has wildly different lifecycles.

3. **No partial indexes on claim hot paths.** `users` has only a primary key — the outbox claim does a sequential scan filtered by `published_at IS NULL AND publishing_started_at IS NULL` on every tick. `notifications` has composite indexes on `(status, ...)` but they include `SENT` and `FAILED` rows that the claim never touches. At any non-trivial volume the planner walks more rows than it returns, and the gap grows linearly with history.

4. **No rate limiting or circuit breaker for the webhook.** The send command issues a raw `fetch()` directly. With `prefetch=10` × N pods, the system can burst 10×N concurrent requests at a downstream that may already be in trouble; nothing in the code reads `Retry-After`; nothing detects sustained failure to stop the bleed. A downed webhook becomes a self-inflicted denial-of-service on itself **and** drains the send-side retry budget in seconds.

5. **Delay-before-send is a SQL constant, not a column.** The claim query uses `WHERE created_at + ($delay::int * INTERVAL '1 millisecond') < NOW()` where `$delay` is a single environment variable. The system has no notion of "when this notification should fire" — only "minimum age before it becomes eligible." Per-notification scheduling (e.g. "send tomorrow at 10am local") cannot be expressed without changing both schema and query.

6. **No abstraction over the delivery channel.** `SendPushCommand` knows it speaks HTTP, knows the exact webhook URL shape, and constructs the JSON body inline. Tests would have to mock the global `fetch`. Adding email or SMS requires forking the command. The HTTP transport's status semantics are smeared together with the business state machine.

7. **A new notification type is a refactor, not a feature.** Walking a hypothetical `PASSWORD_CHANGED` through the system: no `type` column exists; the `UNIQUE(userId)` blocks the second type for the same user; the only ingestion path is a consumer hard-coded to `user.created`; the create command takes only `{ userId, name }` with no template/payload abstraction; the send command emits a fixed payload shape; metrics have no `type` label, so retrospective dashboards by type are impossible.

8. **Command pattern mid-way.** SQL is duplicated across four command files; the `PENDING → PROCESSING → SENT/FAILED` state machine is distributed across them with no single source of truth; `MarkAttemptFailed` + `MarkTerminalFailed` are two separate updates without a wrapping transaction (a crash between them de-syncs `attempts` and `status`); cross-cutting concerns like history-append and metrics are hand-copied at every call site; the read side is half-declared (an interface exists) and half-bypassed (consumers reach Prisma directly).

The team wants a system that treats new notification types as data — a registry entry plus a producer publishing to a generic ingestion channel — not as branches through hand-written code.

## Solution

Rebuild the notifier around four orthogonal axes: **ingestion is generic**, **idempotency is explicit**, **transport is pluggable**, **state is owned by one component**.

- A single `notifications.ingest` topic exchange replaces the per-source consumer. Producers publish self-contained ingest events keyed by `(type, sourceEventId)`; the notifier holds a code-defined `TypeCatalog` that knows how to validate params, render the body, choose a channel, and pick a retry policy.
- Idempotency moves off the domain identifier. `UNIQUE(type, source_event_id)` replaces `UNIQUE(userId)`. Re-delivered outbox events dedup to the same row; legitimate second events for the same user create a second row.
- Outbox and audit tables are physically separate from domain tables. `users` keeps only domain data; a new `users_outbox` table holds the publish-state columns and gets a partial index sized for the claim. `notifications` keeps only the work-state row; a new `notification_history` table absorbs the append-only audit trail. Partial indexes cover the actual hot-path predicates.
- A `NotificationTransport` interface with one method (`send(envelope) → result`) is the only thing the send pipeline knows about delivery. Concrete adapters (`WebhookTransport` today; `EmailTransport`, `SmsTransport` later) live behind decorators that compose rate-limiting and circuit-breaker behavior. `Retry-After` and 429 are first-class. Circuit-open is distinct from delivery-failure: a `CircuitOpenError` causes the consumer to nack-with-expiration without burning an attempt or recording history.
- A `NotificationsRepository` owns SQL; a `NotificationStateMachine` owns transitions and history-append; thin use-case commands compose them. The two-update bookkeeping (`recordAttempt` + maybe terminal) becomes a single command in one transaction that returns a verdict (`retry` vs `terminal`).
- Per-notification scheduling becomes a `scheduled_for TIMESTAMPTZ` column on `notifications`, computed by the ingest consumer from `event.scheduledFor ?? NOW() + TYPE_CATALOG[type].defaultDelayMs`. The claim filters `WHERE scheduled_for <= NOW()`.
- Metrics get `{ type, channel }` labels everywhere notifications are counted.

The rollout is a v2 — breaking schema and event-contract changes, no dual-write — because there is no production traffic.

## User Stories

1. As a product engineer, I want to add a new notification type by adding one entry to a code-side type registry, so that introducing `PASSWORD_CHANGED` (or any future type) is a small, reviewable PR rather than a system rewrite.
2. As a product engineer, I want each type entry to declare its own params schema, render function, channel, default delay, and retry policy in one place, so that the contract for that type is fully visible without grepping across consumers, commands, and metrics.
3. As a product engineer, I want producers to publish to a single generic `notifications.ingest` exchange with `{ type, sourceEventId, scheduledFor?, recipient, params }`, so that adding a new producer does not require declaring a new consumer or queue inside the notifier.
4. As a product engineer, I want params for a known type to be validated against the type's zod schema at ingest time, so that malformed producer payloads land in the inbox DLQ rather than corrupting the notifications table.
5. As a product engineer, I want each producer to be responsible for the recipient snapshot (email, phone, push token) inside the event, so that the notifier never reads another service's database to deliver a message.
6. As an operator, I want a true duplicate of the same `sourceEventId` for the same `type` to dedup cleanly into the existing notification row, so that re-published outbox events do not create duplicate deliveries.
7. As an operator, I want two distinct events for the same user (e.g. two `PASSWORD_CHANGED` over a week) to produce two distinct notifications, so that the schema does not silently swallow legitimate second deliveries.
8. As an operator, I want the `users` table to contain only domain columns, so that audit/transport bloat does not contend with normal user reads.
9. As an operator, I want `users_outbox` to hold all transport bookkeeping (`published_at`, `publishing_started_at`, `source_event_id`, payload snapshot), so that retention and cleanup of published rows can be tuned independently from user data.
10. As an operator, I want a partial index on `users_outbox` predicated on `published_at IS NULL AND publishing_started_at IS NULL`, so that the outbox claim is index-only and stays O(batch-size) regardless of how many rows have already been published.
11. As an operator, I want `notification_history` to be a separate audit table joined into admin views on demand, so that the working `notifications` row stays narrow and the claim index stays effective.
12. As an operator, I want a partial index on `notifications.scheduled_for WHERE status='PENDING'` and a second on `processing_started_at WHERE status='PROCESSING'`, so that claim and stuck-recovery sweeps stay index-only and bounded.
13. As a product engineer, I want each notification to carry an explicit `scheduled_for` timestamp computed at ingest, so that per-notification overrides (e.g. "send this one in 7 days") are a payload field rather than a schema change.
14. As an operator, I want webhook delivery to respect a per-channel concurrency limit, so that a burst of claimed notifications cannot overwhelm the downstream destination.
15. As an operator, I want a per-channel circuit breaker, so that sustained downstream failure stops the spend of retry attempts and stops further outbound load until the downstream recovers.
16. As an operator, I want a circuit-open event in the send pipeline to **not** count against the retry budget and **not** append a `PUSH_ATTEMPT` history entry, so that a downstream outage cannot accelerate notifications into terminal `FAILED` state.
17. As an operator, I want a `Retry-After` header from the destination to be parsed and used to schedule the next retry's delay, so that the system cooperates with well-behaved downstreams.
18. As a maintainer, I want delivery to be expressed against a `NotificationTransport` interface, so that swapping the webhook for a real push provider — or adding email/SMS — is a new adapter, not a rewrite of the send command.
19. As a maintainer, I want each transport adapter to be wrapped by `RateLimitedTransport` and `CircuitBreakerTransport` decorators composed at the DI layer, so that the same safety guarantees apply to every channel without copy-paste.
20. As a maintainer, I want a `FakeTransport` available as a test fixture, so that decorator behavior (rate limit, circuit breaker, retry-after handling) can be exercised without mocking the global `fetch`.
21. As a maintainer, I want a `NotificationsRepository` to own every SQL call against `notifications` and `notification_history`, so that schema changes are localized and the consumer/command layer does not depend on the ORM shape.
22. As a maintainer, I want a `NotificationStateMachine` to be the single source of truth for status transitions and history-append, so that the same transition cannot be expressed three different ways in three different commands.
23. As a maintainer, I want `recordAttempt(outcome)` to be a single command running in one DB transaction that returns a verdict (`retry-with-backoff` vs `terminal-failed` vs `sent`), so that a crash between "increment attempts" and "mark status" cannot leave a row half-updated.
24. As a maintainer, I want admin read endpoints to go through the same repository, so that admin and consumer pre-checks never drift apart and history-join logic lives in one place.
25. As a maintainer, I want cross-cutting concerns (metrics, query logs, latency) attached via a Prisma `$extends` wrapper, so that "all writes to notifications are tracked" is not a discipline every command has to remember.
26. As an operator, I want metrics labeled with `{ type, channel }` on every notification counter and histogram, so that per-type-per-channel dashboards and alerts are buildable retrospectively.
27. As an operator, I want a single ingest DLQ for messages that fail validation or repeated processing on the ingest path, so that I have one place to look for ingestion problems and one admin endpoint to drain it.
28. As an operator, I want send-side failures to terminate in DB `FAILED` (not a DLQ), so that I have a single read-model — the notifications table — for retry triage and so the admin retry endpoint is the only recovery surface.
29. As an operator, I want the existing admin endpoints (`GET /admin/notifications`, `GET /admin/notifications/:id`, `POST /admin/notifications/:id/retry`, `POST /admin/dlq/inbox/republish`) extended to filter by `type` and to surface the joined `notification_history` timeline, so that triage on a "user did not get their notification" complaint is a single API call.
30. As a producer-team engineer, I want the `users` service to publish to `notifications.ingest` with `type='USER_WELCOME'` instead of to `users.events`, so that the notifier has no `user.created`-specific consumer and the `users` service does not need to know what notifications exist downstream beyond its own choice of type.
31. As an operator, I want `users_outbox.source_event_id` to be a ULID generated at the moment the outbox row is inserted (in the same transaction as the `users` insert), so that re-published events after a crash carry the same id and dedup correctly at the notifier.
32. As a future maintainer, I want the same `users_outbox` shape to support a second event type (e.g. `user.password_changed`) by simply inserting another outbox row of a different `event_type` in the producing transaction, so that adding a new outbound event from `users` does not require new columns or new claim logic.
33. As a maintainer, I want `notifications.history` JSONB removed and the data moved to `notification_history(notification_id, at, event_type, payload)`, so that retention of audit data can be tuned independently and the working row stays narrow.
34. As a maintainer, I want a focused test suite covering the four deep modules (`TypeCatalog`, `NotificationStateMachine`, `NotificationTransport` decorators, `UsersOutboxRepository`), so that the multi-type semantics, state-transition rules, and CB/rate-limit behaviors have automated coverage even though the surrounding consumers and HTTP edge continue to be validated only by smoke.
35. As a maintainer, I want the v2 schema to ship with breaking changes and no dual-write path, so that I can delete the old code rather than maintain two parallel models.
36. As an operator, I want the `name` column on `notifications` removed and `name` to live inside `params` of a `USER_WELCOME` row, so that the schema does not hard-code one type's payload field onto every notification.
37. As a producer-team engineer, I want a published zod schema for the ingest event in a shared location, so that I get type-safe payloads on the producer side without re-declaring the contract.
38. As a maintainer, I want the inbox dedup to be enforced by the database (UNIQUE constraint on `(type, source_event_id)`), so that a race between two notifier replicas processing the same redelivered event cannot create two rows.

## Implementation Decisions

### Architecture and scope

- This is a v2 — a breaking, non-incremental refactor — landed across 5-7 vertical-slice phases planned separately. No dual-write, no parallel-read fallback. There is no production traffic to protect.
- The three deployable apps (`users`, `notifier`, `scheduler`) and their existing process model (replicas 2/2/1) do not change.
- The Prisma version stays on 6.x per existing project memory; Prisma `$extends` remains the instrumentation hook.
- Config schemas remain per-app (zod in `apps/<app>/src/config/`), per existing project memory.

### Type catalog (notifier app, code)

- `TypeCatalog` is a TypeScript registry keyed by type identifier (string). Each entry declares: `paramsSchema` (zod), `render(params) → body`, `channel` (`'webhook' | 'email' | 'sms'`), `defaultDelayMs`, `retryPolicy: { maxAttempts, backoff: 'exponential' | 'fixed', baseMs, jitter }`.
- A new type is a new entry plus a unit test. No DB-side templates, no runtime template engine, no admin-UI for editing templates.
- Adding `USER_WELCOME` is one entry; adding `PASSWORD_CHANGED` is another. Each producer chooses its own type string and is responsible for publishing payloads that conform to that type's params schema.

### Ingestion topology

- A single exchange `notifications.ingest` (topic). A single queue `notifier.ingest` bound to `ingest.*` (or `ingest.#`). One `IngestConsumer` is the entry point for every type.
- Ingest event payload (zod-validated at boundary): `{ type, sourceEventId, scheduledFor?, recipient: { email?, phone?, pushToken?, userId? }, params }`.
- `recipient` and `params` are both `Json` snapshots set by the producer at publish time; the notifier never reaches into another service's DB to fill them.
- Failed parsing or unknown `type` or paramsSchema mismatch routes to `notifications.dlx` (single DLQ for the ingest path). Admin republish endpoint drains it.
- Existing `users.events / user.created` consumer is removed. The `users` service publishes to `notifications.ingest` with `type='USER_WELCOME'`.

### Idempotency

- `notifications` has a composite `UNIQUE(type, source_event_id)` constraint. The old `userId @unique` is removed; `userId` becomes part of `recipient` JSON and is exposed for admin queries via a regular index on `(recipient->>'userId')` if needed.
- The ingest consumer attempts an insert; on unique violation it looks up the existing row and returns `deduped: true`. The verdict is logged but no longer a code smell — it now corresponds to a legitimate "same source event re-delivered" situation.

### Schema (`users` database)

- `users`: keeps `id`, `name`, `created_at`. Drops `published_at`, `publishing_started_at`.
- New `users_outbox`: `id` ULID PK, `aggregate_id` (FK `users.id`), `event_type` (e.g. `user.created`), `payload` Json (the full event body), `source_event_id` ULID (set at insert), `published_at` nullable, `publishing_started_at` nullable, `created_at`.
- `CREATE INDEX ... ON users_outbox(created_at) WHERE published_at IS NULL AND publishing_started_at IS NULL` — partial, sized for the claim hot path.
- `CreateUserCommand` inserts both rows in one transaction. Outbox row is the publish unit; `users` row never carries transport state again.

### Schema (`notifications` database)

- `notifications`: `id` ULID PK, `type`, `source_event_id`, `recipient` Json, `params` Json, `channel`, `scheduled_for` TIMESTAMPTZ, `status` enum, `attempts`, `processing_started_at`, `redrive_count`, `last_redriven_at`, `last_error`, `sent_at`, `created_at`, `updated_at`. `UNIQUE(type, source_event_id)`. The `name` column is gone (moved into `params.name` for `USER_WELCOME`).
- `notification_history`: `id` ULID PK, `notification_id` (FK `notifications.id`), `at` TIMESTAMPTZ, `event_type` (`CREATED | CLAIMED_BY_TICK | PUSH_ATTEMPT | PUSH_SENT | REDRIVEN_FROM_STUCK | MANUAL_RETRY | ...`), `payload` Json (status code, error message, etc.). The `history` JSONB column on `notifications` is dropped.
- `CREATE INDEX ... ON notifications(scheduled_for) WHERE status='PENDING'` — claim hot path.
- `CREATE INDEX ... ON notifications(processing_started_at) WHERE status='PROCESSING'` — stuck-recovery hot path.

### Domain layer (`notifier` app)

- `NotificationsRepository`: thin SQL surface (`claimDue`, `findById`, `findStuck`, `applyTransition(tx, id, patch)`, `list`, `insertWithIdempotency`, `appendHistory(tx, id, entry)`). No business logic. Backed by Prisma; can be swapped to a different ORM without touching callers.
- `NotificationStateMachine`: pure-ish class with no SQL of its own — it composes the repository inside the same transaction. Single source of truth for valid transitions, history-append for each transition, verdict computation for terminal vs retry. Methods: `ingest(input) → { notificationId, deduped }`, `claim() → ClaimedNotification[]`, `recordAttempt({ notificationId, outcome }) → 'sent' | 'retry-with-backoff(ms)' | 'terminal-failed'`, `recoverStuck() → { recovered, failed }`, `manualRetry(id) → row`.
- Use-case commands (`IngestNotificationCommand`, `ClaimDueNotificationsCommand`, `SendNotificationCommand`, `RecordSendAttemptCommand`, `RecoverStuckNotificationsCommand`, `RetryNotificationCommand`, `RepublishInboxDlqCommand`): orchestrate StateMachine + Transport + producers. No SQL of their own.
- Cross-cutting (metrics counters, structured logs, latency histograms) attach via a Prisma `$extends` wrapper plus a thin logging hook on the state machine.

### Transport layer (`notifier` app)

- `NotificationTransport` interface: one method `send(envelope: { notificationId, recipient, body, channel }) → Promise<TransportResult>`, where `TransportResult = { ok: true; status?: number } | { ok: false; status?: number; error: string; retryAfterMs?: number }`.
- `WebhookTransport` is the real adapter for `channel='webhook'` (raw `fetch` against the configured webhook URL, parses `Retry-After`, sets `Idempotency-Key: <notificationId>`).
- `EmailTransport` and `SmsTransport` ship as stub adapters (interface implementations that reject with a clear "not configured" error) so that the DI map is complete and `channel='email'`-typed notifications fail cleanly until the real adapter is wired.
- `RateLimitedTransport` decorator: wraps any inner transport with a per-channel concurrency limit using `p-limit` (or `bottleneck`).
- `CircuitBreakerTransport` decorator: wraps any inner transport with `opossum`. On circuit-open, throws `CircuitOpenError` rather than calling through.
- `FakeTransport`: test fixture that returns whatever result the test sets up.
- DI: a `TransportRegistry` keyed by channel, with each entry being the composed decorator stack (`Circuit → RateLimit → Real`). `SendNotificationCommand` resolves the transport for the notification's channel and delegates.

### Send-side consumer behavior

- `SendNotificationConsumer` consumes `push.send` (kept name for now; routing key shape may evolve). On message: read row through repository; if status is terminal (SENT/FAILED), ack-and-skip; if status is PROCESSING, dispatch.
- On `CircuitOpenError` from the transport: nack-with-expiration (long backoff, e.g. 30s) via the retry exchange; **do not** call `recordAttempt`; **do not** append a history entry. The notification stays in `PROCESSING`; stuck-recovery is the safety net if the consumer crashes during this nack.
- On any other transport result (`ok: true | false`): call `RecordSendAttemptCommand` with the outcome. The command runs a single transaction: increment `attempts`, set `last_error` if failure, append `PUSH_SENT` or `PUSH_ATTEMPT` to history, and — if `attempts >= maxAttempts` — flip status to `FAILED`. Returns verdict; consumer publishes retry or logs terminal accordingly. Backoff for retry comes from `result.retryAfterMs ?? typeCatalog.retryPolicy.computeBackoff(attempts)`.

### scheduled_for and claim

- Ingest consumer computes `scheduled_for = event.scheduledFor ?? NOW() + TYPE_CATALOG[type].defaultDelayMs` and writes the absolute timestamp.
- Claim: `WHERE status='PENDING' AND scheduled_for <= NOW() ORDER BY scheduled_for ASC LIMIT $batch FOR UPDATE SKIP LOCKED`, joined with the partial index.
- Stuck-recovery uses the second partial index unchanged conceptually but reads from `notification_history` for audit entries instead of writing to the row's JSON.

### Producer side (`users` app)

- `CreateUserCommand` performs the user insert and the outbox insert in one Prisma transaction.
- `UsersOutboxRepository`: thin SQL — `enqueue(tx, { event_type, payload, source_event_id })`, `sweepStuck(thresholdMs)`, `claimBatch(size)`, `markPublished(id)`, `releaseClaim(id)`.
- `ClaimAndPublishUsersCommand` now operates on `users_outbox` instead of `users`. The publish payload for `user.created` becomes an ingest event: `{ type: 'USER_WELCOME', sourceEventId: <outbox.source_event_id>, recipient: { userId: <users.id> }, params: { name: <users.name> } }`. The producer's exchange/routing-key changes to `notifications.ingest / ingest.user-welcome`.

### Topology

- `notifications.ingest` (topic) added.
- `notifier.ingest` queue bound to `notifications.ingest` with routing pattern that captures all `ingest.*`.
- `notifications.dlx` continues to exist as the single inbox DLQ, now keyed on ingest-path failures (validation/unknown-type/repeated process failures).
- `users.events` exchange is removed once `users` service starts publishing to `notifications.ingest`.
- `notifications.work` and `notifications.retry.*` keep their current shapes; only message payload changes (envelope now carries `channel` + `recipient` + `body` rather than `{ userId, name, notificationId }`).

### Metrics

- Counters: `notifications_created_total{type, channel}`, `notifications_sent_total{type, channel}`, `notifications_failed_total{type, channel, reason}`, `notification_redrive_count{type, channel}` (histogram on a small bounded redrive cap).
- Cardinality remains bounded by the type catalog (<50 entries in any foreseeable horizon) × channel set (<5).
- Existing latency/queue-depth metrics carry forward; ingest-path adds `notifications_ingest_failed_total{reason}` (`unknown_type`, `params_invalid`, `db_error`).

### Admin

- `GET /admin/notifications` adds optional `type` filter, `channel` filter; ordering and cursor unchanged.
- `GET /admin/notifications/:id` returns `{ ...row, history: NotificationHistoryEntry[] }` where `history` is joined from `notification_history`.
- `POST /admin/notifications/:id/retry` continues to flip `FAILED → PENDING` and append a `MANUAL_RETRY` history row.
- `POST /admin/dlq/inbox/republish` semantics unchanged — drains the ingest DLQ.

### Migration / rollout

- Phasing is delegated to the `prd-to-plan` step; the PRD only commits to "v2, breaking, no dual-write, vertical-slice tracer-bullets."
- Existing dev/test data is discarded on schema migration (`make nuke`). No backfill commitment.
- Removal of `name` column on `notifications` happens in the same migration that introduces `params Json`; the producer side starts emitting `params: { name }` at the same cut.

## Testing Decisions

The project ships without an automated test suite today (`PRD v1` made this an explicit trade-off). For `v2` the policy changes only at the deep-module boundary: focused tests on the modules where behavior is hard to verify with smoke tests and easy to verify with unit tests, and nowhere else.

**What makes a good test for this codebase**

- Tests exercise externally observable behavior of one module via its public interface; they do not assert on private fields, internal call sequences, or the exact SQL emitted.
- A test for `NotificationStateMachine` describes the **rule** ("an attempt that pushes `attempts` past `maxAttempts` returns the `terminal-failed` verdict and writes `status=FAILED`"), not the implementation of that rule.
- A test for a transport decorator describes the **observable shaping of behavior** ("a `429` response with `Retry-After: 5` returns a `TransportResult` with `retryAfterMs=5000`"), not the internal decorator chain.
- Consumers, controllers, producer plumbing, health endpoints, and DI wiring continue to be validated only by smoke.

**Modules with focused tests**

- `TypeCatalog`: each entry's `paramsSchema` rejects malformed input and accepts valid input; `render(params)` produces the expected body shape for a known fixture; lookup for an unknown type fails cleanly.
- `NotificationStateMachine`: ingest dedup on `(type, source_event_id)`; claim transitions `PENDING → PROCESSING` and emits a `CLAIMED_BY_TICK` history entry; `recordAttempt(success)` flips to `SENT` and appends `PUSH_SENT`; `recordAttempt(failure)` increments `attempts`; threshold-crossing returns `terminal-failed` and writes `status=FAILED` in the same transaction; stuck-recovery returns rows under threshold to `PENDING` and rows past the redrive cap to `FAILED`. State-machine tests run against a real Postgres (via the existing dev compose) — using a fake repository would hide the transactional semantics the SM relies on.
- `NotificationTransport` decorators: `RateLimitedTransport` enforces per-channel max-in-flight (a burst of N>limit calls observably serializes); `CircuitBreakerTransport` opens after the configured failure threshold and surfaces `CircuitOpenError`; `WebhookTransport` parses `Retry-After` (seconds and HTTP-date forms) into `retryAfterMs`. Decorator tests use `FakeTransport` as the inner; webhook-parsing tests use a local fastify-based fake (no global `fetch` mocking).
- `UsersOutboxRepository`: `enqueue` inside a transaction makes the row visible to a later claim only after commit; `claimBatch` uses `SKIP LOCKED` (two concurrent claims do not return the same row); `sweepStuck` resets `publishing_started_at` only for rows past the threshold; `markPublished` is idempotent under retry. Runs against a real Postgres.

**Prior art**

There is no prior test infrastructure in this repository — `vitest` is not currently installed. This PRD introduces it for the first time. The setup should be minimal: `vitest` runner, one test command per app, real-Postgres tests gated behind `make test` (assumes `make infra-up` has been run, mirroring the existing `make d` workflow). No mocking framework is needed; `FakeTransport` is hand-rolled and is the only test double.

## Out of Scope

- **Production data migration.** There is no production traffic to migrate; v2 ships against a freshly migrated dev DB. Any data in dev is discarded.
- **Real email and SMS adapters.** `EmailTransport` and `SmsTransport` are interface stubs that reject. Wiring real providers (SES, Twilio, etc.) is left for follow-up PRDs.
- **DB-backed templates.** The type catalog is code-only. Admin UI for editing templates, hot-reload, environment overrides, per-locale templates — all out of scope.
- **Per-recipient (per-tenant) rate limiting.** Rate limit is per-channel only. Per-destination smarts (e.g. per-host CB for email providers) come with the email adapter when it lands.
- **Multi-channel fan-out per notification.** One notification row maps to one channel. If a use case wants the same event to fire push **and** email, the producer emits two ingest events with different types (`USER_WELCOME_PUSH`, `USER_WELCOME_EMAIL`).
- **History retention automation.** `notification_history` grows indefinitely. Retention scripts/cron are out of scope; the table is sized for current expected throughput.
- **Scheduler HA / leader election.** Scheduler stays singleton (N=1), as in v1.
- **Generic outbox library.** `UsersOutboxRepository` lives in the users app for now. Extracting a parameterized outbox helper into `libs/database-core` waits for a second producer to actually need it.
- **Replacing the existing `RmqConsumer`/`RmqProducer` base classes.** They carry forward unchanged.
- **OpenTelemetry changes.** Existing OTel instrumentation (from Phase 4) is preserved; new metrics labels (`type`, `channel`) are additive.
- **CQRS bus (`@nestjs/cqrs`).** Rejected in favor of explicit use-case commands + repository + state machine.

## Further Notes

- **Producer-side contract change is breaking.** The `users` service stops publishing to `users.events` and starts publishing to `notifications.ingest` with the new envelope shape. The cut happens in the same phase that adds the new exchange to the notifier; no consumers exist for `users.events` outside the notifier, so the change is local to these two services.
- **`source_event_id` is a producer obligation.** It is generated as a ULID inside the producing transaction (in `users_outbox` for the users service) and carried unchanged through every retry, redelivery, and outbox-republish. The notifier treats it as opaque. A producer that fails to provide a stable `sourceEventId` will manufacture spurious duplicates — this is documented as a producer-side invariant.
- **`channel` is derived from `type`, not chosen by the producer.** The producer publishes `type`; the notifier looks up `TYPE_CATALOG[type].channel` and writes it to the row. Producers do not need to know about delivery channels.
- **The retry policy is per-type.** `{ maxAttempts, backoff, baseMs, jitter }` lives in the type catalog. A given type can be more or less patient than another; the consumer reads `attempts` and asks the catalog's `retryPolicy` for the next backoff.
- **`CircuitOpenError` is a distinct path through the consumer.** It does not count as an attempt, it does not append history, and it does not transition state. The notification stays in `PROCESSING`; if the consumer crashes during the resulting nack-with-expiration, stuck-recovery catches it after the configured threshold.
- **`notification_history` is append-only.** No update or delete from the application path. Admin endpoints read it but never write directly.
- **Existing `RmqHealthIndicator`, terminus checks, and per-app config schemas carry forward unchanged.**
- **Prisma 6.x is locked** per project memory; `$extends` instrumentation is fully compatible.
- **The phase plan is produced separately** via `prd-to-plan`. This PRD does not commit to phase counts or per-phase definition-of-done.
