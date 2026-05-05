.PHONY: help infra-up infra-down infra-logs infra-clean up-all down-all nuke d run-dev run-prod env-dev env-prod lint lint-fix format format-check typecheck pc pre-commit ls lsf fs fsw build-libs

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
	@echo "Apps:"
	@echo "  run-dev       Materialize dev .env then bring up apps with watch (assumes infra-up)"
	@echo "  run-prod      Materialize prod .env then bring up apps prod-like detached (assumes infra-up)"
	@echo "  env-dev       Copy .env.example.dev → .env (overwrites)"
	@echo "  env-prod      Copy .env.example.prod → .env (overwrites)"
	@echo "  d             Alias for run-dev (kept for muscle memory)"
	@echo "  up-all        Bring up apps detached using whatever .env is on disk"
	@echo "  down-all      Stop apps"
	@echo "  nuke          Stop everything and wipe volumes"
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
	cp apps/monolith/.env.example.dev apps/monolith/.env
	@echo "apps/monolith/.env written from .env.example.dev"

env-prod:
	cp apps/monolith/.env.example.prod apps/monolith/.env
	@echo "apps/monolith/.env written from .env.example.prod"

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
