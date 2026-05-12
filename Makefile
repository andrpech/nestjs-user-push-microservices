.PHONY: help infra-up infra-down infra-logs infra-clean up-all down-all nuke d run-dev run-prod env-dev env-prod lint lint-fix format format-check typecheck pc pre-commit ls lsf fs fsw build-libs test test-db e2e e2e-up e2e-down e2e-test e2e-logs

# ---------------- Help ----------------

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "Infra (postgres + rabbitmq):"
	@echo "  infra-up      Start infra detached"
	@echo "  infra-down    Stop infra"
	@echo "  infra-logs    Tail infra logs"
	@echo "  infra-clean   Stop infra and remove volumes"
	@echo ""
	@echo "Apps (users + notifier + scheduler):"
	@echo "  run-dev       Materialize dev .env files for all 3 apps then bring up with watch"
	@echo "  run-prod      Materialize prod .env files for all 3 apps then bring up detached"
	@echo "  env-dev       Copy .env.example.dev → .env for each app (overwrites)"
	@echo "  env-prod      Copy .env.example.prod → .env for each app (overwrites)"
	@echo "  d             Alias for run-dev"
	@echo "  up-all        Bring up apps detached using whatever .env is on disk"
	@echo "  down-all      Stop apps"
	@echo "  nuke          Stop everything + wipe volumes"
	@echo ""
	@echo "Code quality:"
	@echo "  pc, pre-commit  Typecheck + lint + format check"
	@echo "  lint            Run oxlint on the whole repo"
	@echo "  lint-fix        Run oxlint --fix on the whole repo"
	@echo "  format          Format with prettier"
	@echo "  format-check    Check formatting with prettier"
	@echo "  typecheck       tsc --noEmit on the whole repo"
	@echo "  ls / lsf        Lint staged files (check / fix)"
	@echo "  fs / fsw        Format staged files (check / write)"

# ---------------- Infra ----------------

infra-up:
	docker compose -f docker-compose.infra.yml up -d

infra-down:
	docker compose -f docker-compose.infra.yml down

infra-logs:
	docker compose -f docker-compose.infra.yml logs -f

infra-clean:
	docker compose -f docker-compose.infra.yml down -v

# ---------------- Apps ----------------

env-dev:
	cp apps/users/.env.example.dev apps/users/.env
	cp apps/notifier/.env.example.dev apps/notifier/.env
	cp apps/scheduler/.env.example.dev apps/scheduler/.env
	@echo "wrote .env from .env.example.dev for users, notifier, scheduler"

env-prod:
	cp apps/users/.env.example.prod apps/users/.env
	cp apps/notifier/.env.example.prod apps/notifier/.env
	cp apps/scheduler/.env.example.prod apps/scheduler/.env
	@echo "wrote .env from .env.example.prod for users, notifier, scheduler"

run-dev: env-dev
	docker compose -f docker-compose.apps.yml -f docker-compose.dev.override.yml up

run-prod: env-prod
	docker compose -f docker-compose.apps.yml up -d

d: run-dev

up-all:
	docker compose -f docker-compose.apps.yml up -d

down-all:
	docker compose -f docker-compose.apps.yml down

nuke:
	docker compose -f docker-compose.infra.yml -f docker-compose.apps.yml down -v --remove-orphans

# ---------------- Code quality ----------------

build-libs:
	npm run build:libs

pre-commit: typecheck lint format-check

pc: pre-commit

typecheck:
	npx tsc -p tsconfig.json --noEmit

lint:
	npx oxlint

lint-fix:
	npx oxlint --fix

format:
	npx prettier --cache --write .

format-check:
	npx prettier --cache --check .

# git-aware variants

ls:
	npm run lint:staged

lsf:
	npm run lint:fix:staged

fs:
	npm run format:staged

fsw:
	npm run format:staged:write

# ---------------- Tests ----------------

# Pure-module focus tests (TypeCatalog etc.). No infra needed.
test:
	npx vitest run

# Includes DB-dependent tests against the dev infra (assumes `make infra-up`).
# Set TEST_USERS_DB_URL / TEST_NOTIFICATIONS_DB_URL or rely on the defaults.
test-db:
	RUN_DB_TESTS=1 npx vitest run

# ---------------- E2E ----------------

E2E_INFRA   := docker compose -f docker-compose.infra.yml
E2E_APPS    := docker compose -f docker-compose.apps.yml -f docker-compose.dev.override.yml -f docker-compose.e2e.override.yml

# Bring up the full stack (infra + apps + webhook-receiver) detached and wait
# until the host-facing health endpoints respond. Infra is brought up first so
# the `nupm-net` network exists before the apps compose (which treats it as
# external) starts.
e2e-up: env-dev
	$(E2E_INFRA) up -d
	$(E2E_APPS) up -d --build
	@echo "waiting for users service on :3000 ..."
	@until curl -fsS http://localhost:3000/rhealth >/dev/null 2>&1; do sleep 2; done
	@echo "stack ready"

e2e-down:
	$(E2E_APPS) down -v --remove-orphans
	$(E2E_INFRA) down -v --remove-orphans

e2e-logs:
	$(E2E_APPS) logs -f --tail=200 users notifier scheduler webhook-receiver

# Assumes `make e2e-up` already ran. Runs vitest against test/e2e/**.
e2e-test:
	RUN_E2E_TESTS=1 npx vitest run --config vitest.e2e.config.ts

# All-in-one: bring up, run tests, leave stack up for inspection. Use
# `make e2e-down` when finished.
e2e: e2e-up e2e-test
