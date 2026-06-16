.PHONY: run-api run-smtp build lint docker-up docker-infra docker-down migrate-up migrate-down migrate-create migrate-test

DATABASE_URL ?= postgres://postgres:password@localhost:5432/burnerbyte?sslmode=disable
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
	CGO_ENABLED=0 go build -o bin/api ./cmd/api
	CGO_ENABLED=0 go build -o bin/smtpd ./cmd/smtpd

lint:
	golangci-lint run ./...

# ── Docker ──

# Full stack (postgres, redis, minio, migrate, api, smtpd, frontend).
docker-up:
	docker compose up -d

# Infra only — for local development where the app runs via `make run-api`.
docker-infra:
	docker compose up -d postgres redis minio

docker-down:
	docker compose down

# ── Migrations ──

migrate-up:
	$(MIGRATE) up

migrate-down:
	$(MIGRATE) down 1

migrate-create:
	@read -p "Migration name: " name; \
	$(MIGRATE) create -ext sql -dir migrations -seq $$name

migrate-test:
	@echo "Testing migrations (up then down for each)..."
	@for i in $$(seq 1 $$(ls migrations/*.up.sql 2>/dev/null | wc -l)); do \
		echo "  Migration $$i: up..."; \
		$(MIGRATE) up 1 || exit 1; \
		echo "  Migration $$i: down..."; \
		$(MIGRATE) down 1 || exit 1; \
	done
	@echo "All migrations passed."
