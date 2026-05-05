.PHONY: help infra-up infra-down infra-logs infra-clean up-all down-all nuke d lint lint-fix format format-check typecheck pc pre-commit ls lsf fs fsw build-libs

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
	@echo "  d             Bring up apps with watch (assumes infra-up)"
	@echo "  up-all        Bring up apps prod-like detached (assumes infra-up)"
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

d:
	docker compose -f docker-compose.apps.yml -f docker-compose.dev.override.yml up

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
