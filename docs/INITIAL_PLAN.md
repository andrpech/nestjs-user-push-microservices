# NestJS User Push Microservices — Design Plan

## Мета

Система мікросервісів, яка приймає HTTP-запит на створення користувача, зберігає в БД, а через 24 години надсилає йому push-сповіщення (HTTP до webhook.site). Сервіси не залежать один від одного напряму — комунікація виключно через RabbitMQ.

## Phases

| Phase                     | Зміст                                                                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Scaffolding**        | Голий NestJS-проєкт з усім dev tooling, без бізнес-логіки. Health endpoints (`/lhealth` + `/rhealth`) через `@nestjs/terminus` з порожнім списком перевірок                                                                         |
| **2. Monolith**           | Один NestJS app з 3-ма модулями (users / scheduler / notifier). Інфра + БД + RMQ + повний end-to-end flow з outbox pattern і DLX retry                                                                                              |
| **3. Split**              | Розщеплення monolith на 3 окремі deployable apps. Бізнес-код не змінюється — тільки топологія + relative-import rewrite для prisma generated clients                                                                                |
| **4. Monitoring & Infra** | Prometheus + Grafana + OpenTelemetry. End-to-end trace propagation через apps + RMQ + Postgres. Dashboards. Custom metrics (notification_failed_total, prisma latency, RMQ depth)                                                   |
| **5. Admin & Recovery**   | `notifier` app отримує HTTP layer. `/admin/notifications/:id`, `/admin/notifications?status=FAILED`, `/admin/notifications/:id/retry`, `/admin/dlq/inbox/republish`. No auth (assumed behind internal network)                      |
| **6. Optional remainder** | Read replicas (postgres-write + postgres-read), повний graceful shutdown (per-consumer drain), K8s manifests, scheduler leader-election (`pg_advisory_lock`), alternate-exchange для unrouted cron messages, live/ready probe split |

---

## Stack

| Компонент     | Вибір                                                                                                                      | Альтернатива (відкинута)                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Runtime       | Node 22 LTS                                                                                                                | —                                                                                          |
| Framework     | NestJS 11                                                                                                                  | —                                                                                          |
| HTTP adapter  | Fastify                                                                                                                    | Express (повільніший, default Nest)                                                        |
| ORM           | Prisma 7                                                                                                                   | TypeORM (multi-DB складніше), Drizzle (менш зрілий)                                        |
| DB            | Postgres 16                                                                                                                | MySQL (Prisma multi-DB workflow гірший)                                                    |
| Broker        | RabbitMQ 3                                                                                                                 | Redis/BullMQ (не подобається змішування), NATS                                             |
| RMQ lib       | `amqplib` + `amqp-connection-manager`                                                                                      | `@nestjs/microservices` (відкинуто), `@golevelup/nestjs-rabbitmq` (відкинуто, third-party) |
| Validation    | `zod` + `nestjs-zod`-style interceptor                                                                                     | `class-validator` (стандарт Nest, але ми вибираємо zod скрізь)                             |
| Logger        | `nestjs-pino`                                                                                                              | стандартний Nest Logger                                                                    |
| Config        | `@nestjs/config` `registerAs` + zod `ConfigSchema` parse-on-boot, typed DI через `ConfigurationInjectKey` (markus pattern) | raw `process.env`                                                                          |
| Health        | `@nestjs/terminus`, `/lhealth` + `/rhealth` (markus pattern)                                                               | custom stub                                                                                |
| Cron          | `@nestjs/schedule` через `SchedulerRegistry` dynamic registration                                                          | `@Cron(...)` decorator (decorator evaluates before config loads)                           |
| ID generation | `ulid` package, app-level                                                                                                  | UUID v4, Postgres extension                                                                |
| Workspaces    | npm workspaces                                                                                                             | NestJS workspaces (відкинуто, бо single image), nx/turbo (overkill)                        |
| Tests         | none (skipped — E2E smoke test is QA path)                                                                                 | vitest, jest                                                                               |

---

## Repo Layout

```
nestjs-user-push-microservices/
├── package.json                          # root: { "workspaces": ["apps/*", "libs/*"] }
├── Makefile
├── .gitignore
├── .nvmrc
├── .oxlintrc.json
├── .prettierrc
├── tsconfig.json                          # base, з paths для @app/*
├── docker-compose.infra.yml               # postgres + rabbitmq
├── docker-compose.apps.yml                # apps (Phase 2: monolith; Phase 3: 3 services)
├── docker-compose.dev.override.yml        # bind-mount + start:dev + CHOKIDAR_USEPOLLING
├── infra/
│   ├── postgres/
│   │   └── init.sql                       # CREATE DATABASE users; CREATE DATABASE notifications;
│   └── rabbitmq/
│       └── (пусто — стандартний образ; плагіни не потрібні)
├── scripts/
│   ├── lint-staged.sh                     # 9 git-aware скриптів з markus
│   ├── lint-changed.sh
│   ├── lint-branch.sh
│   ├── lint-fix-staged.sh
│   ├── lint-fix-changed.sh
│   ├── lint-fix-branch.sh
│   ├── format-staged.sh
│   ├── format-staged-write.sh
│   └── format-branch.sh
├── PLAN.md                                # цей файл
├── README.md
├── apps/
│   └── monolith/                          # Phase 2 only — буде видалено в Phase 3
│       ├── package.json                   # @app/monolith
│       ├── .env                           # compose hostnames (postgres, rabbitmq); gitignored
│       ├── .env.example
│       ├── Dockerfile                     # multi-stage: builder → runtime
│       ├── tsconfig.json
│       ├── prisma/
│       │   ├── users/
│       │   │   ├── schema.prisma          # User model, datasource → USERS_WRITE_DB_URL
│       │   │   ├── migrations/
│       │   │   └── generated/             # gitignored, output of prisma generate
│       │   └── notifications/
│       │       ├── schema.prisma          # Notification model, datasource → NOTIFICATIONS_WRITE_DB_URL
│       │       ├── migrations/
│       │       └── generated/
│       └── src/
│           ├── main.ts                    # import 'dotenv/config'; bootstrap Fastify + pino + zod pipe + enableShutdownHooks
│           ├── app.module.ts              # імпортує UsersModule, SchedulerModule, NotifierModule, HealthModule
│           ├── config/
│           │   ├── validation-schema.ts   # MonolithConfigSchema = z.strictObject({ app, database, rmq, notification, cron, webhook })
│           │   └── configuration.ts       # registerAs('app', ...), ConfigSchema.parse(config)
│           ├── health/
│           │   ├── health.controller.ts   # /lhealth (sync ok) + /rhealth (@HealthCheck)
│           │   ├── health.service.ts      # инжектит PrismaHealthIndicator + 4 prisma clients + RmqHealthIndicator
│           │   └── health.module.ts
│           ├── database/
│           │   ├── users.clients.ts       # UsersReadPrismaClient, UsersWritePrismaClient (class+interface merge)
│           │   ├── users.database.module.ts
│           │   ├── notifications.clients.ts
│           │   └── notifications.database.module.ts
│           └── modules/
│               ├── users/
│               │   ├── commands/          # CreateUserCommand, ClaimPendingUsersCommand, MarkUsersPublishedCommand, RecoverStuckUsersCommand
│               │   ├── queries/
│               │   ├── services/          # UsersService (HTTP-side orchestrator), UsersOutboxService (cron-side orchestrator)
│               │   ├── transport/
│               │   │   ├── consumers/     # UsersOutboxCronConsumer
│               │   │   └── producers/     # UserCreatedProducer
│               │   ├── dto/
│               │   ├── users.controller.ts
│               │   └── users.module.ts
│               ├── scheduler/
│               │   ├── services/          # SchedulerService — registers two crons via SchedulerRegistry
│               │   ├── transport/
│               │   │   └── producers/     # UsersCronProducer, NotifierCronProducer
│               │   └── scheduler.module.ts
│               └── notifier/
│                   ├── commands/          # SendPushCommand, MarkSentCommand, MarkFailedCommand,
│                   │                       # RecoverStuckNotificationsCommand, ClaimDueNotificationsCommand,
│                   │                       # CreateNotificationCommand
│                   ├── queries/
│                   ├── services/          # NotifierService — orchestrator
│                   ├── transport/
│                   │   ├── consumers/     # UserCreatedConsumer, NotifierCronConsumer, PushSendConsumer
│                   │   └── producers/     # PushSendProducer (self-loop)
│                   └── notifier.module.ts
└── libs/
    ├── database-core/
    │   ├── package.json                   # @app/database-core
    │   ├── tsconfig.json
    │   └── src/
    │       ├── create-prisma-client.ts    # createExtendedPrismaClient(Ctor, url, logger) — pino query logging
    │       ├── prisma-clients-base.ts     # generic class+interface merge helpers (Read/Write tokens)
    │       ├── create-database-module.ts  # DI factory NestJS module
    │       └── index.ts
    ├── rmq/
    │   ├── package.json                   # @app/rmq
    │   └── src/
    │       ├── rmq.module.ts              # connection bootstrap
    │       ├── rmq-connection.ts          # AmqpConnectionManager wrapper, OnModuleDestroy → close()
    │       ├── rmq-health.indicator.ts    # @nestjs/terminus indicator: connectionManager.isConnected()
    │       ├── consumer.base.ts           # abstract RmqConsumer<T> (channel-per-consumer, zod parse, nack-no-requeue, deathCount helper)
    │       ├── producer.base.ts           # abstract RmqProducer<T> (confirm channel, ulid messageId, mandatory=true, return listener)
    │       ├── decorators/
    │       │   ├── consumer.decorator.ts  # @Consumer({ queue, prefetch })
    │       │   └── producer.decorator.ts  # @Producer({ exchange, routingKey })
    │       ├── types.ts                   # ConsumerCtx { messageId, deathCount, headers, rawMessage }
    │       └── index.ts
    ├── zod-validation/
    │   ├── package.json                   # @app/zod-validation
    │   └── src/
    │       ├── zod-schema.decorator.ts
    │       ├── base-zod-validation.interceptor.ts  # копія з martech-utils
    │       ├── validate-zod-schema.ts
    │       ├── zod-validation.exception.ts
    │       └── index.ts
    ├── config/
    │   ├── package.json                   # @app/config
    │   └── src/
    │       ├── schemas/                   # building-block zod schemas
    │       │   ├── app.schema.ts
    │       │   ├── database.schema.ts
    │       │   ├── rmq.schema.ts
    │       │   ├── notification.schema.ts
    │       │   ├── cron.schema.ts
    │       │   └── webhook.schema.ts
    │       └── index.ts                   # re-exports building blocks; each app composes its own ConfigSchema
    └── common/
        ├── package.json                   # @app/common
        └── src/
            ├── command.interface.ts       # interface Command<I, O = void> { execute(input: I): Promise<O> }
            ├── query.interface.ts         # interface Query<I, O>            { execute(input: I): Promise<O> }
            ├── logger.module.ts           # nestjs-pino setup with reqId/messageId/queue/userId/notificationId bindings
            ├── ulid.ts                    # re-export ulid()
            └── index.ts
```

### Phase 3 layout (after split)

```
apps/
├── users/                                 # @app/users — replicas: 2
│   ├── package.json
│   ├── .env, .env.example
│   ├── Dockerfile
│   ├── prisma/                            # users schema only
│   └── src/
│       ├── config/                        # UsersConfigSchema = z.strictObject({ app, database (users only), rmq, cron (usersExpr only), webhook })
│       ├── database/users.clients.ts
│       ├── modules/users/
│       └── modules/health/
├── notifier/                              # @app/notifier — replicas: 2
│   ├── package.json
│   ├── .env, .env.example
│   ├── Dockerfile
│   ├── prisma/                            # notifications schema only
│   └── src/
│       ├── config/                        # NotifierConfigSchema = z.strictObject({ app, database (notifications only), rmq, notification, cron (notifierExpr only), webhook })
│       ├── database/notifications.clients.ts
│       ├── modules/notifier/
│       └── modules/health/
└── scheduler/                             # @app/scheduler — replicas: 1 (singleton)
    ├── package.json                       # NO @prisma/client, NO prisma CLI
    ├── .env, .env.example
    ├── Dockerfile
    └── src/
        ├── config/                        # SchedulerConfigSchema = z.strictObject({ app, rmq, cron })
        ├── modules/scheduler/             # full Nest+Fastify app, /health route only
        └── modules/health/
```

---

## Module Boundaries

### `users` module

- **Owns:** `User` table в `users` DB
- **HTTP:** `POST /users` (тіло: `{ name: string }`, 1–64 chars, `.strict()`)
- **Response 201:** `{ id, name, createdAt }`
- **HTTP-side flow:** controller → `UsersService.createUser(dto)` → `CreateUserCommand` (INSERT user with `publishedAt=NULL, publishingStartedAt=NULL`) → return 201
- **Cron-side flow:** `UsersOutboxCronConsumer` (consumes `cron.users`) → `UsersOutboxService.processBatch()`:
  1. `RecoverStuckUsersCommand` — sweep `WHERE publishingStartedAt < NOW - 5m AND publishedAt IS NULL → publishingStartedAt = NULL`
  2. `ClaimPendingUsersCommand` — `UPDATE ... SET publishingStartedAt = NOW() WHERE publishedAt IS NULL AND publishingStartedAt IS NULL ORDER BY createdAt LIMIT N FOR UPDATE SKIP LOCKED RETURNING *`
  3. Commit
  4. For each claimed row: `UserCreatedProducer.publish({ id, name, createdAt })` (publisher confirm)
  5. On confirm: `MarkUsersPublishedCommand` — `UPDATE ... SET publishedAt = NOW(), publishingStartedAt = NULL WHERE id = ?`
  6. ack the cron message
- **Не знає** про notifier, scheduler, notifications DB

### `scheduler` module

- **Owns:** нічого (без БД, без `@prisma/client`)
- **App shape:** full Nest + Fastify (consistent з users/notifier; має `/health` для compose `depends_on`)
- **Cron registration:** `SchedulerService.onModuleInit()` реєструє два cron-job через `SchedulerRegistry` (НЕ `@Cron(...)` decorator):
  - `users-cron` (expr from `USERS_CRON_EXPR`) → `UsersCronProducer.publish({})`
  - `notifier-cron` (expr from `NOTIFIER_CRON_EXPR`) → `NotifierCronProducer.publish({})`
- **Не знає** про users, notifier, БД

### `notifier` module

- **Owns:** `Notification` table в `notifications` DB
- **Consumers:**
  - `user.created` → `CreateNotificationCommand` (idempotent INSERT, `userId @unique` дедуплікує redelivery; зберігає `name` з event payload)
  - `cron.notifier` → `NotifierService.processBatch()`:
    1. `RecoverStuckNotificationsCommand` — sweep `PROCESSING > NOW - 5m → PENDING`, `redrive_count++`, append `REDRIVEN_FROM_STUCK` to history. Якщо `redrive_count >= MAX_REDRIVES` → status='FAILED', `last_error='exceeded redrive limit'`
    2. `ClaimDueNotificationsCommand` — `UPDATE ... SET status='PROCESSING', processing_started_at=NOW() WHERE status='PENDING' AND createdAt + delay < NOW() FOR UPDATE SKIP LOCKED LIMIT N`
    3. Commit
    4. For each: `PushSendProducer.publish({ notificationId })` (publisher confirm)
    5. ack the cron message
  - `push.send` → `PushSendConsumer` (idempotency contract):
    1. `SELECT * FROM notifications WHERE id = ?`
    2. If row absent → ack, log warning (orphan)
    3. If `status='SENT'` → ack, return (duplicate delivery)
    4. If `status='FAILED'` → ack, return (terminal)
    5. If `status !== 'PROCESSING'` → nack-no-requeue, log error (state machine violation)
    6. HTTP POST to `WEBHOOK_URL` with `{userId, name, notificationId}`, `Idempotency-Key: <notificationId>`, `User-Agent`, `AbortSignal.timeout(PUSH_HTTP_TIMEOUT_MS)`
    7. On success: `MarkSentCommand` (status=SENT, sent_at=NOW(), append `PUSH_SENT` to history). On failure: `MarkFailedCommand` (attempts++, append `PUSH_ATTEMPT` to history); якщо attempts >= `PUSH_MAX_ATTEMPTS` → status='FAILED', ack, **немає DLQ**; інакше republish to retry exchange with `expiration=1000·2^(attempts-1)` ms
- **Phase 5:** HTTP layer додається — `/admin/notifications/:id`, `/admin/notifications?status=FAILED&limit&cursor`, `/admin/notifications/:id/retry`, `/admin/dlq/inbox/republish`
- **Не знає** про users DB; знає тільки `userId` та `name` з event payload

---

## Database Layout

### Phase 2-3 (без replicas)

Один Postgres-контейнер з двома databases:

```
postgres:16 container
├── database: users
│   └── table: users (через Prisma migrations з apps/monolith/prisma/users/)
└── database: notifications
    └── table: notifications (через Prisma migrations з apps/monolith/prisma/notifications/)
```

**Bootstrap послідовність:**

1. `make infra-up` → стартує postgres
2. `init.sql` (auto, в `/docker-entrypoint-initdb.d/`) → `CREATE DATABASE users; CREATE DATABASE notifications;`
3. App entrypoint → `npm run prisma:deploy` (per app's own schemas) → `node dist/main.js`
   - Prisma 5+ acquires `pg_advisory_xact_lock` → safe with N=2 concurrent replica boots
4. Compose `depends_on` chain: postgres-healthy → rabbitmq-healthy → migrators-completed → notifier-healthy → users-healthy → scheduler-healthy

### Phase 6 (optional)

Streaming replication: `postgres-write` (master) + `postgres-read` (standby). Apps підключаються до обох — `*_WRITE_DB_URL` → master, `*_READ_DB_URL` → standby. Code shape вже готовий: 2 PrismaClient instances per DB (Read/Write tokens) існують з Phase 2.

### Connection URLs

```env
USERS_WRITE_DB_URL=postgresql://app:pwd@postgres:5432/users
USERS_READ_DB_URL=postgresql://app:pwd@postgres:5432/users           # = WRITE до Phase 6
NOTIFICATIONS_WRITE_DB_URL=postgresql://app:pwd@postgres:5432/notifications
NOTIFICATIONS_READ_DB_URL=postgresql://app:pwd@postgres:5432/notifications
```

Кожен app має свій `.env` з тільки потрібними URL (scheduler не має DB URL зовсім).

---

## Schemas

### `users` DB

```prisma
// apps/monolith/prisma/users/schema.prisma  (Phase 2)
// apps/users/prisma/schema.prisma           (Phase 3)
model User {
  id                   String    @id              // ULID, app-generated
  name                 String                                                       // 1..64 chars (валідується на HTTP edge)
  publishedAt          DateTime? @map("published_at")                               // null = не опубліковано в RMQ; non-null = user.created event ack'd by broker
  publishingStartedAt  DateTime? @map("publishing_started_at")                      // claim coordination (clear on success or stuck-recovery)
  createdAt            DateTime  @default(now()) @map("created_at")

  @@map("users")
}
```

Partial index for outbox claim hot path (через raw migration SQL, бо Prisma не підтримує partial indexes у schema):

```sql
CREATE INDEX users_outbox_claim_idx ON users (created_at)
  WHERE published_at IS NULL AND publishing_started_at IS NULL;
```

### `notifications` DB

```prisma
// apps/monolith/prisma/notifications/schema.prisma  (Phase 2)
// apps/notifier/prisma/schema.prisma                (Phase 3)
model Notification {
  id                  String   @id              // ULID, app-generated
  userId              String   @unique          @map("user_id")          // dedup user.created events
  name                String                                              // copied from user.created payload (notifier has no users DB access)
  status              NotificationStatus @default(PENDING)
  attempts            Int      @default(0)                                // HTTP attempts
  processingStartedAt DateTime? @map("processing_started_at")             // set on PENDING→PROCESSING
  redriveCount        Int      @default(0) @map("redrive_count")           // count of stuck recoveries
  lastRedrivenAt      DateTime? @map("last_redriven_at")
  lastError           String?  @map("last_error")
  sentAt              DateTime? @map("sent_at")
  history             Json     @default("[]")                              // append-only log of transitions
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  @@index([status, createdAt])
  @@index([status, processingStartedAt])
  @@map("notifications")
}

enum NotificationStatus {
  PENDING
  PROCESSING
  SENT
  FAILED
}
```

### `history` JSONB structure

Append-only список об'єктів-подій:

```json
[
	{ "at": "...", "type": "CREATED" },
	{ "at": "...", "type": "CLAIMED_BY_TICK" },
	{ "at": "...", "type": "PUSH_ATTEMPT", "attempt": 1, "latencyMs": 312, "error": "ECONNRESET" },
	{ "at": "...", "type": "REDRIVEN_FROM_STUCK", "previousStartedAt": "..." },
	{ "at": "...", "type": "PUSH_ATTEMPT", "attempt": 2, "latencyMs": 89, "responseStatus": 200 },
	{ "at": "...", "type": "PUSH_SENT" },
	{ "at": "...", "type": "MANUAL_RETRY" }
]
```

Append через атомарний SQL: `UPDATE notifications SET history = history || '[{...}]'::jsonb WHERE id=?`

---

## RabbitMQ Topology

```
Exchange: users.events            type=topic   durable=true
  └─ rk: user.created  ─→  queue: notifier.user-created
                            args:
                              x-dead-letter-exchange: notifications.retry.events
                              x-dead-letter-routing-key: user.created.retry

Exchange: system.cron              type=topic   durable=true
  ├─ rk: cron.users     ─→ queue: users.outbox-cron     prefetch=1
  └─ rk: cron.notifier  ─→ queue: notifier.cron         prefetch=1

Exchange: notifications.work       type=topic   durable=true
  └─ rk: push.send     ─→  queue: notifier.push-send
                            args:
                              x-dead-letter-exchange: notifications.retry.work
                              x-dead-letter-routing-key: push.send.retry

Exchange: notifications.retry.events  type=topic
  └─ rk: user.created.retry  ─→  queue: notifier.user-created.retry
                                 args:
                                   x-dead-letter-exchange: users.events
                                   x-dead-letter-routing-key: user.created
                                 # NO x-message-ttl — per-message expiration

Exchange: notifications.retry.work  type=topic
  └─ rk: push.send.retry  ─→  queue: notifier.push-send.retry
                              args:
                                x-dead-letter-exchange: notifications.work
                                x-dead-letter-routing-key: push.send

Exchange: notifications.dlx        type=topic
  └─ rk: user.created.dead  ─→  queue: notifier.user-created.dlq    # після 5 failed inbox; consumed via Phase 5 admin endpoint
```

### Topology declaration ownership

Кожен app оголошує **тільки те, що він використовує**, через `channel.addSetup(...)`. Asserts є idempotent — multiple apps можуть assert той самий exchange (args повинні співпадати — це code-review concern, не runtime issue).

| App         | Declares                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`     | `users.events` exchange (для publish), `system.cron` exchange + `users.outbox-cron` queue + binding (для consume)                                                                                                                                                                                                                                                                                                                  |
| `scheduler` | `system.cron` exchange (для publish обох routing keys)                                                                                                                                                                                                                                                                                                                                                                             |
| `notifier`  | `users.events` exchange (consume), `notifier.user-created` queue + binding + DLX args, `notifications.retry.events` exchange + retry queue + binding (per-message TTL), `notifications.dlx` exchange + DLQ queue + binding, `system.cron` exchange + `notifier.cron` queue + binding, `notifications.work` exchange + `notifier.push-send` queue + binding + DLX args, `notifications.retry.work` exchange + retry queue + binding |

### Boot order via `depends_on`

```
postgres (healthy) → rabbitmq (healthy) → {users-migrator, notifier-migrator} (completed)
  → notifier (healthy)                    # declares users.events queue + system.cron consumer queue first
  → users (healthy)                       # asserts users.events; safe to publish
  → scheduler (healthy)                   # safe to publish to system.cron (both consumers ready)
```

### Unrouted messages

`mandatory: true` на every publish. Producer reєструє `channel.on('return', ...)` listener для логу unrouted messages. Phase 6 додає `alternate-exchange` argument для zero-loss.

---

## Status Lifecycle (notifications)

```
                       ┌──────────────────────────────────┐
                       ▼                                  │
   user.created  →  PENDING                               │
                       │                                  │
                       │ CLAIMED_BY_TICK (FOR UPDATE SKIP LOCKED)
                       ▼                                  │
                  PROCESSING                              │ if processing_started_at < NOW - 5m:
                       │                                  │  - if redrive_count < MAX_REDRIVES → reset to PENDING, redrive_count++
                       │                                  │  - else → status=FAILED, last_error='exceeded redrive limit'
              ┌────────┴────────┐                         │
              │                 │                         │
   HTTP success            HTTP fail                      │
              │                 │                         │
              ▼          ┌──────┴──────┐                  │
            SENT         │             │                  │
                  attempts<5     attempts>=5              │
                         │             │                  │
                         ▼             ▼                  │
              PENDING (retry-queue)    FAILED (terminal — recover via Phase 5 admin)
                         │                                │
                         └────────────────────────────────┘
```

## Status Lifecycle (users — outbox)

```
   POST /users  →  publishedAt=NULL, publishingStartedAt=NULL
                       │
                       │ CLAIMED_BY_OUTBOX_CRON (FOR UPDATE SKIP LOCKED)
                       │   UPDATE ... SET publishingStartedAt = NOW()
                       ▼
                  publishingStartedAt=NOW(), publishedAt=NULL
                       │
                       │ publish user.created (publisher confirm)
                       ▼
                  publishedAt=NOW(), publishingStartedAt=NULL  (terminal)

  Stuck recovery: WHERE publishingStartedAt < NOW - 5m AND publishedAt IS NULL → publishingStartedAt = NULL
```

---

## Retry Strategies

### Inbox flow (`user.created` → INSERT Notification)

- RMQ-нативний DLX-TTL з broker-side `x-death[*].count` лічильником **keyed by queue name** (НЕ `x-death.length` — той рахує distinct triples, не кількість redeliveries)
- Helper `RmqConsumer.deathCount(msg, queueName): number` парсить `x-death` array
- Per-message expiration на retry-queue: 1s, 2s, 4s, 8s, 16s (computed by consumer based on `deathCount`)
- 5-й fail → publish у DLQ (`notifier.user-created.dlq`)
- DLQ — manual review через Phase 5 `POST /admin/dlq/inbox/republish`

### Send flow (`push.send` → HTTP)

- Per-message expiration з retry-queue, exponential backoff: `1000 * 2^(attempts-1)` ms
- Лічильник у DB (`notifications.attempts`), не RMQ — джерело істини
- 5-й fail → UPDATE `status=FAILED`, ack message, **немає DLQ**
- На кожному attempt append entry в `history`
- Recovery via Phase 5 `POST /admin/notifications/:id/retry` (resets to PENDING, attempts=0, appends `MANUAL_RETRY`)

### Stuck-recovery (PROCESSING locked by crashed consumer)

- На початку кожного cron.notifier tick: sweep `WHERE status='PROCESSING' AND processing_started_at < NOW - RECOVERY_THRESHOLD_MS`
- If `redrive_count < MAX_REDRIVES` → reset to PENDING, `redrive_count++`, `last_redriven_at=NOW()`, append `REDRIVEN_FROM_STUCK`
- Else → status=FAILED, `last_error='exceeded redrive limit'`

### Outbox flow (users)

- Same sweep + claim + publish + mark-done pattern as notifier
- Stuck recovery: `WHERE publishingStartedAt < NOW - 5m AND publishedAt IS NULL → publishingStartedAt = NULL`
- No retry counter / cap (publish failure → row просто чекає наступного tick)
- Якщо broker довго недоступний — rows piling up; коли broker повернеться, всі publish'аються

---

## Consumer / Producer Patterns

### Channel & connection model

- **One AMQP connection per app** (TCP, multiplexed). Wrapped by `AmqpConnectionManager` (auto-reconnect, recreates channels on reconnect).
- **One channel per consumer** (amqplib best practice — isolates ack tracking + flow control).
- **One confirm-channel per producer** (publisher confirms required for outbox + push.send to know publish succeeded).

### `RmqProducer<T>` API

```ts
@Producer({ exchange: 'system.cron', routingKey: 'cron.notifier' })
export class NotifierCronProducer extends RmqProducer<Record<string, never>> {}

// publish call:
await producer.publish(payload, { expiration?: number, headers?: Record<string, unknown> });
```

Producer base встановлює: `persistent: true`, `messageId: ulid()`, `mandatory: true`, `contentType: 'application/json'`. Confirm channel waits for broker ack before resolving.

### `RmqConsumer<T>` API

```ts
@Consumer({ queue: 'notifier.push-send', prefetch: 10 })
export class PushSendConsumer extends RmqConsumer<{ notificationId: string }> {
	protected readonly schema = z.object({ notificationId: z.string() })

	async handle(payload, ctx: ConsumerCtx) {
		// ctx: { messageId, deathCount, headers, rawMessage }
		// throw → nack-no-requeue → routes via DLX
	}
}
```

Default error path: zod parse fail OR `handle` throws → `channel.nack(msg, false, false)` → routes via DLX. Cron consumers (no DLX bound) silently drop on error — acceptable because next tick fires shortly.

### Prefetch

- `cron.users`, `notifier.cron` — prefetch=1 (heartbeat queues; serialized work)
- `notifier.user-created`, `notifier.push-send` — prefetch=10 (env-driven via `RABBITMQ_PREFETCH`)

### Batch sizing

- `NOTIFIER_CLAIM_BATCH=100` — max rows claimed per tick. Configurable via env.

---

## Replicas

| App         | Phase 2 | Phase 3 | Constraint                                                                  |
| ----------- | ------- | ------- | --------------------------------------------------------------------------- |
| `monolith`  | 1       | —       | scheduler embedded → cron singleton                                         |
| `users`     | —       | 2       | Stateless HTTP; outbox cron coordinated via `publishingStartedAt` claim     |
| `notifier`  | —       | 2       | Stateless consumers; coordinated via `processing_started_at` claim          |
| `scheduler` | —       | 1       | Cron singleton (avoids duplicate ticks). Phase 6: `pg_advisory_lock` для HA |

---

## Env Config

Per-app `.env`. Hostnames are compose-only (`postgres`, `rabbitmq`). Each app validates only the env vars it needs.

```env
NODE_ENV=development
PORT=3000

# DBs (users app needs USERS_*; notifier app needs NOTIFICATIONS_*; scheduler app needs neither)
USERS_WRITE_DB_URL=postgresql://app:pwd@postgres:5432/users
USERS_READ_DB_URL=postgresql://app:pwd@postgres:5432/users
NOTIFICATIONS_WRITE_DB_URL=postgresql://app:pwd@postgres:5432/notifications
NOTIFICATIONS_READ_DB_URL=postgresql://app:pwd@postgres:5432/notifications
POSTGRES_USER=app
POSTGRES_PASSWORD=pwd

# RMQ
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
RABBITMQ_PREFETCH=10

# Cron exprs (env-driven; 5s dev / 1m prod)
USERS_CRON_EXPR=*/5 * * * * *
NOTIFIER_CRON_EXPR=*/5 * * * * *
NOTIFIER_CLAIM_BATCH=100

# Notification timing
NOTIFICATION_DELAY_MS=30000               # 30s dev / 86400000 prod
PUSH_HTTP_TIMEOUT_MS=10000
PUSH_MAX_ATTEMPTS=5
INBOX_MAX_RETRIES=5
MAX_REDRIVES=5
RECOVERY_THRESHOLD_MS=300000              # 5 min stuck threshold

# Webhook
WEBHOOK_URL=https://webhook.site/<id>
```

### Config schema pattern (markus mirror)

`libs/config/src/schemas/` exports building-block zod schemas (`AppSchema`, `DatabaseSchema`, `RmqSchema`, `NotificationSchema`, `CronSchema`, `WebhookSchema`).

Each app composes its own `ConfigSchema` in `apps/<app>/src/config/validation-schema.ts`:

```ts
// apps/scheduler/src/config/validation-schema.ts
import { AppSchema, CronSchema, RmqSchema } from '@app/config'

export const SchedulerConfigSchema = z.strictObject({
	app: AppSchema,
	rmq: RmqSchema,
	cron: CronSchema
})
```

`apps/<app>/src/config/configuration.ts` mirrors markus:

```ts
export const configuration = registerAs('app', () => {
  const config = { app: { ... }, rmq: { ... }, cron: { ... } }
  ConfigSchema.parse(config)  // throws on boot if invalid
  return config
})
export const ConfigurationModule = ConfigModule.forFeature(configuration)
export const ConfigurationInjectKey = configuration.KEY
export type ConfigurationType = ConfigType<typeof configuration>
```

Inject in services: `@Inject(ConfigurationInjectKey) private readonly config: ConfigurationType` → `this.config.cron.usersExpr`.

`import 'dotenv/config'` at top of each `main.ts`.

---

## API Contracts

### `POST /users`

Request:

```json
{ "name": "andrii" }
```

Validation (zod, strict):

- `name`: required, string, 1..64 chars, trimmed
- No other fields

Response 201:

```json
{ "id": "01H...", "name": "andrii", "createdAt": "2026-05-04T10:00:00Z" }
```

Errors:

- 400 — zod validation failure
- 5xx — DB unavailable

POST is **not** idempotent: same `name` twice → two distinct users.

### Webhook POST (push.send)

Request to `WEBHOOK_URL`:

```json
{ "userId": "01H...", "name": "andrii", "notificationId": "01H..." }
```

Headers:

- `Content-Type: application/json`
- `Idempotency-Key: <notificationId>`
- `User-Agent: nestjs-user-push-microservices/<version>`

Timeout: `AbortSignal.timeout(PUSH_HTTP_TIMEOUT_MS)`.

### Phase 5 admin endpoints (notifier app)

| Method | Path                                                         | Purpose                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/notifications/:id`                                   | Full row including `history` JSONB                                                                                                                                                      |
| GET    | `/admin/notifications?status=FAILED&limit=100&cursor=<ulid>` | Cursor-paginated list (ULID is sortable)                                                                                                                                                |
| POST   | `/admin/notifications/:id/retry`                             | If `status=FAILED`: reset → `status=PENDING, attempts=0, processing_started_at=NULL, last_error=NULL`, append `MANUAL_RETRY`. Returns 200 with new row. If status≠FAILED → 409 Conflict |
| POST   | `/admin/dlq/inbox/republish`                                 | Drain `notifier.user-created.dlq`, republish to `users.events`. Body: optional `{ ids: ["..."] }` for selective republish                                                               |

No auth — assumed behind internal network. Add `X-Admin-Token` env-checked header in Phase 6 if needed.

---

## Observability

### Phase 2-3 (logging only)

- `nestjs-pino` everywhere
- Log bindings on every line:
  - HTTP handlers: `reqId` (ULID minted by `genReqId`)
  - RMQ consumers: `messageId`, `queue`
  - Domain: `userId`, `notificationId` where available
- Cross-segment correlation via `userId` / `notificationId` (grep-based)
- `createExtendedPrismaClient` adds query logging via `$extends` (debug for normal, info for >500ms)

### Phase 4 (Monitoring & Infra)

- `@opentelemetry/sdk-node` initialized in each app's `main.ts`
- Auto-instrumentation: fastify, http, pg
- `@opentelemetry/instrumentation-amqplib` for RMQ trace propagation (`traceparent` header on publish, extracted on consume)
- `pino-otel` injects `traceId`/`spanId` into log lines
- Tempo (or Jaeger) backend via OTel collector
- Prometheus scraping `/metrics` from each app (custom counters: `notifications_failed_total`, `notification_redrive_count`, `prisma_request_duration_ms`, `rmq_queue_depth`)
- Grafana dashboards
- `createExtendedPrismaClient` swaps pino-extension → OTel auto-instrumentation

---

## Phase 1 Commit Roadmap (Scaffolding)

| #   | Commit                                                                 | Деталі                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `chore: init npm workspaces and root package.json`                     | root `package.json` з `workspaces: ["apps/*", "libs/*"]`, `.gitignore`, `.nvmrc` (node 22 LTS)                                                                                                                                                                                  |
| 2   | `chore: add prettier and oxlint configs from markus`                   | `.oxlintrc.json`, `.prettierrc`, devDeps                                                                                                                                                                                                                                        |
| 3   | `chore: add husky with pre-commit running make pc`                     | `.husky/pre-commit` → `make pc`; postinstall → `husky`                                                                                                                                                                                                                          |
| 4   | `chore: add 9 git-aware bash scripts`                                  | `scripts/lint-*.sh`, `scripts/format-*.sh` (копія з markus)                                                                                                                                                                                                                     |
| 5   | `chore: add Makefile with infra/dev/code-quality targets`              | `infra-up`, `infra-down`, `infra-logs`, `infra-clean`, `up-all`, `down-all`, `nuke`, `d` (apps-only with watch), `lint`, `lint-fix`, `format`, `format-check`, `pc`, `lint-staged`, `format-staged-write`, `lint-branch`, `format-branch`, `db-{users,notifs}-{create,migrate}` |
| 6   | `chore: scaffold libs/common with Command and Query interfaces`        | пустий пакет `@app/common` з `Command<I,O>`, `Query<I,O>`, ulid re-export, `LoggerModule` (nestjs-pino bindings)                                                                                                                                                                |
| 7   | `chore: scaffold libs/config with zod schema building blocks`          | `@app/config`: `schemas/{app,database,rmq,notification,cron,webhook}.schema.ts`; index re-exports building blocks                                                                                                                                                               |
| 8   | `chore: scaffold libs/zod-validation`                                  | `@app/zod-validation`: ZodSchema decorator, BaseZodValidationInterceptor (адаптовано з martech-utils)                                                                                                                                                                           |
| 9   | `chore: scaffold libs/database-core`                                   | `@app/database-core`: `createExtendedPrismaClient` (pino query logging), `prisma-clients-base.ts` (class+interface merge helpers), `createDatabaseModule` factory                                                                                                               |
| 10  | `chore: scaffold libs/rmq with consumer/producer base classes`         | `@app/rmq`: `RmqConnection` wrapper з `OnModuleDestroy`, `RmqConsumer<T>` (channel-per-consumer, zod, deathCount helper), `RmqProducer<T>` (confirm channel, ulid messageId, mandatory+return listener), decorators, `RmqHealthIndicator`                                       |
| 11  | `chore: scaffold apps/monolith with NestJS 11 + Fastify booting`       | мінімальний NestJS app, `import 'dotenv/config'`, `app.enableShutdownHooks()`, `MonolithConfigSchema` composes all building blocks, `HealthModule` з `/lhealth` (sync ok) + `/rhealth` (terminus з порожнім списком), `apps/monolith/.env.example`                              |
| 12  | `chore: add docker-compose.infra.yml and infra/postgres/init.sql`      | postgres + rabbitmq services, init.sql створює databases, healthchecks                                                                                                                                                                                                          |
| 13  | `chore: add docker-compose.apps.yml shell with monolith service`       | apps compose з посиланням на `apps/monolith/Dockerfile`, `depends_on` chain                                                                                                                                                                                                     |
| 14  | `chore: add docker-compose.dev.override.yml with bind-mount and watch` | bind-mount source, anonymous node_modules volume, `target: builder`, `command: npm run start:dev`, `CHOKIDAR_USEPOLLING=true`                                                                                                                                                   |
| 15  | `chore: add multistage Dockerfile for monolith`                        | builder + runtime stage; copies `node_modules/.prisma` + `node_modules/@prisma/client` from builder; `prisma` in production deps                                                                                                                                                |
| 16  | `chore: README with dev workflow and bootstrap steps`                  | `make infra-up`, `make d`, `make up-all`, `make nuke`, etc.                                                                                                                                                                                                                     |

**Definition of Done для Phase 1:**

- `make infra-up` → postgres + rabbitmq healthy
- `make d` → app boots, `GET /lhealth` returns 200 sync `{status:'ok'}`, `GET /rhealth` returns 200 з порожнім checks array
- `make pc` → проходить без warning'ів
- `make lint`, `make format-check` — green

---

## Phase 2 Commit Roadmap (буде деталізовано після Phase 1)

Високий рівень:

1. Prisma schemas + перші migrations для `users` (з `publishedAt`, `publishingStartedAt`) і `notifications` (з `name`) DBs; partial index migration for outbox claim
2. `database/users.clients.ts` + `users.database.module.ts` через `createDatabaseModule`; 2 instances per DB (Read+Write tokens)
3. `database/notifications.clients.ts` + `notifications.database.module.ts`
4. Health checks додаються: `PrismaHealthIndicator` × 4 + `RmqHealthIndicator`
5. RMQ infrastructure: connection bootstrap у `RmqModule`, exchanges/queues декларація через base classes (each module declares its own)
6. `users` module HTTP path: DTO + zod schema + `UsersController` + `UsersService` + `CreateUserCommand`
7. `users` module outbox path: `UsersOutboxCronConsumer` + `UsersOutboxService` + `RecoverStuckUsersCommand` + `ClaimPendingUsersCommand` + `MarkUsersPublishedCommand` + `UserCreatedProducer`
8. `scheduler` module: `SchedulerService` з dynamic `SchedulerRegistry` registration + `UsersCronProducer` + `NotifierCronProducer`
9. `notifier` module inbox: `UserCreatedConsumer` + `CreateNotificationCommand` (idempotent INSERT з `name` з payload)
10. `notifier` module retry topology + per-message expiration backoff + `x-death[*].count` parsing helper
11. `notifier` module recovery+claim: `NotifierCronConsumer` + `NotifierService` + `RecoverStuckNotificationsCommand` (з MAX_REDRIVES check) + `ClaimDueNotificationsCommand` + `PushSendProducer`
12. `notifier` module HTTP execution: `PushSendConsumer` з idempotency contract (SENT/FAILED → ack-and-return) + `SendPushCommand` з fetch + AbortSignal.timeout + history append + `MarkSentCommand` + `MarkFailedCommand`
13. End-to-end smoke test: POST /users → wait ~45s → check webhook.site

**Definition of Done для Phase 2:**

- `make up-all` піднімає infra + monolith (1 replica)
- `curl -X POST http://localhost:3000/users -H 'Content-Type: application/json' -d '{"name":"andrii"}'` → 201 з `{id, name, createdAt}`
- Через ~45 секунд webhook.site показує POST з body `{userId, name, notificationId}` і header `Idempotency-Key: <notificationId>`
- DB row має `status=SENT`, `sentAt` populated, `history` має 4+ entries
- Перезапуск контейнерів не втрачає pending нотифікацій (recovery sweep підбирає stuck PROCESSING rows)
- Force-fail webhook (incorrect URL) → після 5 attempts row goes to FAILED, no DLQ message
- `/lhealth`, `/rhealth` працюють і `/rhealth` пінгує всі 4 prisma clients + RMQ

---

## Phase 3 Transition Steps

1. `git mv apps/monolith/prisma/users          apps/users/prisma`
2. `git mv apps/monolith/prisma/notifications  apps/notifier/prisma`
3. `git mv apps/monolith/src/database/users.*  apps/users/src/database/`
4. `git mv apps/monolith/src/database/notifications.*  apps/notifier/src/database/`
5. `git mv apps/monolith/src/modules/users      apps/users/src/modules/`
6. `git mv apps/monolith/src/modules/scheduler  apps/scheduler/src/modules/`
7. `git mv apps/monolith/src/modules/notifier   apps/notifier/src/modules/`
8. **Rewrite relative imports for prisma generated clients** (e.g. `'../../prisma/users/generated'` → `'../../prisma/generated'`) — приблизно 4 import statements per app, mechanical sed
9. Створити окремі `main.ts`, `app.module.ts`, `package.json`, `Dockerfile`, `tsconfig.json`, `.env`, `.env.example` для кожного app
10. Створити окремі `src/config/validation-schema.ts` per app, composing only потрібні building blocks з `@app/config`
11. `apps/scheduler/package.json` — без `@prisma/client`, без `prisma`; `apps/scheduler/` без `prisma/` folder; entrypoint без `prisma migrate deploy`
12. `docker-compose.apps.yml` — замінити один `monolith` сервіс на 3 (`users`, `notifier`, `scheduler`) + 2 migrators (`users-migrator`, `notifier-migrator`); replicas: users=2, notifier=2, scheduler=1; comment "scheduler is singleton — do not scale"
13. `depends_on` chain: postgres-healthy → rabbitmq-healthy → migrators-completed → notifier-healthy → users-healthy → scheduler-healthy
14. Видалити `apps/monolith/`

**Бізнес-код не змінюється** — тільки топологія + relative-import rewrite per step 8.

**Definition of Done для Phase 3:**

- `make up-all` піднімає 3 окремі app контейнери (users×2, notifier×2, scheduler×1) + 2 migrators
- Той самий end-to-end smoke test проходить
- Кожен сервіс має власний log stream і власну БД view
- `/rhealth` per app перевіряє тільки свої dependencies (scheduler — RMQ only; users — RMQ + users DB; notifier — RMQ + notifications DB)

---

## Phase 4 Roadmap (Monitoring & Infra)

Високий рівень:

1. Prometheus container в infra compose; scraping config для всіх 3 apps
2. `@nestjs/terminus` + custom Prometheus metrics endpoint per app
3. Custom metrics: `notifications_failed_total`, `notification_redrive_count`, `prisma_request_duration_ms`, `rmq_queue_depth_*`
4. Grafana container; dashboards (per-service, per-queue)
5. OpenTelemetry SDK initialization в кожному `main.ts`; auto-instrumentation fastify+http+pg
6. `@opentelemetry/instrumentation-amqplib` для RMQ trace propagation
7. `pino-otel` injection (traceId/spanId в log lines)
8. OTel collector + Tempo (або Jaeger) container в infra compose
9. `createExtendedPrismaClient` swap: pino query logging → OTel auto-instrumentation (`@prisma/instrumentation`)
10. README section з посиланнями на dashboards / Tempo UI

---

## Phase 5 Roadmap (Admin & Recovery)

1. `notifier` app gains HTTP routes (`/admin/*` controller); existing Fastify boot stays
2. `GET /admin/notifications/:id` → returns full row + history JSONB
3. `GET /admin/notifications?status=FAILED&limit&cursor` → cursor-paginated (ULID-sortable)
4. `POST /admin/notifications/:id/retry` → atomic UPDATE з status=FAILED check, append `MANUAL_RETRY` to history
5. `POST /admin/dlq/inbox/republish` → drain DLQ, republish to `users.events / user.created`; optional body для selective republish
6. README admin section з прикладами curl

**Definition of Done для Phase 5:**

- Force a FAILED row → curl `GET /admin/notifications?status=FAILED` показує його → curl `POST /admin/notifications/:id/retry` → row transitions PENDING → PROCESSING → SENT
- Force inbox DLQ messages (5 failed user.created consumes) → curl `POST /admin/dlq/inbox/republish` → DLQ drains, messages reprocessed

---

## Phase 6 (Optional remainder)

| Item                   | Зміст                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read replicas          | `postgres-write` + `postgres-read`, streaming replication, `*_READ_DB_URL` → standby; code shape вже готовий (Read/Write tokens існують з Phase 2) |
| Full graceful shutdown | per-consumer `channel.cancel(consumerTag)` + drain in-flight, prisma `$disconnect`, fastify in-flight draining, `SchedulerRegistry` pause          |
| K8s manifests          | Deployment, Service, ConfigMap, Secret per app для прод-ready deploy                                                                               |
| Scheduler HA           | `pg_advisory_lock` leader election (allows scheduler N>1)                                                                                          |
| Alternate-exchange     | `system.cron` exchange отримує `alternate-exchange` arg → unrouted cron messages → `unrouted.alt` queue для inspection                             |
| Live/ready probe split | Keep `/lhealth` + `/rhealth` (already split since Phase 1); add k8s probe configs                                                                  |

---

## Naming Conventions

- File names: `kebab-case.ts`
- Class names: `PascalCase`
- Method names: `camelCase`
- Const env vars: `SCREAMING_SNAKE_CASE`
- DB tables: `snake_case` plural
- Prisma model fields: `camelCase` з `@map("snake_case")` для DB columns
- Module names: domain-noun (`users`, `notifier`, `scheduler`)
- App names: domain-noun, **no `-service` suffix** (`apps/users`, not `apps/users-service`)
- Command files: `<verb>-<noun>.command.ts` (наприклад `create-user.command.ts`)
- Query files: `<verb>-<noun>.query.ts` (наприклад `find-user-by-id.query.ts`)
- Consumer files: `<event-name>.consumer.ts` (наприклад `user-created.consumer.ts`)
- Producer files: `<event-name>.producer.ts`
- Health endpoints: `/lhealth` (liveness, sync) + `/rhealth` (readiness, terminus)

---

## Architecture Rules

1. **Шари:** Controller / RMQ Consumer → Service → Command/Query → Read/WritePrismaClient
2. **Тонкі transport-шари:** Controller і Consumer тільки парсять вхід і викликають Service. Не знають про commands, queries, RMQ producers, prisma.
3. **Service як orchestrator:** єдиний шар, що викликає commands/queries І RMQ producers. Service може бути HTTP-side (`UsersService`) АБО consumer-side (`UsersOutboxService` called from `UsersOutboxCronConsumer`, `NotifierService` called from `NotifierCronConsumer`). Не знає про HTTP/RMQ inbound shape.
4. **Commands/Queries чисті:** знають тільки про свій PrismaClient (Read для queries, Write для commands). Не викликають RMQ. Не викликають інших commands.
5. **RMQ Producers тонкі:** обгортка над AMQP publish (через `RmqProducer<T>` base). Викликаються тільки сервісами.
6. **Read vs Write:** queries читають через Read clients, commands пишуть через Write clients. Patterns enforced через DI tokens. У Phase 2-5 Read URL == Write URL; Phase 6 розділяє.
7. **Cross-module залежності через service layer:** notifier service може DI-injectити інші module-services (наприклад UsersService), але не їхні commands напряму. У Phase 3 такі cross-module DI зникають разом зі split.
8. **DB ізоляція:** users module бачить тільки `users` DB; notifier module бачить тільки `notifications` DB; cross-DB queries заборонені на code level (різні Prisma clients не мають доступу один до одного). У Phase 3 enforced на process level — кожен app має тільки свій PrismaClient.
9. **Idempotency contracts:**
   - Inbox (`user.created`): `Notification.userId @unique` дедуплікує redelivery; `INSERT ON CONFLICT DO NOTHING` (or catch unique violation, ack)
   - Send (`push.send`): consumer reads row first, ack-and-return on `SENT`/`FAILED`, proceed only on `PROCESSING`
   - Outbox publish: at-least-once OK because notifier's `userId @unique` absorbs duplicates
10. **Topology declaration:** each app declares only what it touches (`channel.addSetup`). Asserts are idempotent. Args must match across apps — code review concern.
11. **Cron registration:** `SchedulerRegistry` dynamic add (NOT `@Cron(...)` decorator). Allows env-driven exprs through zod-validated config.
12. **Commit-then-publish:** for both notifier and users outbox flows, claim TX commits before publish. Publish failure → row stays PROCESSING/`publishingStartedAt set` → 5-min stuck-recovery sweeps it back. Tradeoff: 5-min worst-case recovery latency vs distributed-transaction complexity.
13. **Publisher confirms:** all producers use confirm channels. Publish resolves only after broker ack. Required for outbox correctness.
14. **No DLQ for send-flow FAILED:** terminal state, recovery via Phase 5 admin endpoint. Operator-driven, not auto-retry.
