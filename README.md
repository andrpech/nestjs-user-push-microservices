# nestjs-user-push-microservices

User → push notification microservices on NestJS + RabbitMQ + Postgres.

See `docs/INITIAL_PLAN.md` for the full design, `docs/prds/prd-user-push-microservices.md` for the product framing, and `docs/plans/user-push-microservices.md` for the phased implementation plan.

## Quickstart

Prereqs: Docker, Node 22 (`nvm use`), npm.

```bash
nvm use                       # node 22
npm install                   # install all workspace deps
make infra-up                 # postgres + rabbitmq, detached
make d                        # apps with watch (foreground)
```

Then:

- `curl http://localhost:3000/lhealth` → `{"status":"ok"}`
- `curl http://localhost:3000/rhealth` → terminus check result
- RabbitMQ UI at <http://localhost:15672> (`guest` / `guest`)

## Make targets

```
make help                     # full target list
make infra-up / infra-down    # postgres + rabbitmq
make d                        # apps in dev mode (bind-mount + watch)
make up-all                   # apps prod-like detached
make nuke                     # stop everything + wipe volumes
make pc                       # typecheck + lint + format check
```

## Layout

```
apps/monolith/                # Phase 2 single app, all 3 modules in one process
libs/{common,config,zod-validation,database-core,rmq}/  # shared libraries
infra/postgres/init.sql       # creates `users` and `notifications` databases
docs/INITIAL_PLAN.md          # technical design (markdown blueprint)
docs/prds/                    # product requirement docs
docs/plans/                   # phased implementation plan
```

## Phase status

- [x] Phase 1 — Scaffolding + health
- [ ] Phase 2 — Monolith (full E2E)
- [ ] Phase 3 — Split into 3 apps
- [ ] Phase 4 — Monitoring & infra (Prometheus, Grafana, OTel)
- [ ] Phase 5 — Admin & recovery endpoints
- [ ] Phase 6 — Optional remainder (replicas, K8s, leader-election)

## Conventions

- Markus-style code style: tabs, 100-col, no semis, single-quote, sorted imports.
- Lint via `oxlint`. Format via `prettier`.
- Husky pre-commit hook runs `make pre-commit` on `main`, skips on other branches (PR CI is the gate).
- No tests — E2E smoke (curl POST → wait → check webhook) is the QA path.
