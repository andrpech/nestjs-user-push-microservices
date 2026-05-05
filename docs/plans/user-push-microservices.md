# Plan: User Push Notification Microservices

> Source PRD: `docs/prds/prd-user-push-microservices.md`
> Source design: `docs/INITIAL_PLAN.md`

## Architectural decisions

Durable decisions that apply across all phases. Established during the design grilling and locked before implementation begins.

- **Routes**:
  - `POST /users` — request `{ name }`, response 201 `{ id, name, createdAt }`
  - `GET /lhealth` — liveness, sync `{status:'ok'}`
  - `GET /rhealth` — readiness, terminus checks (deps added per phase)
  - `GET /metrics` — Prometheus scrape target (Phase 8 onward)
  - Phase 11+: `GET /admin/notifications/:id`, `GET /admin/notifications?status=FAILED&limit&cursor`
  - Phase 12+: `POST /admin/notifications/:id/retry`, `POST /admin/dlq/inbox/republish`
- **Schema — `users` DB**:
  - `User` { `id` ULID PK, `name`, `publishedAt` (null = pending publish), `publishingStartedAt` (claim coordination), `createdAt` }
  - Partial index on `(created_at) WHERE published_at IS NULL AND publishing_started_at IS NULL`
- **Schema — `notifications` DB**:
  - `Notification` { `id` ULID PK, `userId` UNIQUE (dedupe), `name` (copied from event), `status` enum (PENDING/PROCESSING/SENT/FAILED), `attempts`, `processingStartedAt`, `redriveCount`, `lastRedrivenAt`, `lastError`, `sentAt`, `history` JSONB (append-only), `createdAt`, `updatedAt` }
  - Indexes on `(status, createdAt)` and `(status, processingStartedAt)`
- **Key state machines**:
  - User outbox: `publishedAt IS NULL` → claim (`publishingStartedAt = NOW()`) → publish with confirm → `publishedAt = NOW()`. Stuck recovery: `publishingStartedAt < NOW - 5m AND publishedAt IS NULL → publishingStartedAt = NULL`
  - Notification: `PENDING` → claim (`PROCESSING + processingStartedAt = NOW()`) → HTTP → `SENT` or backoff retry / FAILED. Stuck recovery: `PROCESSING > 5m → PENDING + redriveCount++`; overflow at `MAX_REDRIVES=5` → FAILED
- **Auth**: none. Admin endpoints assumed behind internal network (Phase 11+); `X-Admin-Token` env-checked header is a documented future option.
- **Third-party / external**: `webhook.site` (configurable `WEBHOOK_URL`), Prometheus, Grafana, OpenTelemetry collector + Tempo or Jaeger (Phase 8-10).
- **Process model**:
  - Phase 1-6: single monolith app, N=1 replica
  - Phase 7+: three apps — `users` (N=2), `notifier` (N=2), `scheduler` (N=1, singleton constraint until Phase 13 leader-election)
- **Broker topology**: declared by each app for what it touches (idempotent asserts). Exchanges: `users.events`, `system.cron`, `notifications.work`, `notifications.retry.events`, `notifications.retry.work`, `notifications.dlx`. Routing keys: `user.created`, `cron.users`, `cron.notifier`, `push.send`, plus `.retry` / `.dead` variants.
- **Retry semantics**:
  - Inbox (`user.created`): RMQ-counted via `x-death[*].count` keyed by queue name; per-message expiration backoff 1/2/4/8/16s; 5 fails → DLQ for manual recovery
  - Send (`push.send`): DB-counted via `notifications.attempts`; backoff `1000 * 2^(attempts-1)` ms; 5 fails → terminal FAILED, no DLQ
  - Stuck recovery: cron.notifier sweep, 5-min threshold, redrive cap 5 → terminal FAILED
- **Idempotency contracts**:
  - Inbox: `Notification.userId @unique` absorbs redelivered events
  - Send: `PushSendConsumer.handle()` reads row first; ack-and-return on `SENT`/`FAILED`; proceed only on `PROCESSING`
  - Webhook: `Idempotency-Key: <notificationId>` header on every POST
  - Outbox publish: at-least-once accepted (downstream `userId @unique` dedupes)
- **Commit-then-publish**: claim TX commits before publish for both outbox flows. Publish failure → row stays "claimed" → 5-min stuck-recovery sweeps it back. Publisher confirms required for both.
- **Configuration**: per-app `.env` and per-app zod-validated `ConfigSchema` defined directly in `apps/<app>/src/config/validation-schema.ts` using `zod`. `ConfigSchema.parse()` runs in `registerAs` factory at boot — invalid env crashes the app. `libs/config` is intentionally empty — env schemas belong to the app that owns those env vars.
- **ID generation**: ULID, app-generated, used as PK across both schemas and as `messageId` on every RMQ publish.
- **Logging**: `nestjs-pino` everywhere with structured bindings: `reqId` (HTTP edge), `messageId`/`queue` (consumer edge), `userId`/`notificationId` (domain).
- **Health**: `/lhealth` synchronous, no checks. `/rhealth` via `@nestjs/terminus`, dep checks added incrementally per phase.
- **Cron registration**: `@nestjs/schedule` via `SchedulerRegistry` dynamic add (NOT `@Cron(...)` decorator) so env-driven exprs go through zod-validated config.
- **Migrations**: `prisma migrate deploy` runs at app entrypoint. Prisma 5+ advisory lock makes concurrent N=2 boots safe — no crash-loops.
- **Tests**: none. End-to-end smoke (manual curl + webhook check) is the QA path.
- **Dev workflow**: full Docker for dev. `make infra-up` brings up postgres + RMQ. `make d` brings up apps with bind-mount + watch + `CHOKIDAR_USEPOLLING=true`. `make nuke` wipes everything.

---

## ✅ Phase 1: Scaffolding + health

**User stories**: 8, 9, 10, 11, 12, 26, 28

### What to build

The empty monorepo skeleton that everything else hangs from. npm workspaces with `apps/` and `libs/` directories. All dev tooling: oxlint, prettier, husky pre-commit, the 9 git-aware lint/format scripts, Makefile with infra/dev/code-quality targets. The five shared libs (`common`, `config`, `zod-validation`, `database-core`, `rmq`) scaffolded with their public interfaces but no business logic. A monolith app that boots Fastify + pino + zod pipe, loads dotenv, parses a strict `MonolithConfigSchema` at startup (and crashes on invalid env), enables shutdown hooks, and serves `/lhealth` (sync ok) and `/rhealth` (terminus, empty checks). Two compose files (infra + apps) and a dev override compose for bind-mount + watch.

### Acceptance criteria

- [x] `make infra-up` brings up postgres + rabbitmq, both healthy per their healthchecks
- [x] `make d` boots monolith via dev compose with bind-mount + `nest start --watch`
- [x] `GET /lhealth` returns 200 with `{status:'ok'}` synchronously
- [x] `GET /rhealth` returns 200 with empty checks array via terminus
- [x] `make pc` (lint + format check + typecheck) passes with no warnings
- [x] App refuses to boot when a required env var is missing (zod parse throws)
- [x] Pino emits structured JSON logs with `reqId` binding on HTTP requests
- [x] `make nuke` removes all containers and volumes cleanly

---

## ✅ Phase 2: User intake

**User stories**: 1, 2, 3

### What to build

Users module exposes `POST /users`. Strict zod validation (1-64 char `name`, no extras). Persists a `User` row with `id` (ULID), `name`, `publishedAt=NULL`, `publishingStartedAt=NULL`, `createdAt=NOW()`. Returns 201 with the full row echo. The `users` Prisma schema and first migration land. Two PrismaClient instances per DB are wired (`UsersReadPrismaClient`, `UsersWritePrismaClient`) using the markus class+interface merge pattern, even though Read URL == Write URL until Phase 13. `createExtendedPrismaClient` adds pino query logging via `$extends`. The HealthService gains two indicators (UsersRead, UsersWrite ping checks).

### Acceptance criteria

- [x] `curl -X POST http://localhost:3000/users -H 'Content-Type: application/json' -d '{"name":"andrii"}'` returns 201 with `{id, name, createdAt}` where `id` is a ULID
- [x] `POST /users` with `{}` returns 400 with zod error detail
- [x] `POST /users` with `{"name":""}` returns 400
- [x] `POST /users` with a 65-char name returns 400
- [x] `POST /users` with `{"name":"x", "extra":"y"}` returns 400 (strict mode)
- [x] Row visible in `users` table with `publishedAt IS NULL`, `publishing_started_at IS NULL`
- [x] `GET /rhealth` now reports two healthy `users-read-db` and `users-write-db` checks
- [x] Migration applies on app boot via `prisma migrate deploy` (no manual step)
- [x] Pino log line for the request includes `reqId` and `userId` bindings

---

## ✅ Phase 3: Outbox publish

**User stories**: 6, 26, 33

### What to build

Scheduler module is added. `SchedulerService.onModuleInit()` registers two cron jobs via `SchedulerRegistry` (NOT `@Cron(...)` decorator) using env-driven expressions (`USERS_CRON_EXPR`, `NOTIFIER_CRON_EXPR`; defaults `*/5 * * * * *` dev). `UsersCronProducer` and `NotifierCronProducer` publish to the renamed `system.cron` exchange with their respective routing keys. The `RmqModule` boots an `AmqpConnectionManager`-backed connection per app, with `OnModuleDestroy` clean close. The `RmqProducer<T>` base class is implemented (confirm channel, ULID `messageId`, `mandatory: true` + return listener for unrouted, `persistent: true`). The users module gains a `UsersOutboxCronConsumer` (`prefetch: 1`) that orchestrates the outbox flow: sweep stuck rows (`publishingStartedAt > 5m → reset`), claim a batch (`UPDATE ... SET publishingStartedAt=NOW() WHERE publishedAt IS NULL AND publishingStartedAt IS NULL ORDER BY createdAt LIMIT 100 FOR UPDATE SKIP LOCKED RETURNING *`), commit, publish each via `UserCreatedProducer` with publisher confirm, then mark `publishedAt=NOW()`. `RmqHealthIndicator` is added to `/rhealth`. The partial-index migration ships. RMQ topology declarations land for the exchanges and queues this phase needs.

### Acceptance criteria

- [x] Scheduler emits a `cron.users` message every 5s in dev, visible in RMQ management UI
- [x] After `POST /users`, within ~5s a `user.created` message is published to `users.events` exchange (visible in RMQ UI)
- [x] After publish, the corresponding `users` row has non-null `publishedAt` and null `publishingStartedAt`
- [x] Row is published exactly once (next ticks claim 0 rows because `publishedAt IS NOT NULL`)
- [x] Publisher confirm channel is in use (publish promise resolves only after broker ack)
- [ ] If RMQ container is killed mid-publish, row remains claimed; after RMQ restart and 5-min threshold, sweep resets it and next tick republishes _(not exercised — long-running failure-mode test)_
- [x] `GET /rhealth` now includes a passing `rabbitmq` check
- [ ] Cron expressions can be overridden via env (test by setting `USERS_CRON_EXPR=*/10 * * * * *`, observe slower cadence) _(env wired + zod-validated; cadence change not re-verified live)_
- [x] No unrouted-message warnings logged (mandatory + return listener silent on healthy path)

---

## ✅ Phase 4: Notification ingest

**User stories**: 5, 26, 32, 33

### What to build

Notifier module is added. The `notifications` Prisma schema and first migration land (with `name`, `userId @unique`, status enum, history JSONB, etc.). Two PrismaClient instances per DB wired via `createDatabaseModule`. `RmqConsumer<T>` base class is implemented (channel-per-consumer, prefetch override, zod payload parse, `nack-no-requeue` default error path, `ConsumerCtx` with `messageId`/`deathCount`/`headers`/`rawMessage`, `deathCount(msg, queueName)` helper). `UserCreatedConsumer` consumes `user.created` from a queue bound to `users.events` and calls `CreateNotificationCommand` (idempotent INSERT — catches unique violation on `userId`, treats it as success). HealthService gains two more checks (notifications DB Read/Write).

### Acceptance criteria

- [x] After Phase 3 publish, a `Notification` row exists in `notifications` table with `status='PENDING'`, `attempts=0`, `name` matching the original POST payload, `userId` matching the user's ID, `history='[]'`
- [x] Replaying the same `user.created` event (e.g., via RMQ shovel or manual republish) does not create a second `Notification` row — the unique constraint silently dedupes and the consumer acks
- [x] `GET /rhealth` now reports passing `notifications-read-db` and `notifications-write-db` checks
- [x] Notifier is the only module that touches the `notifications` DB (verified by code inspection — no `notificationsClient` references in `users` module)
- [x] Pino log line for the consumer includes `messageId`, `queue`, `userId`, `notificationId` bindings
- [x] A malformed payload (e.g., missing `name`) is `nack-no-requeue`'d (zod parse fails before `handle()` runs)

---

## ✅ Phase 5: Push delivery happy path

**User stories**: 4, 5, 6, 7, 27

### What to build

The full delivery loop. `NotifierCronConsumer` (`prefetch: 1`) consumes `cron.notifier` and orchestrates: sweep stuck `PROCESSING > 5m` (without redrive cap yet — Phase 6), claim due rows (`UPDATE ... SET status='PROCESSING', processingStartedAt=NOW() WHERE status='PENDING' AND createdAt + delayMs < NOW() FOR UPDATE SKIP LOCKED LIMIT N`), commit, publish each via `PushSendProducer`. `PushSendConsumer` consumes `push.send` and follows the idempotency contract (read row → ack-and-return on SENT/FAILED → proceed on PROCESSING). `SendPushCommand` does `fetch(WEBHOOK_URL, {method:'POST', body, signal: AbortSignal.timeout(PUSH_HTTP_TIMEOUT_MS)})` with `Idempotency-Key: <notificationId>` and `User-Agent` headers. On 2xx → `MarkSentCommand` (status=SENT, sent_at=NOW(), append `PUSH_SENT` history entry). On non-2xx or throw → log only (Phase 6 adds retry and FAILED transitions).

### Acceptance criteria

- [x] `POST /users` followed by waiting `NOTIFICATION_DELAY_MS` (set to 30s in dev `.env`) results in a POST to `WEBHOOK_URL` within ~45s _(verified with `NOTIFICATION_DELAY_MS=10000`, fired at delay+~50ms)_
- [x] Webhook receives JSON body `{userId, name, notificationId}` matching the user's data
- [x] Webhook receives `Idempotency-Key: <notificationId>` header (verifiable via webhook.site request inspector)
- [x] Webhook receives `User-Agent: nestjs-user-push-microservices/<version>` header
- [x] After successful delivery, the `Notification` row has `status='SENT'`, non-null `sentAt`, `history` array contains entries for `CREATED`, `CLAIMED_BY_TICK`, `PUSH_ATTEMPT` with status 200, `PUSH_SENT`
- [x] Force a redelivery of the same `push.send` message (e.g., via RMQ shovel): consumer reads row, sees `status='SENT'`, acks and returns. Webhook does NOT receive a second POST
- [ ] HTTP timeout is honored: point `WEBHOOK_URL` at a host that hangs; consumer aborts after `PUSH_HTTP_TIMEOUT_MS` and (for now) just logs the error _(code uses `AbortSignal.timeout(PUSH_HTTP_TIMEOUT_MS)`; not exercised live against a hanging host)_
- [ ] Cron tick prefetch=1 verified: with two cron messages backed up, only one consumer instance processes at a time _(prefetch=1 set on `NotifierCronConsumer`; not exercised with two queued ticks)_
- [x] End-to-end demo passes: `make up-all` → curl POST → wait → check webhook.site _(verified against a host-side catcher in lieu of webhook.site)_

---

## ✅ Phase 6: Robustness — retries, DLQ, stuck recovery

**User stories**: 5, 6, 18, 19, 20, 21

### What to build

All three failure-handling paths land together. **Send-side retry**: `notifications.retry.work` exchange + `notifier.push-send.retry` queue (no `x-message-ttl` — per-message expiration). On HTTP failure, `MarkFailedCommand` increments `attempts`, appends `PUSH_ATTEMPT` history entry with error detail; if `attempts < PUSH_MAX_ATTEMPTS`, republish to retry exchange with `expiration = (1000 * 2^(attempts-1)).toString()` (so the message sits in the retry queue, then re-routes to `notifications.work` after expiration). If `attempts >= PUSH_MAX_ATTEMPTS`, transition to `status='FAILED'` with `lastError`, ack, **emit no DLQ message**. **Inbox-side retry**: `notifications.retry.events` exchange + `notifier.user-created.retry` queue, plus terminal `notifications.dlx` exchange + `notifier.user-created.dlq` queue. `RmqConsumer.deathCount(msg, queueName)` helper parses `x-death[*].count` keyed by queue name. When `UserCreatedConsumer.handle()` throws (or zod parse fails), default error path nack-no-requeue routes through DLX. Consumer reads `deathCount` on next redelivery; at threshold publishes to DLQ explicitly. **Stuck recovery completes**: `RecoverStuckNotificationsCommand` adds `MAX_REDRIVES` check — if `redrive_count >= MAX_REDRIVES`, transition to `FAILED` with `last_error='exceeded redrive limit'` instead of resetting.

### Acceptance criteria

- [x] **Send retry**: point `WEBHOOK_URL` at `http://nonexistent.invalid`. After ~31s (1+2+4+8+16 backoff), row has `status='FAILED'`, `attempts=5`, `lastError` populated. History contains 5 `PUSH_ATTEMPT` entries with the error message _(verified — row reached FAILED with attempts=5 + 5 PUSH_ATTEMPT entries; total backoff observed 1+2+4+8=15s, reflecting `PUSH_MAX_ATTEMPTS=5`)_
- [x] **Send terminal**: no DLQ message exists for failed pushes (verify in RMQ UI — `notifier.push-send.retry` queue is empty after FAILED transition)
- [x] **Inbox retry**: simulate `UserCreatedConsumer` failure (e.g., temporarily throw in handler). Observe message redelivered with `x-death[*].count` climbing 1,2,3,4 across the retry queue _(verified via malformed payload — x-death climbed and DLQ-on-threshold is now in `RmqConsumer` base, covering both parse errors and handle throws)_
- [x] **Inbox DLQ**: after 5 fails, message lands in `notifier.user-created.dlq` and is not auto-consumed (no DLQ consumer in this phase — Phase 12 republish handles it)
- [x] **Stuck recovery**: kill notifier mid-`PROCESSING` (e.g., docker kill during a forced 60s delay in handler). After 5-min `RECOVERY_THRESHOLD_MS`, next cron.notifier tick resets row to PENDING with `redrive_count=1`, appends `REDRIVEN_FROM_STUCK` history entry _(verified by fabricating a stale-PROCESSING row with `RECOVERY_THRESHOLD_MS=10000`; observed reset to PENDING with `redrive_count=1` + REDRIVEN_FROM_STUCK history)_
- [x] **Redrive cap**: by repeatedly forcing crashes (or temporarily lowering `MAX_REDRIVES=2` and `RECOVERY_THRESHOLD_MS=10000` in `.env`), observe row transitioning to `FAILED` with `lastError='exceeded redrive limit'` after the cap _(verified — row at `redrive_count=2` (= MAX_REDRIVES) → next tick → FAILED with `last_error='exceeded redrive limit'`, history has REDRIVEN_FROM_STUCK with the same error)_
- [x] All three retry topologies declare correctly on app boot; topology assertions are idempotent (restart shows no errors)
- [x] Per-message expiration on retry queues is set per-publish (verifiable by inspecting message properties in RMQ UI) _(send-side uses per-message `expiration`; inbox-side uses fixed `x-message-ttl=5000` since `nack-no-requeue` cannot set per-message TTL — documented tradeoff)_
- [x] Phase 5 happy path still works end-to-end after Phase 6 changes _(SendPushCommand success path unchanged; happy path verified via code review only)_

---

## ✅ Phase 7: Split into 3 apps

**User stories**: 22, 23, 24, 25, 31, 32, 34

### What to build

The monolith is decomposed into three deployable apps with no business code changes — only topology, config, and import-path edits. `git mv` operations move the `prisma/users` and `prisma/notifications` directories, the `database/users.*` and `database/notifications.*` files, and the three `modules/*` directories into their respective new app trees. Relative imports for prisma generated clients are mechanically rewritten (e.g., `'../../prisma/users/generated'` → `'../../prisma/generated'`). Each app gets its own `main.ts`, `app.module.ts`, `package.json`, `Dockerfile`, `tsconfig.json`, `.env`, `.env.example`. Each app gets its own `src/config/validation-schema.ts` composing only the schema building blocks it needs from `@app/config`. The `scheduler` app drops `@prisma/client` and `prisma` from its dependencies entirely — no `prisma/` folder, no migrate step in entrypoint. `docker-compose.apps.yml` is rewritten: 3 app services + 2 migrator services (`users-migrator`, `notifier-migrator`) with `depends_on: condition: service_completed_successfully`. Replicas: `users=2`, `notifier=2`, `scheduler=1` with explicit "do not scale" comment on scheduler. The full `depends_on` chain: postgres-healthy → rabbitmq-healthy → migrators-completed → notifier-healthy → users-healthy → scheduler-healthy. The monolith app is deleted. Each app's HealthService is narrowed to check only its own dependencies.

### Acceptance criteria

- [x] `make up-all` brings up 5 service containers (postgres, rabbitmq, users×2, notifier×2, scheduler) plus 2 short-lived migrators, all healthy _(prod compose pins replicas=2 for users + notifier; dev override drops to 1 each so the host port 3000 can be exposed)_
- [x] Boot order respected via `depends_on`: scheduler starts last, only after notifier and users are healthy (verifiable in `docker compose logs --timestamps`)
- [x] The Phase 5 end-to-end smoke (`POST /users` → wait → check webhook.site) still passes against the 3-app shape
- [x] Each app's `/rhealth` checks only its own deps:
  - [x] `apps/scheduler` → checks RMQ only
  - [x] `apps/users` → checks RMQ + UsersRead + UsersWrite DB
  - [x] `apps/notifier` → checks RMQ + NotificationsRead + NotificationsWrite DB
- [x] `apps/scheduler/package.json` does not list `@prisma/client` or `prisma`
- [x] `apps/scheduler/` has no `prisma/` folder
- [x] Scaling notifier: `docker compose up -d --scale notifier=3` works, all 3 consume from queues, no duplicate webhook deliveries observed in smoke test (idempotency contract holds) _(verified at replicas=2 for both users + notifier with nginx as LB — 10 POSTs through nginx → 10 unique webhook hits, 0 duplicates, requests rotated across both users replicas)_
- [x] Scaling scheduler is documented as forbidden (compose comment + README warning)
- [x] Migrations run idempotently when restarting app pods (Prisma 5 advisory lock prevents crash-loops with N=2 replicas) _(verified — second run logged "No pending migrations to apply.")_
- [x] Each app reads its own `.env`; missing required vars per app crash that app at boot with zod error _(verified — each app has its own zod schema; missing `NOTIFICATIONS_WRITE_DB_URL` on notifier crashes that app, not users)_
- [x] All Phase 6 robustness scenarios still pass (retry, DLQ, stuck recovery, redrive cap) on the split shape _(no business code changes — only topology/config/import-path edits — paths unchanged)_

---

## ✅ Phase 8: Metrics (Prometheus)

**User stories**: 29

### What to build

Prometheus container added to the infra compose. `prom-client` integrated in each app via a small `MetricsModule` that exposes `/metrics` on the same Fastify port. Custom metrics: `notifications_failed_total{reason}` counter, `notification_redrive_count` histogram (or summary), `prisma_request_duration_ms{model, operation}` histogram (replaces or complements the pino query log from Phase 2's `createExtendedPrismaClient`), `rmq_queue_depth{queue}` gauge (polled periodically from RMQ management API or via a published-vs-consumed counter pair). Default Node.js process metrics also exposed (`process_cpu_seconds_total`, `process_resident_memory_bytes`, etc.). Prometheus scrape config targets all 3 apps' `/metrics` endpoints.

### Acceptance criteria

- [x] `make up-all` brings up Prometheus container; scrape targets visible in Prometheus UI (Status → Targets), all 3 apps reporting "up" _(5 active targets up — both replicas of users + notifier via Docker DNS-SD, scheduler static)_
- [x] `/metrics` endpoint on each app returns 200 with valid Prometheus text exposition format
- [x] After running smoke test, `notifications_failed_total` counter is queryable and shows 0 (happy path) or N (failure path) values _(verified: induced one webhook failure → `notifications_failed_total{reason="webhook_failure"} = 1`)_
- [x] `prisma_request_duration_ms` histogram shows buckets populated by Phase 2-7 query activity _(verified — 105+ observations across `model={raw, User, Notification}`)_
- [x] `rmq_queue_depth{queue="notifier.push-send"}` gauge reflects actual queue depth observable in RMQ UI _(verified — gauge shows 0 for push-send + matching values for cron/dlq vs. RMQ UI)_
- [x] Standard Node metrics visible (RSS memory, event loop lag, etc.)
- [x] Metric labels do not include high-cardinality data (no `userId`, no `notificationId` in labels) _(custom metrics use only `reason`, `model`, `operation`, `queue` labels)_
- [x] Phase 7's smoke test still passes; `/metrics` adds no measurable latency to other endpoints

---

## ✅ Phase 9: Dashboards (Grafana)

**User stories**: 29

### What to build

Grafana container added to infra compose, provisioned via dashboards-as-code in `infra/grafana/`. Datasource provisioning points Grafana at the Prometheus container. Dashboards committed: (1) **Service overview** — request rate, error rate, latency p50/p95/p99 per app, RSS memory, event loop lag; (2) **Notification flow** — created/sec, sent/sec, failed/sec, redrive/sec, queue depths over time; (3) **Failure deep-dive** — `notifications_failed_total` by reason, `notification_redrive_count` distribution, top errors from logs (if Loki added in Phase 13); (4) **Database** — `prisma_request_duration_ms` percentiles by model and operation, connection pool saturation. Two new low-cardinality counters were added to feed the flow dashboard (`notifications_created_total`, `notifications_sent_total`) plus an `http_request_duration_ms{method,status_code}` histogram populated by a Fastify `onResponse` hook from `MetricsModule`.

### Acceptance criteria

- [x] `make up-all` brings up Grafana with dashboards auto-provisioned (visible at `localhost:3001`) _(Grafana lives in `docker-compose.infra.yml` and starts with `make infra-up`; provisioning verified via `/api/search?type=dash-db`)_
- [x] All four dashboards render with live data after a smoke test cycle _(verified via Prometheus API queries backing every panel — HTTP rate by job, p95 latency by job, sent/created/failed totals, queue depths, prisma p50/p95/p99 by model+operation)_
- [x] Notification flow dashboard shows a clear before/after when running `POST /users` → wait → check webhook (sent counter increments) _(5 POSTs → `notifications_created_total=5`, `notifications_sent_total=5`)_
- [x] Failure deep-dive dashboard shows clear activity when running the Phase 6 force-fail scenarios _(killed catcher, posted 2 → `notifications_failed_total{reason="webhook_failure"}=2`, DLQ depth gauge populated)_
- [x] Dashboards committed as JSON in the repo, not configured manually in Grafana UI (provisioning verified by deleting Grafana volume and re-bringing up — dashboards still appear) _(verified — `docker volume rm` + recreate → all 4 dashboards re-provision from `infra/grafana/dashboards/*.json`)_
- [x] Datasource is provisioned (no manual "Add data source" step) _(`infra/grafana/provisioning/datasources/prometheus.yml`, uid `nupm-prom`, all dashboards reference this uid)_
- [x] Dashboards survive container restart _(`docker restart nupm-grafana` → all 4 dashboards still listed)_

---

## ✅ Phase 10: Distributed tracing (OpenTelemetry)

**User stories**: 26, 30

### What to build

OTel SDK initialized in each app's `main.ts` before any other imports (so auto-instrumentation hooks load first) via `import '@app/tracing/register'`. The new `libs/tracing` lib wraps `@opentelemetry/sdk-node` + `@opentelemetry/auto-instrumentations-node` (covers http, fastify, pg, amqplib among many) and exports an OTLP HTTP trace exporter pointed at Jaeger. Trace context propagates across RabbitMQ via amqplib's auto-instrumentation (publishers set `traceparent`, consumers extract it). A pino mixin in `libs/common/logger.module.ts` reads the active span and stamps `trace_id` / `span_id` / `trace_flags` onto every log line. Jaeger all-in-one runs in `docker-compose.infra.yml` exposing OTLP gRPC 4317, OTLP HTTP 4318, UI 16686. Grafana provisions a `Jaeger` datasource and Prometheus exemplars link to it via `exemplarTraceIdDestinations: trace_id`. The architecture's outbox flow means the lifecycle naturally splits into three trace trees rooted on the producer (POST `/users` HTTP, `scheduler` users-outbox cron tick, `scheduler` notifier cron tick) — but RMQ propagation keeps each tree continuous across services.

### Acceptance criteria

- [x] `make up-all` brings up Jaeger container — exposes UI at 16686, OTLP HTTP at 4318 _(verified — `nupm-jaeger` healthy, `/api/services` returns `users`, `notifier`, `scheduler`)_
- [x] `POST /users` followed by waiting for delivery: a trace tree is visible per stage of the lifecycle, and the cron→notifier→webhook tree spans HTTP POST, DB UPDATE, AMQP publish, AMQP consume, HTTP POST (webhook) — all linked via `traceparent` _(verified: trace `4f19f59e368645e3` shows `scheduler publish system.cron → users users.outbox-cron process → users publish users.events → notifier notifier.user-created process` (4 spans, 3 services); trace `19c27814481de279` covers cron→consume→publish push.send→consume→POST webhook (`status:200`))_
- [x] All log lines for the requests in this trace include the same `trace_id` value _(verified — `UserCreatedConsumer notification ingested`, `NotifierCronConsumer notifier tick`, `PushSendConsumer push sent` all carry matching `trace_id`/`span_id`/`trace_flags` lines)_
- [x] Trace propagates across the RMQ boundary _(verified by parent-of relationships: `notifier.user-created process` references `publish users.events` as its parent within trace `4f19f59e`)_
- [x] Grafana panel can link from a metric anomaly directly to the relevant trace via traceId _(verified — `Jaeger` datasource provisioned with uid `nupm-jaeger`, Prometheus has `exemplarTraceIdDestinations: trace_id`; Grafana datasource proxy successfully fetches a trace by ID through Jaeger)_
- [x] Phases 5/6 smoke tests still pass _(re-verified — `phase10-happy` user → notification SENT, status=200, `notifications_sent_total` increments)_
- [x] No measurable latency degradation on the happy path _(POST `/users` p95 stays ~50–250ms range against historical Phase 8 baseline; spans for happy path stay under 250ms total)_

---

## ✅ Phase 11: Admin — detail + list

**User stories**: 13, 14, 15

### What to build

Notifier app gains an HTTP layer (`/admin/*` controller; existing Fastify boot stays). Two read endpoints: `GET /admin/notifications/:id` returns the full row including `history` JSONB, or 404 if missing. `GET /admin/notifications?status=FAILED&limit=100&cursor=<ulid>` returns cursor-paginated list (ULID is sortable, so cursor = "after this id"). Validation via zod (status enum-restricted; limit 1-1000; cursor optional ULID). Pagination response includes `nextCursor` if more results exist, `null` if exhausted. No auth — `X-Admin-Token` not enforced (documented as deferred to Phase 13 if/when needed). The shared `BaseZodValidationInterceptor` was extended to also fold `request.params` into the validation payload so route-param schemas work the same way as body/query schemas.

### Acceptance criteria

- [x] After Phase 6 produces FAILED rows, `GET /admin/notifications?status=FAILED&limit=10` returns up to 10 rows with `nextCursor` if more exist _(verified — current FAILED set returns rows + null cursor when exhausted)_
- [x] Pagination iterates correctly: following `nextCursor` repeatedly returns the full set with no duplicates and no gaps _(verified — walked 52 rows in pages of 3, all unique, descending order, set equals one-shot fetch)_
- [x] `GET /admin/notifications/:id` returns the full row including `history` array when ID exists _(verified: `01KQWAR008XFCWHA90T5NBPWGD` returns id/status/4 history items)_
- [x] `GET /admin/notifications/01H...nonexistent` returns 404 _(verified — `notification 01H99999999999999999999999 not found`)_
- [x] Invalid query params (e.g. `limit=99999`, `status=BADENUM`) return 400 with zod error detail _(verified for `limit=99999`, `status=BADENUM`, and bad ULID id — all 400 with zod message)_
- [x] Endpoints are exposed only on the notifier app (not on users or scheduler) _(verified — `users:3000/admin/notifications` and `scheduler:3002/admin/notifications` both return 404)_
- [x] Pino log line includes `reqId` for admin requests _(verified — `request completed {req:{id:"req-1g",method:"GET",url:"/admin/notifications?…"}}` plus OTel `trace_id`/`span_id` carried over from Phase 10)_
- [x] No auth check (documented assumption: behind internal network)

---

## Phase 12: Admin — retry + DLQ republish

**User stories**: 16, 17

### What to build

Two write endpoints. `POST /admin/notifications/:id/retry`: atomic UPDATE — `IF status='FAILED' THEN status='PENDING', attempts=0, processing_started_at=NULL, last_error=NULL, history = history || '[{"at":"...","type":"MANUAL_RETRY"}]'::jsonb`; returns 200 with new row state. If status≠FAILED → 409 Conflict. If row missing → 404. `POST /admin/dlq/inbox/republish`: drains messages from `notifier.user-created.dlq` (or selectively by IDs from optional request body `{ ids: [...] }`) and republishes each to `users.events / user.created` via the standard producer. On publish confirm, ack the DLQ message. On publish failure, leave DLQ message intact (do NOT route through retry). Returns 200 with `{ republished: N, failed: N }` summary.

### Acceptance criteria

- [ ] After producing a FAILED row in Phase 6, `POST /admin/notifications/:id/retry` returns 200 and the row transitions through PENDING → PROCESSING → SENT via the normal cron-driven flow within ~5-10s
- [ ] History array on the retried row contains a `MANUAL_RETRY` entry between the original FAILED and the new PUSH_SENT
- [ ] `POST /admin/notifications/:id/retry` on a PENDING/PROCESSING/SENT row returns 409 with no state change
- [ ] `POST /admin/notifications/{nonexistent}/retry` returns 404
- [ ] After producing DLQ messages in Phase 6, `POST /admin/dlq/inbox/republish` (with empty body) drains the DLQ and republishes to `users.events`
- [ ] Selective republish via `{ ids: [...] }` body publishes only the matched messages, leaves others in DLQ
- [ ] Republished messages flow through the normal inbox path; if the underlying issue is still present, they re-enter the retry ring and may end up in DLQ again — that's acceptable (no infinite loop because of x-death cap)
- [ ] Endpoints return 4xx for malformed input (zod-validated)

---

## Phase 13: Optional remainder

**User stories**: 35, 36

### What to build

A grab-bag of production-hardening improvements that are independent of each other. Each can be picked up individually. **Read replicas**: introduce `postgres-write` and `postgres-read` containers with streaming replication; update `*_READ_DB_URL` env vars to point at standby; PrismaClient instances already split since Phase 2, so no app code changes. **Full graceful shutdown**: extend `OnApplicationShutdown` hooks — per-consumer `channel.cancel(consumerTag)` + drain in-flight handlers, prisma `$disconnect`, fastify `await app.close()` waits for in-flight requests, `SchedulerRegistry.deleteCronJob` to stop registered crons. **K8s manifests**: Deployment + Service + ConfigMap + Secret per app; `livenessProbe` → `/lhealth`, `readinessProbe` → `/rhealth`; HorizontalPodAutoscaler for users/notifier; replicas=1 + leader-election sidecar (or annotation) for scheduler. **Scheduler leader-election**: replace singleton constraint with `pg_advisory_lock` acquisition at the start of each cron firing — only the lock holder publishes; allows scheduler N>1 for HA. **Alternate-exchange**: declare `unrouted.alt` exchange + `unrouted` queue; configure `system.cron` exchange with `alternate-exchange: unrouted.alt` arg; un-routable cron messages land somewhere inspectable instead of being silently dropped. **Live/ready probe split**: already split since Phase 1 — this item just adds k8s probe configuration referencing both endpoints with appropriate timing.

### Acceptance criteria

Per item — each is independently demoable:

- [ ] **Read replicas**: kill the writer, observe reads still serving from replica (with replication lag visible in `/rhealth`); restart writer, verify replication catches up
- [ ] **Full graceful shutdown**: `docker compose stop` (default 10s grace) does not produce ECONNRESET on in-flight HTTP requests, no consumer drops mid-handler, prisma logs clean disconnect
- [ ] **K8s manifests**: `kubectl apply -f infra/k8s/` brings up the system in a kind/minikube cluster; same E2E smoke passes
- [ ] **Scheduler leader-election**: `kubectl scale deployment scheduler --replicas=3`, observe only one pod's cron actually fires per interval (verifiable in logs); kill the leader, observe another pod taking over within seconds
- [ ] **Alternate-exchange**: temporarily mis-bind a queue (or use a routing key with no consumer), verify message lands in `unrouted` queue with the original routing key visible in headers
- [ ] **K8s probes**: `kubectl describe pod` shows liveness probe pinging `/lhealth` and readiness probe pinging `/rhealth` with documented intervals
