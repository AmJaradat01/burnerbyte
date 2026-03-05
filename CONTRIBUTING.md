# Contributing to BurnerByte

## Development Setup

### Prerequisites

- Go 1.22+
- Node.js 20+ with pnpm
- Docker & Docker Compose
- PostgreSQL 16
- Redis 7

### Getting Started

```bash
git clone git@gitlab.com:burnerbyte/burnerbyte.git
cd burnerbyte

# Start infrastructure
make docker-up

# Copy and configure environment
cp .env.example .env

# Run migrations
make migrate-up

# Start API server
make run-api

# Start frontend (separate terminal)
cd web && pnpm install && pnpm dev
```

### Running Tests

```bash
# Go tests
go test -race ./...

# Migration test (up then down for each)
make migrate-test

# Frontend lint
cd web && pnpm lint
```

## Git Flow

We follow gitflow branching:

- `main` — stable releases only (tagged: v0.1.0, v0.2.0, etc.)
- `develop` — integration branch, all features merge here
- `feature/*` — feature branches created from `develop`
- `release/*` — release branches created from `develop`, merged to both `main` and `develop`

### Branch Rules

1. Create feature branch from `develop`: `git checkout -b feature/my-feature develop`
2. Commit your changes with conventional commit messages
3. Merge back to `develop` via merge commit (no squash): `git merge --no-ff feature/my-feature`
4. Never commit directly to `main` or `develop`

### Commit Messages

Use conventional commits:

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation
- `chore:` — maintenance
- `refactor:` — code restructuring

### Release Process

1. `git checkout -b release/vX.Y.Z develop`
2. Update `CHANGELOG.md`
3. `git checkout main && git merge --no-ff release/vX.Y.Z`
4. `git tag -a vX.Y.Z -m "vX.Y.Z"`
5. `git checkout develop && git merge --no-ff release/vX.Y.Z`
6. `git branch -d release/vX.Y.Z`
7. `git push origin main develop --tags`

## Code Style

- Go: follow `gofmt` and `golangci-lint`
- TypeScript: follow ESLint config in `web/`
- All API responses use `snake_case` JSON
- All timestamps are RFC 3339

## License

Apache 2.0 — see [LICENSE](LICENSE)
