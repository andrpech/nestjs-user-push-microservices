# PRD: User Push Notification Microservices

## Problem Statement

A product team needs a backend system that captures new user signups via HTTP and reliably sends each new user a push notification (delivered as an HTTP webhook) some configurable time after signup — 30 seconds in development, 24 hours in production. Today, no such system exists in this repository.

The team has three concerns that aren't satisfied by a naïve "create user, schedule a job" implementation:

1. **Reliability across crashes.** If the application restarts between user creation and notification delivery, the notification must still be sent. No data loss, no duplicate deliveries observable to the recipient.
2. **Service independence.** The team wants to evolve user management, scheduling, and notification delivery as separate concerns over time. Direct service-to-service HTTP coupling is rejected; only message-broker communication is acceptable.
3. **Operability when things go wrong.** When a downstream webhook is broken, the team needs to inspect what failed, why, and trigger a retry — without restarting services or running ad-hoc SQL.

The system also needs to be deployable in a way that a future operator can understand without prior context: each service has a single, clearly-defined job; environment variables are validated at boot; topology is declared in code and reproducible.

## Solution

Three NestJS services communicate exclusively through a RabbitMQ broker:

- **Users service** owns user creation. It exposes `POST /users`, persists the user, and publishes a `user.created` event via a transactional outbox pattern (the user row itself doubles as the outbox; a cron-driven consumer reads pending rows and publishes them).
- **Scheduler service** is a heartbeat. It fires two cron messages on configurable intervals: `cron.users` (drives the outbox publish) and `cron.notifier` (drives the notification delivery sweep).
- **Notifier service** owns the notifications table. It consumes `user.created` to create a pending notification record, consumes `cron.notifier` to claim due notifications and dispatch HTTP delivery attempts, and consumes `push.send` to actually call the webhook.

The notification flow uses a status state machine (`PENDING` → `PROCESSING` → `SENT` or `FAILED`) protected by `FOR UPDATE SKIP LOCKED` claims, RabbitMQ DLX-based exponential-backoff retries (broker-counted for the inbox path, DB-counted for the HTTP-dispatch path), and stuck-row recovery sweeps for crashed consumers. Idempotency is enforced at every consumer boundary: the inbox uses a unique constraint on `userId`, the dispatch consumer reads-then-acts, and the webhook receives an `Idempotency-Key` header.

The system ships in six phases: (1) scaffolding, (2) monolith — all three modules in one app, (3) split into three deployable apps, (4) monitoring & infra (Prometheus, Grafana, OpenTelemetry), (5) admin & recovery endpoints, (6) optional remainder (replicas, K8s, full graceful shutdown).

## User Stories

1. As an API consumer, I want to POST a user with a name, so that the system creates a record and returns the user's ID immediately.
2. As an API consumer, I want my POST to be validated strictly (name 1-64 chars, no extra fields), so that I get a clear 400 error if I send malformed input rather than a confusing failure later.
3. As an API consumer, I want a 201 response with the full created user (id, name, createdAt), so that I can use the returned data without a second round-trip.
4. As an end user, I want to receive a push notification approximately 24 hours after signing up, so that I'm reminded to come back and engage with the product.
5. As an end user, I want to receive that notification exactly once even if the system has internal failures, so that I'm not spammed.
6. As an end user, I want to receive the notification even if the platform crashes between my signup and the scheduled delivery time, so that I'm not silently forgotten.
7. As a product engineer testing the flow, I want a configurable delay (30 seconds in development, 24 hours in production), so that I can iterate quickly without waiting a day per test.
8. As an operator, I want each service to fail to start if its environment is misconfigured, so that I find out about the problem in seconds during deploy rather than minutes later when traffic hits.
9. As an operator, I want each service to expose a liveness endpoint (`/lhealth`) that returns immediately, so that container orchestrators can decide when to restart a wedged process without depending on downstream availability.
10. As an operator, I want each service to expose a readiness endpoint (`/rhealth`) that pings its actual dependencies (DB, broker), so that traffic isn't routed to a service whose downstreams are down.
11. As an operator, I want a single `make d` command that brings up the full development stack with hot-reload, so that I can start contributing without reading a setup wiki.
12. As an operator, I want `make infra-up` and `make d` to be separable, so that I can keep my Postgres data warm across application restarts.
13. As an operator, I want to inspect what happened to any specific notification by ID, so that I can debug user-reported "I didn't get my push" complaints.
14. As an operator, I want to see the full history of state transitions for any notification (created, claimed, attempted, redriven, sent), so that I understand the timeline without correlating multiple log files.
15. As an operator, I want to list all permanently-failed notifications, so that I can decide whether to retry them after fixing the upstream issue.
16. As an operator, I want to retry a single failed notification by ID, so that I can recover from transient destination outages without manual SQL.
17. As an operator, I want to drain and republish the inbox dead-letter queue, so that I can recover from a transient bug in the inbox consumer after deploying a fix.
18. As an operator, I want messages that exhaust their retries on the inbox path to land in a dead-letter queue rather than being silently dropped, so that I can recover them later.
19. As an operator, I want notifications that exhaust HTTP retry attempts to be marked FAILED in the database with the last error preserved, so that I have a record to investigate.
20. As an operator, I want a notification that's been "stuck" in `PROCESSING` longer than five minutes to be automatically reclaimed, so that a crashed consumer doesn't permanently wedge a delivery.
21. As an operator, I want a hard cap on how many times a stuck row can be redriven, so that a fundamentally-broken row eventually gets marked FAILED instead of looping forever.
22. As an operator, I want each service to scale horizontally without coordination headaches, so that I can add capacity for the high-throughput parts (HTTP intake, notification delivery) independently.
23. As an operator, I want the scheduler service to remain a singleton, so that cron ticks don't multi-fire and amplify load.
24. As an operator, I want database migrations to apply automatically on deploy without a separate manual step, so that rollouts are one-button.
25. As an operator, I want concurrent migration races (multiple replicas booting at once) to be safe, so that I don't get crash-loops on every release that includes a schema change.
26. As an operator, I want each service's logs to include enough correlation keys (userId, notificationId, request ID, message ID) that I can trace any specific user's notification across all three services, so that debugging async flows is grep-able.
27. As an operator, I want webhook delivery to include an `Idempotency-Key` header keyed to the notification ID, so that a well-behaved receiver can dedupe at-least-once retries on its side.
28. As an operator, I want to be able to wipe all local state with one command (`make nuke`), so that I can reset between experiments without manual cleanup.
29. As an operator preparing for production, I want metrics exposed in Prometheus format from each service, so that I can build dashboards and alerts (Phase 4).
30. As an operator preparing for production, I want end-to-end distributed tracing across HTTP → broker → HTTP, so that I can answer "where did time go?" for any specific request (Phase 4).
31. As a future maintainer, I want the boundary between business logic and transport (HTTP / RMQ) to be enforced by the codebase structure, so that I can change one without touching the other.
32. As a future maintainer, I want each service's database to be physically isolated from others' data, so that I can't accidentally introduce cross-service queries that would block a future split.
33. As a future maintainer, I want the topology between services (queues, exchanges, bindings) to be declared in code by the service that uses it, so that I can find what a service depends on without reading broker-side configuration.
34. As a future maintainer, I want the same project structure to support both the Phase 2 monolith and the Phase 3 split with no business-code changes, so that the architecture validation in Phase 2 carries through to Phase 3 unchanged.
35. As a future maintainer in Phase 6, I want to introduce read replicas without rewriting any application code, so that scaling reads is a config change rather than a refactor.
36. As a future maintainer in Phase 6, I want to introduce K8s manifests without rewriting health checks or graceful shutdown logic, so that the application is already production-shaped.

## Implementation Decisions

### Stack and tooling

- Node 22 LTS, NestJS 11, Fastify HTTP adapter, Postgres 16, RabbitMQ 3.
- Prisma 7 as ORM, with two separate schemas (one per logical database: `users`, `notifications`) and per-domain generated clients.
- `amqplib` + `amqp-connection-manager` for broker access (rejected `@nestjs/microservices` and third-party Nest wrappers).
- `zod` for all validation (HTTP DTOs, RMQ message payloads, environment configuration).
- `nestjs-pino` for logging with structured bindings.
- `@nestjs/config` with `registerAs` + zod schema parsed on boot (markus pattern).
- `@nestjs/terminus` for health endpoints from Phase 1 onward.
- `@nestjs/schedule` with dynamic registration via `SchedulerRegistry` (not `@Cron(...)` decorator, because the decorator evaluates before config loads).
- ULID (app-generated) for all primary keys.
- npm workspaces for monorepo structure.
- No tests — end-to-end smoke testing is the QA path.

### Service shape

- Three deployable apps after Phase 3 split: `users`, `notifier`, `scheduler` (no `-service` suffix).
- All three apps boot full Nest + Fastify, even the scheduler (which has no business HTTP routes — just `/health`), because uniformity simplifies orchestration and lets compose `depends_on: condition: service_healthy` work consistently.
- Users runs N=2 replicas. Notifier runs N=2 replicas. Scheduler is pinned to N=1 (singleton constraint to avoid duplicate cron ticks). Phase 6 adds `pg_advisory_lock` leader election to allow scheduler HA.
- Phase 2 ships as a single monolith app (N=1) with all three modules; the split in Phase 3 is purely topological (file moves + relative-import rewrites for prisma generated clients), no business code changes.

### Database layout

- Two logical databases (`users`, `notifications`) on a single Postgres instance in Phases 2-5; Phase 6 introduces read-replica streaming replication.
- Each app instantiates only the Prisma clients it needs. Scheduler has zero Prisma footprint (no `@prisma/client`, no `prisma` CLI).
- From Phase 2, two Prisma client instances per database (Read and Write tokens), even though they point to the same URL until Phase 6. Code shape is replica-ready from day one.
- Migrations apply at app entrypoint via `prisma migrate deploy`. Prisma 5+ uses an internal advisory lock, so concurrent N>1 boots serialize safely without crash-loops. The `prisma` CLI ships in production dependencies.
- Class+interface merge pattern (mirrored from martech-utils) for the Read/Write client tokens — the class is the DI token, the interface gives the typed surface.
- Schema files live in `apps/<app>/prisma/`, not in `libs/`. Phase 3 transition includes a mechanical relative-import rewrite step.

### User table outbox model

- The `users` table itself is the outbox slot — no separate outbox table. Two coordination columns: `publishedAt` (null = pending; non-null = published) and `publishingStartedAt` (null = unclaimed; non-null = currently being published).
- A users-side cron consumer (`cron.users`) sweeps stuck rows (publishingStartedAt > 5 min old → reset), claims a batch with `FOR UPDATE SKIP LOCKED`, publishes each as a `user.created` event with publisher confirms, and marks `publishedAt` on confirm.
- Trade-off accepted: row payload (name, etc.) is reconstructed at publish time, not frozen at write time. If `name` were ever mutable (it isn't today), publish would emit the current value. This is documented as a known constraint of the column-on-row outbox approach.
- A partial index on `(created_at) WHERE published_at IS NULL AND publishing_started_at IS NULL` keeps the claim hot path fast.

### Notification table

- Carries `name` (copied from the `user.created` event payload, since notifier has no access to the users database), `userId @unique` (dedupes redelivered events), `status` enum, `attempts` counter (HTTP retry, source of truth), `processing_started_at`, `redrive_count` (capped at 5 — overflow transitions to FAILED), `last_error`, `sent_at`, and a `history` JSONB column for an append-only audit trail of state transitions.

### RabbitMQ topology

- Each app declares only the exchanges, queues, bindings, and DLX configuration that it directly touches. Asserts are idempotent. Argument-drift between apps is mitigated by code review, not by a shared topology library.
- Exchange names: `users.events` (user-created event), `system.cron` (heartbeat for both `cron.users` and `cron.notifier` routing keys), `notifications.work` (push.send), `notifications.retry.events` and `notifications.retry.work` (DLX retry rings), `notifications.dlx` (terminal inbox DLQ).
- Compose `depends_on` orders boot so consumers are up before producers start: postgres → rabbitmq → migrators → notifier → users → scheduler.
- All publishes use `mandatory: true`. A return listener logs unrouted messages. Phase 6 introduces alternate-exchange for zero-loss capture.
- Inbox retry counter uses RMQ-native `x-death[*].count` keyed by queue name (not `x-death.length`, which counts distinct triples rather than the redelivery count).
- HTTP retry counter is the DB column `notifications.attempts` (RMQ is not source-of-truth for the send flow).
- Per-message expiration backoff is set on republish: inbox uses 1s/2s/4s/8s/16s; send uses `1000 * 2^(attempts-1)` ms.

### Consumer and producer base classes

- One AMQP connection per app (multiplexed). One channel per consumer. One confirm-channel per producer.
- `RmqConsumer<T>` base class: takes a queue name, prefetch, and zod schema; parses incoming messages; handles default error path as `nack-no-requeue` (routes via DLX); exposes a `ConsumerCtx` with `messageId`, `deathCount`, `headers`, and `rawMessage` to the handler.
- `RmqProducer<T>` base class: takes exchange and routing key via decorator; uses confirm channel; sets `persistent: true`, `messageId: ulid()`, `mandatory: true`, `contentType: application/json`; resolves only after broker ack.
- `PushSendConsumer` enforces an explicit idempotency contract at the top of every handle call: read row by ID; ack-and-return if SENT or FAILED; nack-no-requeue on state-machine violations; proceed only on PROCESSING.

### Cron, claim, and publish coordination

- Two cron jobs in the scheduler app, registered dynamically via `SchedulerRegistry` from env-driven expressions (`USERS_CRON_EXPR`, `NOTIFIER_CRON_EXPR`). Defaults: `*/5 * * * * *` in dev, `* * * * *` in prod.
- Both the users-outbox flow and the notifier-claim flow follow the same pattern: sweep stuck rows, claim a batch (`FOR UPDATE SKIP LOCKED`), commit, publish each with confirms, then mark each row done. **Commit-then-publish** is the contract — publish failures leave the row in a "claimed but unpublished" state that stuck-recovery sweeps back to pending after 5 minutes.
- Cron queues use `prefetch=1` (heartbeat semantics). Work queues use `prefetch=10` (env-configurable). Claim batch size is `NOTIFIER_CLAIM_BATCH=100` (env).

### API contracts

- `POST /users` request: `{ name: string }` with strict zod validation (1-64 chars, no other fields). Response 201 with `{ id, name, createdAt }`. Not idempotent at the request level — same name twice creates two distinct users.
- Webhook POST body: `{ userId, name, notificationId }`. Headers include `Content-Type: application/json`, `Idempotency-Key: <notificationId>`, `User-Agent`. Timeout via `AbortSignal.timeout(PUSH_HTTP_TIMEOUT_MS)`.
- Phase 5 admin endpoints (notifier app, no auth — assumed behind internal network): `GET /admin/notifications/:id`, `GET /admin/notifications?status=FAILED&limit&cursor` (cursor-paginated by ULID), `POST /admin/notifications/:id/retry` (FAILED → PENDING with `MANUAL_RETRY` history append; 409 if status mismatch), `POST /admin/dlq/inbox/republish` (drain DLQ, optionally selective by ID list).

### Configuration

- Each app has its own `.env` and its own zod-validated `ConfigSchema` composed from building blocks shared via `@app/config`.
- Validation runs on boot via `registerAs('app', () => { ... ConfigSchema.parse(config) })`. App fails to start on any env misconfig.
- Typed DI: services inject `@Inject(ConfigurationInjectKey) private readonly config: ConfigurationType` and access nested config (`this.config.cron.usersExpr`).
- All compose hostnames (`postgres`, `rabbitmq`) are baked into `.env` directly; running outside compose requires manual env override.

### Logging and observability

- Phase 2-3: pino structured logs everywhere with bindings for `reqId` (HTTP edge), `messageId`/`queue` (consumer edge), and `userId`/`notificationId` (domain). Cross-segment correlation via grep on these business keys.
- Phase 4: OpenTelemetry SDK in each app, auto-instrumenting fastify, http, and pg. Manual instrumentation for amqplib (`@opentelemetry/instrumentation-amqplib`) propagates `traceparent` over RMQ. `pino-otel` injects `traceId`/`spanId` into log lines. Tempo or Jaeger as the trace backend, Prometheus + Grafana for metrics, custom counters for notification failures, redrives, prisma latency, and queue depth.
- The Prisma client is wrapped via `$extends` for instrumentation only (pino query logging in Phase 2; OTel auto-instrumentation in Phase 4). No method augmentation, so the type cast back to `PrismaClient` remains sound.

### Health endpoints

- `/lhealth` (liveness): synchronous `{status: 'ok'}`, no dependency checks.
- `/rhealth` (readiness): terminus `@HealthCheck()` runs all configured indicators.
- Phase 1: empty checks list.
- Phase 2: adds Prisma ping × 4 (Users Read/Write, Notifications Read/Write) plus a custom RmqHealthIndicator (checks `connectionManager.isConnected()`).
- Phase 3: each app's check list narrows to its own dependencies (scheduler = RMQ only; users = users DB + RMQ; notifier = notifications DB + RMQ).
- Compose `healthcheck:` probes `/rhealth` for `depends_on: condition: service_healthy`.

### Failure handling

- Inbox flow (`user.created` consume): RMQ-counted retries (1/2/4/8/16s), 5 attempts, then route to DLQ for manual recovery via Phase 5 admin endpoint.
- Send flow (`push.send` consume): DB-counted retries with exponential backoff, 5 attempts, then UPDATE to FAILED and ack. **No DLQ** for send-side failures — terminal state, recovery via Phase 5 admin.
- Stuck-recovery: rows in PROCESSING longer than 5 minutes are reset to PENDING with `redrive_count++`. After 5 redrives, the row transitions to FAILED with `last_error='exceeded redrive limit'`.

### Deep modules to extract

- **Outbox claim/sweep/publish/mark machinery** — used by both the users outbox flow and the notifier claim flow. Same pattern: sweep stuck rows, claim a batch with SKIP LOCKED, commit, publish each with confirms, mark each done. Lives ideally in `libs/database-core` or `libs/common` as a generic helper parameterized over the row type and the publish callback. Encapsulates the commit-then-publish discipline, the 5-minute stuck-recovery semantic, and the redrive cap.
- **`RmqConsumer<T>` base class** — encapsulates channel-per-consumer setup, prefetch, zod payload parsing, ack/nack lifecycle, `x-death` parsing, and the default error contract (nack-no-requeue → DLX). Subclasses provide a queue name and a zod schema and implement `handle(payload, ctx)`.
- **`RmqProducer<T>` base class** — encapsulates confirm-channel acquisition, mandatory flag, return listener, and the standard message properties (persistent, messageId, contentType). Subclasses provide an exchange and routing key via decorator.
- **`createExtendedPrismaClient` factory** — encapsulates `$extends` instrumentation (pino query logging in Phase 2; OTel in Phase 4) and the cast-back-to-PrismaClient mechanics. Each app wires it once per Read/Write client.
- **`RmqHealthIndicator`** — terminus-style indicator wrapping the connection manager's connection state. Reusable across all three apps.
- **Config building-block schemas** — `AppSchema`, `DatabaseSchema`, `RmqSchema`, `NotificationSchema`, `CronSchema`, `WebhookSchema` exported from `@app/config`. Each app composes only what it needs.

### Process model and deployment

- Phase 2: single monolith app, single replica.
- Phase 3: three apps, mixed replica counts (users=2, notifier=2, scheduler=1).
- Migrations run at each app's entrypoint via `prisma migrate deploy`. Concurrent N=2 boots are safe via Prisma's internal advisory lock — no crash-loop.
- Graceful shutdown in Phase 2: minimal — `app.enableShutdownHooks()` plus an `OnModuleDestroy` on `RmqConnection` to close the connection cleanly. Phase 6 adds full per-consumer cancel-and-drain, prisma `$disconnect`, and fastify in-flight request draining.

### Development workflow

- Full Docker for dev — apps run inside containers with bind-mounts and `nest start --watch`. `CHOKIDAR_USEPOLLING=true` for macOS bind-mount file-watching.
- `make infra-up` (postgres + rabbitmq, detached) runs once per session.
- `make d` (apps with watch, attached, foreground) is the inner-loop command. Assumes infra is already up.
- `make up-all` (apps prod-like, detached) for full smoke testing.
- `make nuke` wipes all volumes.

## Testing Decisions

The team has explicitly chosen to ship without an automated test suite. This is a documented trade-off: the entire QA path is the end-to-end smoke described in each phase's Definition of Done — typically `curl POST /users`, wait for the notification window, and verify the webhook receiver got the expected payload.

**No test framework** (vitest, jest) is installed. No unit, integration, or contract tests are written. Phase 1 commit roadmap explicitly omits any test-related commits.

**Implications surfaced and acknowledged:**

- Regressions after Phase 2 will be caught only by re-running the smoke manually.
- Refactors carry no automated safety net; the burden falls on code review and the type checker.
- Phase 4 OpenTelemetry traces will become the primary post-deploy verification mechanism for diagnosing what actually happened in any given request.

**What "good test" would look like (if reintroduced later):**

If tests are added in a future revision, they should test external behavior — observable outputs given inputs through public interfaces — not implementation details like which Prisma method was called. The deep modules identified above (outbox machinery, RMQ base classes, health indicator, config schemas) are designed to be testable in isolation: each has a narrow, stable interface and encapsulates substantial logic.

If the team ever adds tests, the plausible layering would be:

- **Unit tests** for the deep modules (outbox claim helper, base class behaviors with a fake AMQP channel, config schema parsing).
- **Integration tests** via `@testcontainers/postgresql` and `@testcontainers/rabbitmq` for the inbox flow's idempotent dedupe, the cron-driven claim+publish path, and the push retry → FAILED transition.
- **End-to-end smoke** automated via a bash script or Playwright.

Markus is the prior art for vitest + colocated `*.test.ts` files in this organization.

## Out of Scope

The following are explicitly deferred to Phase 6 or are not goals of this system:

- **Authentication and authorization.** Neither `POST /users` nor the Phase 5 admin endpoints have auth. The admin endpoints assume an internal network. Adding API-key headers is a documented future option.
- **User mutation or deletion.** `User.name` is treated as immutable. There is no `PUT /users/:id` or `DELETE /users/:id`.
- **Real push provider integration.** The webhook destination is a single configurable URL (`webhook.site` in dev). Apple APNS, Firebase FCM, etc., are out of scope.
- **Per-user routing.** All users receive notifications to the same webhook URL. There is no concept of "user A's webhook" vs "user B's webhook."
- **Multi-tenant isolation.** Single tenant.
- **Read replicas, K8s manifests, scheduler HA via leader election, alternate-exchange for unrouted cron messages, full graceful shutdown with in-flight drain, live/ready k8s probe split** — all deferred to Phase 6.
- **Test suite of any kind** — see Testing Decisions.
- **Automated end-to-end smoke** — Phase 2 DOD step is run manually.
- **CI/CD pipeline** — no GitHub Actions, no ArgoCD, no deploy automation. The system is a local-development and design-validation artifact.
- **Schema versioning of RMQ message payloads** — payloads are JSON, no schema registry, breaking changes require coordinated deploy.
- **Outbox publish failure cap** — the users outbox retries forever (publish failures just wait for the next tick). Notifier retries are capped at 5 with terminal FAILED.

## Further Notes

- The full technical design and per-phase commit roadmap lives in `docs/INITIAL_PLAN.md`. This PRD is the product-level companion; the initial plan is the implementation blueprint.
- The architecture deliberately mirrors patterns from the team's `markus` service (config validation, health endpoints with `/lhealth` + `/rhealth`, Dockerfile node_modules pruning, class+interface merge for Prisma DI tokens, prettier/oxlint configs, git-aware lint scripts) so that contributors familiar with `markus` find this repo immediately legible.
- The phase split is intentional: each phase has an independently-runnable Definition of Done. Phase 2 (monolith) is a complete working system on its own; Phase 3 (split) demonstrates that the architecture supports microservices without re-engineering; Phases 4-6 are operational maturity levels.
- The "outbox in the same row" choice (rather than a separate `outbox` table) is a known simplification. It works as long as `User.name` stays immutable and no other event types are published from the users service. Either change would force a migration to a dedicated outbox table.
- Webhook deliveries are at-least-once. The `Idempotency-Key` header gives well-behaved receivers the data they need to dedupe. `webhook.site` (dev destination) does not honor it, which is fine for development — the smoke test just sees one or more arrivals per delivery.
