.PHONY: run-api run-smtp build lint test web-test docker-up docker-infra docker-down docker-logs migrate-up migrate-down migrate-create migrate-test migrate-test-db

# Stamped into main.Version. The nearest tag, not the full `git describe`:
# git-flow back-merges each release into develop, so develop always sits one
# commit past its tag and a plain describe reads "v1.17.0-1-gcc5c815". A "-dirty"
# marker is appended when the tree has uncommitted changes, so a modified build
# never claims to be a clean release. A release pipeline can pass VERSION
# explicitly to stamp the exact tag it was asked to build.
VERSION ?= $(shell git describe --tags --abbrev=0 2>/dev/null || echo dev)$(shell git diff --quiet HEAD 2>/dev/null || echo -dirty)
export VERSION

DATABASE_URL ?= postgres://postgres:password@localhost:5432/burnerbyte?sslmode=disable
# Integration tests in internal/repository/postgres run against this database.
TEST_DATABASE_URL ?= postgres://postgres:password@localhost:5432/burnerbyte_test?sslmode=disable
MIGRATE := migrate -database "$(DATABASE_URL)" -path migrations

# ── Run ──
# Load .env (if present) into the environment for local `go run`. The binary
# reads config via viper env bindings (JWT_SECRET, DATABASE_URL, BB_*); nothing
# auto-loads .env, so source it here to make `cp .env.example .env` work.

run-api:
	@set -a; [ -f .env ] && . ./.env; set +a; go run ./cmd/api

run-smtp:
	@set -a; [ -f .env ] && . ./.env; set +a; go run ./cmd/smtpd

# ── Build ──

build:
	CGO_ENABLED=0 go build -ldflags "-X main.Version=$(VERSION)" -o bin/api ./cmd/api
	CGO_ENABLED=0 go build -ldflags "-X main.Version=$(VERSION)" -o bin/smtpd ./cmd/smtpd

lint:
	golangci-lint run ./...

test:
	go test -race ./...

# Frontend gates. `next build` only typechecks files in the build graph, so
# typecheck covers the test files that lint and the image build do not.
web-test:
	cd web && pnpm test && pnpm lint && pnpm typecheck

# ── Docker ──

# Full stack (postgres, redis, minio, migrate, api, smtpd, frontend).
docker-up:
	docker compose up -d --build

# Infra only — for local development where the app runs via `make run-api`.
# The dev overlay publishes the postgres/redis/minio ports to the host, which
# the base compose file deliberately does not (see its header comment).
docker-infra:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis minio

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

# ── Migrations ──

migrate-up:
	$(MIGRATE) up

migrate-down:
	$(MIGRATE) down 1

migrate-create:
	@read -p "Migration name: " name; \
	$(MIGRATE) create -ext sql -dir migrations -seq $$name

# Create (if needed) and migrate the integration-test database to head. The
# repository tests fail with a pointer to this target when the schema is behind.
migrate-test-db:
	@psql "$(TEST_DATABASE_URL)" -c 'SELECT 1' >/dev/null 2>&1 || \
		createdb "$$(basename "$(TEST_DATABASE_URL)" | sed 's/?.*//')" 2>/dev/null || true
	migrate -database "$(TEST_DATABASE_URL)" -path migrations up

migrate-test:
	@echo "Testing migrations (up then down for each)..."
	@for i in $$(seq 1 $$(ls migrations/*.up.sql 2>/dev/null | wc -l)); do \
		echo "  Migration $$i: up..."; \
		$(MIGRATE) up 1 || exit 1; \
		echo "  Migration $$i: down..."; \
		$(MIGRATE) down 1 || exit 1; \
	done
	@echo "All migrations passed."
