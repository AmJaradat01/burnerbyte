# Contributing to BurnerByte

Thanks for taking the time. This page covers the development setup, how changes
get proposed, and the conventions the codebase follows.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). For
security problems, follow [SECURITY.md](SECURITY.md) instead of opening a public
issue.

## Development setup

### Prerequisites

- Go 1.25+ (the `go` directive in `go.mod` is `1.25.0`)
- Node.js 20.9+ with pnpm
- Docker and Docker Compose
- [golang-migrate](https://github.com/golang-migrate/migrate) CLI, for the
  `migrate-*` make targets

### Getting started

```bash
git clone https://gitlab.com/burnerbyte/burnerbyte.git
cd burnerbyte

# Infrastructure only — postgres, redis and minio, with their ports published
# to the host. (`make docker-up` would run the whole stack including the API,
# which you are about to run yourself.)
make docker-infra

cp .env.example .env
make migrate-up

make run-api                          # :8080
make run-smtp                         # :2525   (separate terminal)
cd web && pnpm install && pnpm dev    # :3000   (separate terminal)
```

To check a change against the packaged stack instead, `docker compose up -d
--build` runs everything in containers.

### Running tests

```bash
make test                     # go test -race ./...
make migrate-test             # every migration up then down
make lint                     # golangci-lint

cd web && pnpm test           # vitest
cd web && pnpm lint           # eslint
cd web && pnpm typecheck      # tsc --noEmit
```

`make web-test` runs all three. `pnpm typecheck` is not redundant with the
build: `next build` only typechecks files in its build graph, so type errors
confined to `*.test.tsx` pass both the build and lint.

Go tests include [`rapid`](https://github.com/flyingmutant/rapid) property
tests. When one fails it writes a reproduction file under `testdata/rapid/`;
those are local debugging artifacts and are not committed.

## Proposing a change

External contributors work through a fork:

1. Fork the project on GitLab and clone your fork.
2. Branch from `develop`, never from `main`:
   `git checkout -b feature/short-description develop`
3. Commit using the conventional-commit prefixes below.
4. Push to your fork and open a **merge request against `develop`**, describing
   what changed and how you verified it.

Please keep a merge request to one coherent change, and include tests for
behavior you add or fix.

### Commit messages

| Prefix | Use for |
|---|---|
| `feat:` | new functionality |
| `fix:` | bug fixes |
| `docs:` | documentation only |
| `test:` | tests only |
| `refactor:` | restructuring with no behavior change |
| `perf:` | performance work |
| `build:` / `ci:` | build system, Docker, or pipeline changes |
| `chore:` | maintenance that fits nothing above |

## Branching model

The project follows git-flow (the AVH edition of the `git flow` tool):

- `main` — released code only, every commit tagged (currently in the `v1.x`
  line)
- `develop` — integration branch; everything lands here first
- `feature/*` — branched from `develop`, merged back with `--no-ff`
- `release/*` — branched from `develop`, merged into both `main` and `develop`
- `hotfix/*` — branched from `main` for urgent fixes

### Releases (maintainers only)

Releases are cut with the `git flow` tool rather than by hand:

```bash
git flow release start X.Y.Z
# update CHANGELOG.md, commit
GIT_MERGE_AUTOEDIT=no git flow release finish X.Y.Z
git push origin main develop vX.Y.Z
```

`feat:` changes take a minor bump; `fix:`, `test:` and `docs:` take a patch.

## Continuous integration

CI runs on Jenkins from the `Jenkinsfile` in the repository root. It builds both
Go binaries and the frontend, runs the Go and frontend test suites, and deploys
tagged builds. The pipeline depends on maintainer-held credentials, so it does
not run against forks — run `make test`, `make lint` and `pnpm test` locally
before opening a merge request.

## Code style

- **Go** — `gofmt` and `golangci-lint` (see `.golangci.yml`) must both be clean.
- **TypeScript** — the ESLint config in `web/`.
- **API responses** use `snake_case` JSON; timestamps are RFC 3339.
- **Configuration** — every new config key needs a `SetDefault` (or `BindEnv`)
  registration in `internal/config/config.go`, plus a line in **both**
  `config.example.yaml` and `.env.example`. Viper silently ignores a `BB_*`
  override for a nested key it does not already know, so an unregistered key
  means the documented value is never applied — and a key absent from the
  examples is effectively undocumented. Tests in `internal/config` diff all
  three against each other in both directions and will fail if any drifts.
- **Routes** — a new endpoint needs a matching entry in
  `internal/handler/docs/openapi.json`. `TestOpenAPIMatchesRouter` diffs the
  document against the route registrations and fails on a missing or phantom
  operation. Bump `info.version` in the release commit; a test checks it against
  the newest `CHANGELOG.md` heading.
- **Migrations** — created with `make migrate-create`; always write a matching
  `.down.sql`, and verify with `make migrate-test`. A new permission also needs
  its `role_permissions` grants, or the scope it gates becomes unreachable.
- **Editors** — an `.editorconfig` is provided; enable EditorConfig support.

## Maintainer

BurnerByte is maintained by Ali Jaradat, who reviews merge requests. Open an
issue first for anything large so the approach can be agreed before you build it.

## License

By contributing, you agree that your contributions are licensed under the
Apache License 2.0 — see [LICENSE](LICENSE).
