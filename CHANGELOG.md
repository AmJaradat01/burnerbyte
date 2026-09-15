# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely, and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html): `feat:` work
takes a minor bump, `fix:` / `docs:` / `test:` a patch.

## v1.18.0 (September 2026) — Moved to gitlab.com/amjaradat01/burnerbyte; brand marks

### Changed
- **The Go module path is now `gitlab.com/amjaradat01/burnerbyte`.** The project moved out of the `burnerbyte` group into a personal namespace. GitLab redirects the old path, so nothing was broken — but the redirect only holds while the old group exists, and a module path should not point at a namespace someone else could later claim. Rewritten across 106 Go files plus `go.mod`, `.golangci.yml`, the Jenkins checkout URL, `package.json`, README, CONTRIBUTING and the docs: 118 files, 279 references.
- `web/public/favicon.svg` used `#4F46E5` (Tailwind's indigo) rather than the product's `#2459E2`, and `web/public/manifest.json` set a warm `#fafaf8` background where the token is the cool `#F8FAFD` — the same warm/cool inversion already corrected in DESIGN.md.

### Added
- Brand marks in `brand/`: a full lockup (the `B` over the wordmark on the indigo tile) for the repo avatar and README, and the `B` alone for the favicon and PWA icon. Two marks rather than one because the wordmark stops being legible below roughly 48px — the same split the product already makes, where the sidebar collapses `BurnerByte` to `B`. `brand/README.md` covers which to use where, the exact tokens, and how to regenerate the PNGs.

## v1.17.1 (September 2026) — About card trimmed; version shows the nearest tag

### Changed
- The About card in Settings → System links the author's name to x.com/AmJaradat01 and drops the License and Source rows — both were already one click away, leaving the two things the card is actually opened for: the version, and who made it.
- **The version badge read `v1.17.0-1-gcc5c815`.** Accurate but noisy: git-flow tags a release on `main` and back-merges into `develop`, so develop permanently sits one commit past its own tag and `git describe` reports the distance and sha. Builds now take the nearest tag, appending `-dirty` when the tree has uncommitted changes so a modified build cannot claim to be a clean release. Jenkins still overrides `VERSION` with the exact tag it was asked to build.

## v1.17.0 (September 2026) — Version stamping in Docker; tighter CI gates

### Fixed
- **Every Docker build reported `dev`** — the sidebar badge read "vdev". Only the Jenkinsfile passed `-ldflags`, and only for the api binary, so the documented primary install path could never report what it was running. Both binaries now take a `VERSION` build arg; `make build` and `make docker-up` derive it from `git describe --tags --always --dirty`. A bare `docker compose up` still reports `dev`, which is accurate for an unstamped source build.
- `cmd/smtpd` had no version variable at all, so a deployed SMTP server could not say what it was. It now has one and logs it at startup.
- **Jenkinsfile:** `bin/smtpd` was built without the version stamp; the migration step was `|| true`, letting the integration suite run against a stale schema and report a missing column as a code fault; the frontend stage ran `pnpm test` but neither `pnpm lint` nor `pnpm typecheck` (which matters — `next build` only typechecks files in its build graph); and the production hostname was hardcoded inline while `NEXT_PUBLIC_SITE_URL` was never set at all.

### Changed
- Jenkins now runs `go vet` and `go test -race`, matching the Makefile, and checks for `golang-migrate` before migrating so a missing tool names itself instead of surfacing as a confusing test failure. **This fails the pipeline if the agent does not have golang-migrate installed.**
- Versioning is documented in `CONTRIBUTING.md` and in the self-hosting monitoring page; neither mentioned it.

## v1.16.1 (September 2026) — Analytics rendering fixes

### Fixed
- **The KPI strip showed eight dashes on a fresh install.** `MetricCard` drew a minus icon and a literal `--` whenever a trend was null; five of the eight metrics pass null unconditionally, and with no history every one of them is null. It now renders nothing, keeping the row's height so the grid does not shift when real trends arrive.
- **The average reference line collided with the date axis.** It was drawn even when the average was zero, putting it exactly on the x-axis with its `Avg: 0` label over the ticks. A zero average is not a comparison worth drawing, so the line is now conditional.
- **An all-zero date range rendered as a row of flat bars** with no explanation; only a literally empty array reached the "No email data for this period" state.

Screenshots in the README and docs were regenerated afterwards, so they show the fixed UI.

## v1.16.0 (September 2026) — Attribution, product screenshots, and a CORS port fix

### Added
- **Screenshots** of nine pages, captured from a real instance with mail actually delivered over SMTP. A hero shot of the inbox reader in the README and on the docs home, a gallery in the README, and per-page shots through the docs.
- **Attribution** in the places people look for it: `LICENSE` names the copyright holder, a new `AUTHORS` file, Maintainer sections in `README.md` and `CONTRIBUTING.md`, and the `author` / `license` / `repository` fields `web/package.json` was missing.
- An **About card** at the foot of Settings → System showing version, licence, author and source link — the one place in the product where attribution belongs. Not in the sidebar, login or app chrome: BurnerByte is self-hosted, so the product UI belongs to whoever deploys it.

### Fixed
- **Setting `FRONTEND_PORT` alone broke CORS.** The API's `FRONTEND_URL` stayed on `localhost:3000` and `BB_CORS_ALLOWED_ORIGINS` derives from it, so changing the frontend port silently blocked every browser request. The frontend build args already fell through `FRONTEND_PORT`/`API_PORT`; the api service environment did not. Both do now, with defaults unchanged.
- `LICENSE` said "Copyright 2024" while the first commit is February 2026.

## v1.15.1 (September 2026) — Documentation navigation and contributor guidance

### Fixed
- **The docs sidebar listed three sections three times each.** Root `meta.json` declared a `---Label---` separator immediately before the folder of the same name, so every section rendered twice; Getting Started, API Reference and Self-Hosting were also nav links, adding a third. The sidebar drops from about twenty rows to ten.
- The docs home had a card duplicating Installation's href with no anchor, an endpoint count still reading "100+", and two descriptions that no longer matched the code (the settings cascade omitted the team tier; storage did not mention the local-filesystem fallback).

### Changed
- `CONTRIBUTING.md` now states that a new config key needs a line in **both** `config.example.yaml` and `.env.example` (tests enforce it in both directions), that a new route needs an OpenAPI entry (`TestOpenAPIMatchesRouter` enforces it), and that a new permission needs its `role_permissions` grants — the omission that had made three email endpoints unreachable.

## v1.15.0 (September 2026) — `team.emails.manage` seeded; documentation fully reconciled with the code

### Fixed
- **Three email endpoints were unreachable with any API key.** `mark-all-read`, mark read/unread and delete-email gate key callers on the scope `team.emails.manage`, but that permission was never seeded — so no key could hold it and all three answered `403`. Session auth was unaffected. Migration `000047` seeds it and grants it to team lead and member. The scope table in `apikey_test.go` claimed `view` where the handlers said `manage`; because it is a static mapping that never exercises a handler, it passed and hid the gap.
- **`config.example.yaml` was missing 16 registered keys and `.env.example` 28**, including the entire auth-cookie and demo-mode groups — which is how the unregistered-key bugs stayed invisible. Both are now exhaustive.
- **The OpenAPI document was missing six real routes** (all three `/try` endpoints, analytics `domain-series` and team `insights`, webhook `stats`) and marked seven public routes as requiring a bearer token, so generated clients demanded auth for endpoints that take none.

### Added
- Three tests keep the config examples honest: every `SetDefault`/`BindEnv` key in `Load()` is compared against `config.example.yaml` and `.env.example` in both directions, and the example file is loaded to prove it still parses.
- Two tests keep the API reference honest: one diffs the OpenAPI document against the router (162 operations across 122 paths, zero missing, zero phantom), one catches `info.version` going stale as it did for nine releases.

### Changed — documentation reconciled with source across all 27 pages
- `realtime.mdx` claimed the notification centre keeps an in-memory list; it is server-backed. Added the 5-connection per-user cap, the origin checks, the inbox socket's 403/410 ownership and expiry checks, and the Redis cross-process bridge — without which nothing explained how mail received by smtpd reaches a socket held by the API.
- `smtp-pipeline.mdx` placed MIME parsing in the worker pool; it happens in the listener before the queue. Added the 16-extension executable blocklist, the sanitize and spam-score steps, the audit entry, and the protocol limits.
- `workers.mdx` omitted that every job runs once at startup, that a zero interval is skipped, that panics are recovered, and that `admin_stats` short-circuits with no clients.
- `production.mdx` called the frontend a static export and advised running "workers on one instance" — there is no leader election and no flag to start an API without them. Object storage was also missing from the minimal environment.
- `dns.mdx` gave an SPF example that can never pass the check, leaving the indicator permanently red. Documented the exact MX match and the preserve-on-lookup-error behaviour.
- `reverse-proxy.mdx` omitted `X-Forwarded-Proto` on the WebSocket block, and neither sample config cleared `True-Client-IP` — which chi's `RealIP` consults first and which the `/metrics` guard and rate limiter both read. Also documented that `NEXT_PUBLIC_*` are build-time inlined, so TLS needs a frontend rebuild.
- The first-run installer was documented only in the README, though a clean checkout boots straight into it; `installation.mdx` is now its home.
- `troubleshooting.mdx` gained "Domain never verifies", the likeliest setup failure.
- Smaller corrections across settings-cascade, domains, emails, inboxes, api-keys and webhooks; README gained the Files group and the missing Auth/Teams/Analytics/Domains rows, and states the exact endpoint count.

Counts re-derived and consistent everywhere: 47 migrations, 36 tables, 74 indexes, 7 triggers, 7 workers, 5 roles, 34 permissions, 27 frontend routes.

## v1.14.1 (September 2026) — Documentation catch-up for v1.14.0

### Changed
- `EXTERNAL_DATABASE_URL` / `EXTERNAL_REDIS_URL` are now in the README's configuration section, not only in `.env.example` and the Docker page, along with an explanation of why database and Redis are the one pair that cannot be configured from inside the app.
- `monitoring.mdx` documents the per-dependency fields `/readyz` returns, not just the aggregate status.
- The `datastores` object on `GET /setup/status` is documented in `installation.mdx` (with its response shape and rationale) and noted in the API reference, including that it is withheld once setup completes.

Re-verified the rest against the tree: 46 migrations, 36 tables, 74 indexes, 7 workers, five built-in roles, all 27 frontend routes covered, and every pinned version matching `go.mod` and `package.json`.

## v1.14.0 (September 2026) — Setup wizard validates the real password policy; managed databases under Docker

### Fixed
- **The setup wizard let you past step 1 with a password the server would reject.** `canNext()` checked only that the field was non-empty, so a policy-violating password was caught four screens later by `POST /setup/complete`, with the whole form still to re-confirm. The wizard now reads the live policy from the public `GET /auth/sso-status` — the same endpoint `/register` uses — gates Next on it, and validates the email shape.
- The wizard's requirement checklist was hardcoded while the policy is admin-configurable, so its hints could disagree with what the server enforced. Both it and the strength meter are now policy-driven, and `/register` has been refactored onto the same `lib/password-policy.ts`; the two surfaces previously carried separate copies of this logic and had already drifted.
- **A managed database could not be used with Docker.** `docker-compose.yml` hardcoded the internal DSN on `api`, `smtpd` and the `migrate` job, so setting `DATABASE_URL` in `.env` was silently ignored and the only route was editing the compose file.

### Added
- `EXTERNAL_DATABASE_URL` and `EXTERNAL_REDIS_URL` point the Docker stack at managed instances; `api`, `smtpd` and the one-shot `migrate` job all honour them, so the schema is applied to the right database. They are deliberately *not* named `DATABASE_URL` / `REDIS_URL`: `.env` is shared with host-mode `make run-api`, where those point at `localhost`, and `localhost` inside a container is the container itself.
- `GET /setup/status` reports the datastore connection targets with credentials stripped, and the wizard shows them above the admin form. Database and Redis are the two settings the wizard cannot change, and nothing previously said where they came from — so there was no way to confirm you were configuring the intended instance rather than a local Postgres left over from an earlier run. The field is withheld once setup completes, matching the `test-*` endpoints.

## v1.13.0 (September 2026) — Config env bindings completed; /docs synced to the code

### Fixed
- **Thirteen more documented `BB_*` variables were silently ignored** — the same viper failure mode fixed for MinIO/SMTP in v1.12.0. `BB_MAILER_{HOST,USERNAME,PASSWORD,FROM}`, all ten `BB_SSO_*`, `BB_RATE_LIMIT_TRUSTED_PROXIES`, `BB_PASSWORD_POLICY_BCRYPT_COST`, `BB_DEFAULTS_{WEBHOOK_MAX_RETRIES,ANALYTICS_DEFAULT_DAYS,TIMEZONE,DATE_FORMAT,TIME_FORMAT}` and `BB_EMAIL_VERIFICATION_TTL` are all registered and reachable now. Nothing crashed before — consumers defended with `<= 0` fallbacks — but an operator configuring the mailer purely from the environment got silence.
- **No domain could verify under Docker.** `BB_SMTP_HOSTNAME` was set on `smtpd` only, but the API is what runs verification, comparing each domain's MX and SPF records against `smtp.hostname` with an exact match. The API ran on the `localhost` default. Now set on both services.
- **The setup wizard's infrastructure panel never worked.** It read `data.postgres` / `data.redis` from `/readyz`, which returned only `{"status":"ok"}`, and it fetched a relative `/readyz` that hit the Next.js server and 404'd. `/readyz` now probes both dependencies without an early return and reports them individually; the frontend gained `API_ORIGIN` for the root-level health endpoints.
- **Service worker threw on every page load.** It passed browser-extension requests to the Cache API, which only accepts http(s), producing an unhandled `Request scheme 'chrome-extension' is unsupported` rejection.
- `shortcut-help.tsx` advertised a `d` "delete selected email" shortcut with no handler anywhere in the app.
- `openapi.json` declared three operations that do not exist: `DELETE` on an org member (only `PATCH` and a deactivate `POST` are registered), plus `/healthz` and `/readyz`, which are served at the root and therefore 404 under the spec's `/api/v1` server entry.

### Changed
- **`/docs` fact-checked against the source across all 27 files** — roughly 100 corrections. 56 endpoint paths were missing the `/api/v1` prefix the router mounts them under. Counts corrected (46 migrations, 74 indexes, 27 pages, 20 handlers, 23 repositories). Genuinely wrong behaviour fixed: webhook retries (3 attempts at 0s/5s/25s, and no retry limit disables a webhook), the `webhook_retry` and `dns_recheck` and `invite_expiry` worker descriptions, the attachment storage path, inbox privacy (a service-layer ownership check, not a repository filter), and the email iframe sandbox. Two copy-paste snippets that would have failed — the `setup_state` SQL used `gen_random_uuid()` against a BOOLEAN singleton key, and an API-key example passed `"90d"` to a Go duration parser with no day unit.
- `frontend/theming.mdx` had four fabricated token values — including a `--background` on hue 75 (warm amber) where the system is hue 265 (cool indigo) — and an entirely invented elevation table. Both now carry the real values from `globals.css`.
- Documented what was missing: auth cookie, demo mode, `BB_CONFIG_PATH`, the `/metrics` access restriction, and i18n (next-intl ships one locale and no routing middleware).
- `DESIGN.md`'s type scale had drifted from `globals.css` (headline 1.75rem/700 against the shipped 2rem/800) and omitted the display and subhead roles.
- `docker-compose.yml` frontend build args now fall through `API_PORT` / `FRONTEND_PORT`, so changing a port no longer leaves the browser bundle calling the old one.

### Added
- `pnpm typecheck` and `make web-test`. `next build` only typechecks files in its build graph, so type errors confined to `*.test.tsx` passed both lint and the image build.

## v1.12.1 (September 2026) — MinIO bucket-creation race

### Fixed
- **api and smtpd could end up on different storage backends.** Both boot at once and both create the bucket on a first run against an empty MinIO; the process that lost that race read `BucketAlreadyOwnedByYou` as a failure and fell back to local-filesystem attachments while its sibling used MinIO, so mail ingested by one was unreadable by the other. The bucket exists and belongs to us, so that response is now treated as success. Genuine failures such as `AccessDenied` still propagate. Latent until `BB_MINIO_*` binding was fixed in v1.12.0 — before that the endpoint was always empty, so nothing reached the create path.

## v1.12.0 (September 2026) — Docker works on a clean checkout; repo prepared for open source

### Fixed
- **The compose stack could not start.** `minio/minio` no longer exists on Docker Hub. Repointed at quay.io, MinIO's official registry, and pinned a release rather than tracking `latest`.
- **The frontend image failed to build.** `pnpm-workspace.yaml` carries the build-script policy but was never copied into the deps stage, so pnpm 10+ aborted with `ERR_PNPM_IGNORED_BUILDS`; the `2>/dev/null || pnpm install` fallback then hid the real error. The workspace file is copied, the fallback is gone, and `packageManager` pins pnpm to the version that produced the lockfile.
- **`BB_MINIO_*` and `BB_SMTP_HOSTNAME` were silently ignored.** Viper's `AutomaticEnv` only populates a nested key it already knows, and neither group was registered. Object storage never engaged under Docker — it fell back to local-filesystem attachments without surfacing an error — and the SMTP greeting went out as `220  ESMTP BurnerByte`, malformed under RFC 5321.
- **`docker compose up` failed on hosts already running Postgres, Redis or MinIO.** Those services are only reached over the compose network, so the base file no longer publishes 5432/6379/9000 on the host.
- **smtpd's local-storage fallback could not write.** The image never created `/data/attachments`, so the fallback failed as a non-root user.

### Added
- `docker-compose.dev.yml`, an overlay that publishes the infrastructure ports for local development; `make docker-infra` uses it.
- A persistent volume for the local attachment fallback, so those files survive a container recreate.
- `make test`, `make docker-logs`, and `make migrate-test-db`.
- `SECURITY.md`, `CODE_OF_CONDUCT.md`, and `.editorconfig`.
- `TestEnvOverridesReachNestedKeys`, guarding the unregistered-viper-key failure mode.

### Changed
- The frontend image moves to the Node 22 LTS line; Node 20 is end-of-life.
- Integration tests now compare `schema_migrations` against `migrations/` and name the fix, instead of failing deep in a query as `column ... does not exist`.
- README rewritten against the source: endpoint paths carry their `/api/v1` prefix, the Notifications, demo and admin groups are documented, `/` and `/try` are listed, the database figures are corrected to 46 migrations / 36 tables / 74 indexes, RBAC is described as the five seeded roles over 33 permissions, and the GitLab CI claim and dead pipeline badge are replaced with the Jenkins reality.
- CHANGELOG backfilled from v1.2.7 to v1.11.2.
- CONTRIBUTING corrected (Go 1.25, `make docker-infra`, golang-migrate) and given a fork-and-merge-request path for outside contributors.
- `installation.mdx` no longer instructs readers to create a `config.yaml` for a `COPY` removed in v1.0.6.
- DESIGN.md badge tokens no longer specify identical background and text colors, and its dark-theme leftovers are gone. PRODUCT.md and DESIGN.md describe the design patterns they reject rather than naming competitors.
- The landing page reads `prefers-reduced-motion` via `useSyncExternalStore` instead of seeding it from an effect, which rendered once with the wrong value and flashed animation at users who asked for none.
- eslint is clean (was 8 errors, 10 warnings).

### Removed
- `Dockerfile.smtpd`, redundant with the multi-stage `smtpd` target.
- Local tooling from version control — `.kiro/` specs, vendored `.agents/` skills, `.impeccable/`, `skills-lock.json`, and the live-deployment test scripts `.gitignore` already intended to exclude. All remain on disk.
- `.mailmap`, which mapped the commit author to an unrelated employer address and changed nothing else, and the stale `rapid` failure corpora.
- The real production IPv4 and IPv6 printed by `deploy/hetzner-setup.sh`; it now reads the addresses off the host it runs on.

## v1.11.2 (July 2026) — Expired-inbox race on the home page

### Fixed
- Handle the race where an inbox expires between the home page listing it and the user opening it, instead of surfacing a dead link.

## v1.11.1 (July 2026) — Webhook validation and stats

### Added
- Delivery stats surfaced on the webhooks list.

### Fixed
- Frontend webhook URL validation now matches what the backend accepts, so valid URLs stop being rejected client-side.

## v1.11.0 (July 2026) — Webhooks as a table

### Changed
- Rebuilt the webhooks page from a card grid into a table-based layout, with the UX improvements that come with scanning rows rather than cards.

## v1.10.3 (July 2026) — Footer position

### Fixed
- Footer now sits consistently between the admin and regular layouts.

## v1.10.2 (July 2026) — DNS record guidance

### Changed
- Domain detail uses a "Host" label with the full domain name and an `@` hint, matching how DNS providers actually label the field.

## v1.10.1 (July 2026) — Domain detail polish

### Fixed
- Hide the verify button once a domain is verified, correct the DNS Name field, and general UX cleanup on the domain detail page.

## v1.10.0 (July 2026) — Teams as a table

### Changed
- Rebuilt the teams list from a card grid into a table-based view.

### Fixed
- Domain detail page polish and unused-import cleanup.

## v1.9.0 (July 2026) — Domains as a table

### Changed
- Rebuilt the domains list from a card grid into a table-based list view.

## v1.8.0 (July 2026) — UX review pass

### Changed
- Dashboard cards, a copy-first inbox layout, an animated address input, and a row-based list treatment, from a full UX review.

## v1.7.0 (July 2026) — Dashboard and analytics polish

### Changed
- Consistency pass across dashboard and analytics surfaces.

### Security
- Fixes carried in the same review; see the commit range for detail.

## v1.6.0 (July 2026) — Analytics enhancement

### Added
- Storage trends, team insights, webhook metrics, and domain drill-down on the analytics dashboard.

## v1.5.0 (July 2026) — UX enhancement batch

### Changed
- Eleven separate UX improvements shipped together across the product surfaces.

## v1.4.7 (July 2026) — Home page i18n

### Changed
- Moved the remaining hardcoded home-page strings into translations.

### Fixed
- Mobile responsive fix on the home page.

## v1.4.6 (July 2026) — Non-admin layout fixes

### Fixed
- Empty space for non-admin users, breadcrumb behavior, and the dashboard redirect.

## v1.4.5 (July 2026) — Address preview

### Added
- Animated address preview, domain chip, keyboard shortcut, and a success pulse on inbox creation.

## v1.4.4 (July 2026) — QuickCreate layout

### Changed
- Redesigned QuickCreate into an inline chips layout and added inbox time display.

## v1.4.3 (July 2026) — Post-login redirect

### Fixed
- Default post-login redirect goes to `/` instead of `/dashboard`.

## v1.4.2 (July 2026) — Home filters

### Changed
- Removed the filter tabs and improved the customize accordion on the home page.

## v1.4.1 (July 2026) — CI fixes

### Fixed
- Resolved CI test failures and health-check timing in the deploy pipeline.

## v1.4.0 (July 2026) — Inbox renewal policy

### Added
- Admin-configurable inbox renewal policy.

## v1.3.4 (July 2026) — Inbox card states

### Changed
- Inbox cards are visually differentiated by state.

## v1.3.3 (July 2026) — TTL validation

### Added
- Client-side TTL validation with inline error messages.

## v1.3.2 (July 2026) — Landing grid heights

### Fixed
- Equal-height cards in the landing lifecycle and capabilities grids.

## v1.3.1 (July 2026) — Expired filter removal

### Removed
- The expired filter tab on the home page — expired inboxes are auto-purged, so the tab was always empty.

## v1.3.0 (July 2026) — Bold pass, second half

### Changed
- Strengthened the remaining page surfaces: inbox, auth, profile, and domain/team cards.

## v1.2.9 (July 2026) — Bold pass, first half

### Changed
- Visual overhaul: typography scale, stronger hierarchy, and more component presence.

## v1.2.8 (July 2026) — Interaction polish

### Added
- `EmptyState` gained an icon prop, a variant system, and visual composition; contextual icons added to every remaining usage.
- Micro-interactions and press feedback on shared components.

### Changed
- Project-wide transition consistency; step-indicator transitions in the wizards; explicit transition timing on auth pages.
- Analytics progress-bar tracks replaced with inline data rows; dashboard card overload reduced; landing hero depth and section variety improved.
- Profile danger zone, connected-accounts hover, and password strength display.

## v1.2.7 (July 2026) — Teams review fixes and profile rebuild

### Changed
- Rebuilt the profile page against the design system, after reverting an earlier redesign attempt.
- Teams: audit severity corrections, migration cleanup, `BulkRemove` optimization, and full test coverage.
- Settings: Demo Mode section and Save button, Object Storage section, About card removed.

### Fixed
- Render-during-render bug in settings, plus an `enforce_sso` safety warning.
- Profile edge cases: initials, alt text, `fetchMe` error handling, and revoke-all logout.
- Connected Accounts only renders when SSO is enabled and providers exist.

### Security
- Block password changes when SSO is enforced.

## v1.2.6 (June 2026) — Setup wizard polish + SMTP timeout fix

### Fixed
- **SMTP test no longer hangs** — added 10-second connection timeout and proper STARTTLS negotiation to `test-smtp`. Previously port 587 connections could hang indefinitely waiting for the TLS upgrade response.

### Changed
- **Removed dead `footer_text` field from branding** — was never stored by the backend or displayed anywhere. Branding step now has only Logo URL with a live preview.
- **Redesigned the review step** — Required/Optional groupings, primary-colored icons for required items, badge labels, admin name + email on separate lines, and an info note explaining what "Complete Setup" does.

## v1.2.5 (June 2026) — Org deletion hardening + branding cleanup

### Added
- **Password confirmation for org deletion** — the Danger Zone now opens a proper confirmation dialog requiring both the org name and the user's password before deleting. Backend enforces password verification via `DELETE /orgs/:id` body.

### Fixed
- **SSO users (including linked accounts) can delete their org** — previously a user who had a password but now logs in via SSO was blocked because the backend required a password they couldn't provide. Now SSO-authenticated users are verified by their active session; pure password users still must provide their password.

### Changed
- **Removed `primary_color` from setup wizard branding** — the color field was unused in the app. Branding step now has only Logo URL and Footer text.
- **Documentation updated** for v1.2.2–v1.2.4 changes: README, architecture, frontend, RBAC, quick-start, and settings-cascade docs all reflect the onboarding gate, empty states, and platform admin decoupling.

## v1.2.4 (June 2026) — Platform administration without an organization

A system admin can now operate the platform without belonging to an organization, instead of being forced into the org-creation wizard. Regular users are still routed through onboarding.

### Changed
- **System admins are exempt from the forced onboarding redirect.** A zero-org admin is guided by empty-state CTAs rather than trapped in `/onboarding`; non-admins are still redirected (they must create or join an org).
- **The sidebar keeps platform surfaces reachable for a no-org admin** — Settings and Audit show even with no organization (the org-scoped items still appear only once an org exists).
- **Settings is decoupled from the org for platform tabs.** Roles, SSO, and System are available to a system admin with no org; General and Users (org-scoped) appear only when an org is selected, and the default tab falls back to System.
- **Audit serves platform scope without an org.** A no-org admin sees platform-level events directly (the org/platform scope toggle appears only when an org is selected).

### Notes
- The org-creation onboarding, invite acceptance, docs, and account pages remain reachable for everyone with no org; org-scoped pages still show the `NoOrgState` "Create organization" CTA.

## v1.2.3 (June 2026) — Webhooks / API keys no-team empty state

Completes the empty-state work on the two team-scoped pages.

### Changed
- **Webhooks and API keys now use a shared `NoTeamState`** empty state when the org has no team, replacing a bespoke inline message. Since the first team auto-selects, "no current team" means the org genuinely has no teams, so the copy now says to create one ("Webhooks/API keys belong to a team. Create your first team to get started.") with a "Go to Teams" action, matching the `NoOrgState` and `EmptyState` patterns.

## v1.2.2 (June 2026) — Force onboarding; no more org dead-ends

Fixes a state where a signed-in user with no organization landed on org-scoped pages that just said "Select an organization first." with no way forward.

### Fixed
- **The onboarding gate is now server-authoritative.** It was gated on a dismissable `bb_onboarding_done` localStorage flag, which could desync from reality: a user with zero organizations but the flag set was never redirected and got stranded on dead-end pages. The redirect to `/onboarding` now fires purely on the real org count (with `/onboarding`, `/invite`, `/setup`, `/docs`, and `/profile` exempt so account, invite, and docs stay reachable).
- **Removed the "Skip setup" button** on the onboarding org step. With the forced gate it only led to a redirect loop / dead-end (you cannot use an org-scoped app with no org).

### Changed
- **Org-scoped nav is hidden until you have an organization**, so the sidebar never advertises pages that cannot work yet.
- **Every org-scoped page now shows a real empty state** (`NoOrgState`) instead of the bare one-liner: a "Create organization" call to action for admins, or guidance to request an invite for everyone else. Applied to domains, teams, audit, analytics, settings, the dashboard, and the domain detail page.

### Notes
- Platform-level admin surfaces are still coupled to having an organization in the UI; decoupling system-admin pages (so an admin can run the platform with no org of their own) is a separate follow-up if wanted.

## v1.2.1 (June 2026) — Design refresh: edge surfaces

Aligns the two surfaces that intentionally live outside the token system to the refreshed palette, so the new look is consistent everywhere.

### Changed
- **Global error boundary** (`global-error.tsx`): its inline palette (it cannot use tokens, since it renders when the layout/CSS may have failed) now uses the cool near-white background, deeper indigo accent, and cool neutrals of the refreshed system, with the softer corner radius.
- **Setup branding "Primary color" placeholder** updated to the new default indigo (`#2459e2`).

### Notes
- A full project sweep confirmed no other off-token shadows or colors remain (the only other literal hex values are Google's official SSO brand colors, which must stay exact). The v1.2.0 token refresh covers every other surface automatically.

## v1.2.0 (June 2026) — Design system refresh (Refined Workshop Bench)

A project-wide visual refresh, done at the token layer so every surface updates cohesively. The "Workshop Bench" identity and all its rules are intact; this is the elevated, more premium execution of it.

### Changed
- **Cohesive cool-neutral ramp.** Surfaces, text, and lines are now all tinted toward the indigo axis (hue 265) at very low chroma, instead of mixing a warm paper (hue 75) with cool text. Cleaner, more deliberate, more premium, and it finally matches what DESIGN.md always described.
- **Real, soft, layered elevation.** Tailwind's `shadow-*` scale is overridden to soft, two-layer shadows tinted to the indigo axis (never flat black), so cards have genuine depth and floating elements separate clearly. Every hardcoded black shadow in the codebase was migrated onto the scale; clickable cards now lift on hover.
- **A deeper, more confident accent.** Primary indigo moves from `oklch(0.55 0.20 260)` to `oklch(0.52 0.215 264)` (also improves white-on-primary contrast). Borders soften (`0.86` → `0.90`) so cards lean on elevation rather than heavy lines.
- **Sharper type hierarchy.** The headline step grows (`1.5rem` → `1.75rem`, tighter tracking) for clearer page presence; the corner radius softens slightly (`0.625rem` → `0.7rem`).

### Notes
- Light-only is preserved; the amber reservation (sidebar active + chart-1), the five-series chart palette, and the semantic colors are unchanged. Token-driven, so no component rewrites were needed beyond migrating shadows and adding hover lifts. DESIGN.md updated to document the refined system.

## v1.1.3 (June 2026) — Settings → System tab cohesion

A product-UI polish pass on the admin System tab, aligning it to the "Workshop Bench" design system so the whole surface reads as one governance panel.

### Changed
- **One section-header vocabulary.** Every section (Platform overview, Platform Settings, About, Service health, Email, Object storage) now uses the same `CardHeader` + icon-chip title + description via a shared `SectionHeading`, replacing three ad-hoc header treatments (headerless, in-card chip, above-card chip). Card padding and rhythm are now consistent across the tab.
- **Service health is one card, not a grid of cards.** The per-service cards became a single divided status list (icon, name, state, latency), removing the implicit nested-card layout; a degraded service now colors its status text, not just an icon.
- **About no longer nests bordered boxes inside a card** (a design-system violation); it is a clean divided definition list. Removed a redundant summary line that restated the stats grid below it. Storage health now shows the correct disk icon.

### Notes
- Presentational only; no API or behavior changes. Tokens-only colors, tabular figures on numerics, status never carried by color alone.

## v1.1.2 (June 2026) — CORS for custom-domain Docker deployments

### Fixed
- **docker-compose now passes CORS origins to the API.** The compose API service never set `BB_CORS_ALLOWED_ORIGINS`, so a deployment on a real domain was stuck at the `http://localhost:3000` default and the browser was blocked by CORS (and WebSocket origin checks) until the operator hand-edited the compose file. It now defaults to `FRONTEND_URL` (so setting your frontend URL is enough) and accepts a comma-separated `CORS_ALLOWED_ORIGINS` override for multiple origins. A test guards that the comma-separated env value parses into the origin list.

## v1.1.1 (June 2026) — Honor BB_CONFIG_PATH on load

### Fixed
- **`config.Load` now reads `BB_CONFIG_PATH`.** The first-run installer writes its `config.yaml` to `BB_CONFIG_PATH` (default `./config.yaml`), but `Load` only searched `.` and `/etc/burnerbyte`, so a custom `BB_CONFIG_PATH` produced a file the next boot never read, leaving the database unconfigured and looping back into the installer. `Load` now uses the explicit file when `BB_CONFIG_PATH` is set (and tolerates it not existing yet on first boot). This also lets operators point at a config file in any location. A round-trip test (installer write to `BB_CONFIG_PATH`, then `config.Load`) guards it.

## v1.1.0 (June 2026) — First-run web installer

Completes the infrastructure-setup work. The database and Redis are hard bootstrap dependencies (the app, and its own setup state, cannot run without them), so they cannot be configured from the in-app setup wizard. This adds the missing piece: a guarded, two-phase boot that configures them from a browser.

### Added
- **First-run web installer (`internal/installer`).** When the API binary starts with no database configured (`DATABASE_URL` unset and no `config.yaml`), it boots into a token-gated installer instead of exiting. It collects the database URL, Redis URL, JWT secret, and optional encryption key; verifies the connections; writes `config.yaml` (0600, secrets included); and re-execs into normal boot (falling back to a clean exit so a restart-policy supervisor starts a fresh, configured process).
- The installer serves a self-contained page (no framework, since nothing else is up yet) with connection testing and one-click secret generation. The write target is `./config.yaml`, overridable with `BB_CONFIG_PATH`.

### Security
- Every installer endpoint is gated by a 256-bit one-time token printed to the server logs (constant-time comparison). An already-configured instance never enters installer mode, so the installer can never repoint a live deployment's datastore. Docker and systemd deployments set `DATABASE_URL` in the environment and skip the installer entirely.

### Notes
- This closes the infrastructure-setup track: read-only health (v1.0.7), runtime mailer editor (v1.0.8), runtime storage editor with cross-process hot-reload (v1.0.9), and now the first-run installer. Database and Redis connection settings remain file/env-based by design; everything else is editable at runtime from the admin UI.

## v1.0.9 (June 2026) — Runtime storage editor with cross-process hot-reload

Object storage (S3/MinIO) can now be edited from the admin UI after setup, and the change is applied live in every process.

### Added
- **`GET` / `PUT /admin/config/storage` and `POST /admin/infra/test-storage` (system admin).** Edit the endpoint, access key, secret key, and TLS at runtime. On save the new config is **verified (connect + bucket) before it is persisted**, so bad credentials are rejected without disturbing the running backend.
- **Cross-process hot-reload.** A new hot-swappable `storage.Manager` wraps the object-storage backend; on save, a reload is broadcast over Redis (`internal/cfgsync`) and **both the API and the SMTP ingest server rebuild their clients live**, so incoming-mail attachments keep landing where the API serves them from. No restart needed.
- An **Object storage (S3/MinIO)** editor in Settings → System, beside the mailer editor and health panel.

### Fixed
- **Storage credentials saved during setup now load at boot.** `config.MinIOConfig` had no JSON tags, so `LoadFromDB`'s unmarshal silently dropped `access_key` / `secret_key` / `use_ssl` (the underscore keys did not case-fold to the Go field names). DB-stored storage configured via the setup wizard loaded with empty credentials, breaking S3 auth. Added the matching JSON tags.
- **The stored `storage` config is now encrypted at rest.** `storage` was missing from the `system_config` encrypted-key set, so the S3 secret key was stored in plaintext; it is now encrypted (backward-compatible with existing plaintext rows).

### Notes
- The bucket is read-only at runtime (changing it would strand existing attachments); set it via `BB_MINIO_BUCKET` at deploy time. DB and Redis connection settings remain env/config-only. Remaining from the infrastructure-setup work: the guarded first-run web installer.

## v1.0.8 (June 2026) — Runtime mailer editor with hot-reload

Outbound SMTP can now be changed after setup, from the admin UI, and the change takes effect immediately.

### Added
- **`GET` / `PUT /admin/config/mailer` (system admin).** Edit host, port, username, password, from-address, and TLS at runtime. Saving persists to the database (password encrypted at rest via the existing `system_config` encryptor) and **hot-reloads the live mailer through `Mailer.Reconfigure`, so no restart is needed**. The mailer is the only sender in the system (the SMTP ingest server receives, it does not send), so there is no cross-process reload to coordinate.
- An **Email (SMTP)** editor in Settings → System: load, edit, save, and test in one place, beside the existing service-health panel.

### Changed
- The password is never returned by the API; `GET` exposes only `has_password`, and an empty password on `PUT` preserves the stored secret.
- `POST /admin/infra/test-smtp` now tests the live mailer config (`Mailer.Config()`), so it reflects unsaved-then-saved edits rather than only the boot-time value.

### Notes
- Storage (S3/MinIO) is next: it is written by both the API and the SMTP ingest server, so its runtime editor needs a cross-process reload signal (and `storage` should be added to the encrypted-config key set, which it is not yet). DB and Redis remain env/config-only by design.

## v1.0.7 (June 2026) — Post-setup SMTP connection test

First slice of the infrastructure-setup work. The admin System tab already shows live Postgres/Redis/MinIO health; this adds the one missing piece, verifying outbound email after setup.

### Added
- **`POST /admin/infra/test-smtp` (system admin).** Opens a connection to the currently configured mailer (authenticating if credentials are set) and reports success, a message, and the round-trip time. It does not send an email. Surfaced as an "Email delivery → Test connection" action in Settings → System, alongside the existing service-health panel.
- Unlike the setup wizard's test (which is unauthenticated and refuses private IPs to prevent SSRF), the admin test dials directly: a system admin is trusted and may legitimately point the mailer at an internal relay. The shared `smtpDialTest` helper is now used by both paths.

### Notes
- This is the read-only / verification half of the infrastructure-setup work. Still planned: a runtime editor + hot-reload for storage and SMTP config (today they are set once during setup and loaded at boot), and a guarded first-run web installer for the DB/Redis bootstrap. DB and Redis connection settings remain env/config-only by design (they are required before the app, and the wizard's own state, can exist).

## v1.0.6 (June 2026) — Docker stack made runnable

Audited the container setup end to end and fixed the issues that prevented `docker compose up` from working on a clean checkout. The Jenkins (binary + systemd) deploy path is unaffected.

### Fixed
- **Image build no longer fails on `COPY config.yaml`.** That file is gitignored and absent on a clean checkout, so every image build broke. Removed from the API, SMTP, and `Dockerfile.smtpd` images; the binaries boot from environment variables (every key has had a registered default since v1.0.3). Mount a file at `/etc/burnerbyte/config.yaml` to override via file instead.
- **API boots under compose.** The compose `JWT_SECRET` default was 23 characters; the API refuses to start below 32, so a clean `docker compose up` crash-looped. The dev default is now a clearly-insecure 46-character placeholder.
- **Schema is now migrated.** Compose had no migration step, so the API ran against an empty database. Added a one-shot `migrate` service (pinned `migrate/migrate:v4.18.3`, the version the deploy scripts use); the API and SMTP server wait for it via `service_completed_successfully`. `up` is idempotent, so re-running the stack is safe.

### Changed
- **API healthcheck** on `/healthz`; the frontend now waits for the API to be healthy before starting.
- **`ENCRYPTION_KEY` is passed through** to the API and SMTP services (previously absent, so SSO/SMTP/storage secrets were always stored in plaintext under Docker). Unified on the unprefixed `ENCRYPTION_KEY` var in `.env.example`.
- **`NEXT_PUBLIC_*` are now frontend build args.** They are inlined into the client bundle at build time, so the previous runtime `environment:` entry had no effect; `API_BASE_URL` / `WS_BASE_URL` / `FRONTEND_URL` now flow through `build.args`.
- **Docs and tooling.** README split into "full stack in Docker" and "local development" paths; added a `make docker-infra` target (infra only); documented `REDIS_PASSWORD`, `SMTP_HOSTNAME`, `WS_BASE_URL`, and `SMTPD_PORT=25` (real inbound mail) in `.env.example`.

### Notes
- The MinIO bucket is auto-created by the app on first boot; the MinIO healthcheck (`mc ready local`) is MinIO's official probe. Base image tags, the `migrate/migrate` tag, and `CGO_ENABLED=0` builds were all verified. Custom-domain deployments still need CORS/WS origins and TLS configured manually.

## v1.0.5 (June 2026) — Onboarding team step fix

### Fixed
- **Onboarding wizard: team creation + domain assignment.** The `POST /orgs/:id/teams` response is wrapped as `{ "team": ... }`, but the wizard read the team ID off the wrapper. The ID came back `undefined`, so the follow-up domain assignment called `/teams/undefined/domains` and failed with a 400, breaking the team step of first-run setup. The client now reads `res.team`. The sibling steps (organization, domain, inbox) return flat objects and were already correct.

## v1.0.4 (June 2026) — Landing motion layer

A restrained, token-based motion pass over the public landing and `/try` surfaces (the marketing surfaces governed by the vendored design-audit skill). The product app UI is unchanged.

### Changed
- **Entrance and scroll-reveal motion.** Above-the-fold hero content now rises in on load with a short stagger; the lifecycle, capabilities, ownership, and closing-CTA sections reveal as they scroll into view. Implemented purely in CSS (an on-load keyframe plus `animation-timeline: view()` for the scroll reveals), so there is no JavaScript scroll listener, no added dependency, no flash of hidden content, and unsupported browsers simply render the static layout.
- **Tactile interaction states.** Primary CTAs press down on `:active` and their arrow nudges right on hover; lifecycle cells and capability rows tint on hover, with capability icons lighting to the brand accent. The deploy terminal in the ownership section gains a blinking cursor.
- **Depth.** A faint dotted datasheet backdrop behind the hero (tinted to the foreground token and masked to fade out) and a subtle brand-tinted veil behind the closing CTA, both well under the accent budget.
- **Accessibility.** Every animation is gated on `prefers-reduced-motion: no-preference` and collapses to the static, fully visible layout under reduced motion. Colors stay on the OKLCH design tokens; no hardcoded values were introduced.

## v1.0.3 (June 2026) — Env-only configuration defaults

Completes the 12-factor boot story started in v1.0.2. Every operational config key now has a sane default registered in code, so the binary runs correctly with secrets in the environment and **no `config.yaml`**, and every `BB_*` override actually applies.

### Fixed
- **JWT lifetimes default to sane values.** Without a config file, `jwt.access_ttl` / `jwt.refresh_ttl` unmarshalled to `0`: login returned `200` with `expires_in: 0` and an access token whose `exp` equalled `iat`, so every subsequent authenticated request was rejected as expired, and the refresh cookie was a session cookie with no `Max-Age`. They now default to `15m` / `168h`.
- **Inbox limits and TTLs default correctly.** `defaults.*` keys (`default_inbox_ttl`, `max_inbox_ttl`, `max_inboxes_per_domain`, `max_domains`, `max_teams`, attachment size, reset/invite/presigned/webhook/analytics TTLs) were `0` in env-only mode, where `0` means "block all inbox creation," not "use the documented value." They now mirror `config.example.yaml`.
- **Security policies on by default.** `password_policy.*`, `lockout.*`, and `rate_limit.*` now default to the documented hardened values (8-char policy with all character classes, 5-attempt lockout for 15m, rate limiting enabled) instead of permissive zero values.
- **Server timeouts, CORS, logging, and metrics** all carry their documented defaults rather than zero/empty.

### Why
viper's `AutomaticEnv` + `Unmarshal` only populates a nested key it already knows about (via `SetDefault`, a config file, or `BindEnv`). An unregistered nested key is silently left at its zero value and its `BB_*` override is ignored. Registering the full default set fixes both the zero-value behavior and env-override pickup.

### Tests
- `TestEnvOnlyDefaults` guards the env-only path: asserts JWT TTLs are non-zero with refresh outlasting access, inbox limits are usable, and policy/server/worker defaults are populated.

## v1.0.2 (June 2026) — Env-only boot

### Fixed
- Boot from an env-only configuration: registered defaults for the database connection pool (`max_open_conns`/`max_idle_conns`/`conn_max_lifetime`) so the pool no longer fails to build at `MaxSize=0`, and for the background-worker intervals so workers no longer log "invalid interval, skipping" and stop.
- `make run-api` / `make run-smtp` now source a local `.env` before `go run`, so `cp .env.example .env` is enough to run the stack locally (the binary itself never auto-loads `.env`).

## v1.0.1 (June 2026) — Landing polish

### Changed
- Reworked the public landing page against an anti-slop design audit: full-height hero on `100dvh`, a focused two-action hero (instead of three), and copy with no em dashes across the rendered UI and i18n catalog.
- Vendored the design-audit skill into the repo (`.agents/skills/taste-skill/`, tracked in `skills-lock.json`) so the landing/marketing surfaces have a repeatable review pass.

## v1.0.0 (June 2026) — First stable release

BurnerByte reaches 1.0: a self-hosted, multi-team temporary email platform that an enterprise security team can adopt and defend. This release consolidates the platform and hardens the core.

### Platform
- Multi-org, multi-team, multi-domain with dynamic RBAC (org owner/admin/member, team lead/member) and per-assignment, per-domain, per-team settings cascades.
- SSO (OIDC/OAuth) with domain-mapping auto-provisioning, invite-only mode with per-invite allowed auth methods, and bulk invites with multi-team assignment.
- Auth lifecycle: per-user auth-method lock, admin-driven migration between password and SSO, and session binding that revokes mismatched sessions on refresh.
- Disposable inboxes with a TTL cascade, real-time delivery, attachments, plus webhooks and API keys for integration.
- Audit logging, analytics that survive email deletion, and a compliance posture built on accountability.

### Highlights in this release
- Inbox search and a status filter (active / expired / all) on the dashboard.
- System-admin platform audit view (`GET /admin/audit`) for org-less events: registration, login, password reset, account deletion, session revocation.
- Reliability: domain DNS rechecks no longer downgrade a verified domain on a transient lookup error; platform-level audit events now persist (they were previously dropped by a NOT NULL `org_id` constraint).
- UI: design-system-aligned SSO provider cards (semantic status badge, copyable redirect URL), consistent empty states across surfaces, and tabular figures on the analytics page.
- Testing: property-based tests for auth lock/migration, domain status/validation, and audit classification; DB-integration tests for analytics persistence, invite flows, and platform audit; a reusable react-query frontend test harness.

### Notes
- Database migrations through `000044` — run `migrate up` on deploy.
- API surface documented in `internal/handler/docs/openapi.json` (now v1.0.0).

## v0.48.3 (May 2026)
- Fix: session revocation race condition — RevokeOldestExceeding uses FOR UPDATE SKIP LOCKED
- Validation: platform settings upper bounds for all numeric fields
- Validation: inbox TTL range validation (0-365 days) for default_inbox_ttl and max_inbox_ttl
- Validation: password_min_length capped at 128, lockout_max_attempts at 100, lockout_duration at 24h
- Validation: max_attachment_size_mb (0-100), max_domains/max_teams (0-10000), max_inboxes_per_domain (0-100000)

## v0.48.2 (May 2026)
- Security: SSO state parameter increased from 128 to 256 bits (OWASP recommendation)
- Security: WebSocket origin validation removes unsafe fallback comparison path
- Validation: setup wizard validates admin email format and DisplayName
- Validation: setup wizard validates invite email format (skips invalid with warning)

## v0.48.1 (May 2026)
- Security: rate limiting added to verify-email endpoint (was unprotected)
- Security: SSOCallback origin validation now accepts all valid CORS origins
- Fix: writeServiceError handles auth lock, unlink, and SSO-only error messages correctly
- Fix: UpdateProfile handler surfaces validation errors instead of generic 500
- Validation: admin UpdateUser now validates DisplayName via auth.ValidateDisplayName
- Audit: added severity/category entries for admin.auth_migrated, admin.auth_method_lock_changed, user.login_session_conflict

## v0.48.0 (May 2026)
- Security: fix timing attack in Login — dummy bcrypt comparison on user-not-found path
- Security: fix DeleteAccount bypass for SSO-only users (now requires re-auth)
- Security: SetAuthMethodLock validates user has required credentials before locking
- Security: Refresh token rotation now carries forward SSOProviderName
- Security: UnlinkSSOIdentity checks AuthMethodLock before allowing unlink
- Fix: createAndProvisionFromMappings wrapped in transaction for atomicity
- Fix: SSOLogin email domain validation uses net/mail.ParseAddress consistently
- Config: configurable bcrypt cost via password_policy.bcrypt_cost
- Config: configurable email verification TTL via email_verification.ttl
- Validation: DisplayName required and capped at 200 characters
- Audit: MigrateToSSO and MigrateToPassword now log auth method changes
- Tracking: LastLoginAt updated on successful Login and SSOLogin
- Refactor: extracted shared enforceSessionLimit, extractEmailDomain, isDomainAllowed helpers

## v0.47.0 (May 2026)
- SSO session conflict dialog: SSO login now shows the same interactive session picker as password login when limit is reached
- SSO callback redirects to login page with pending token instead of silently auto-revoking
- New GET /auth/login/pending-sessions endpoint for fetching session list from pending token
- PendingLoginStore.Peek() for non-consuming token reads (SSO redirect flow)
- ua-parser-js integration: accurate browser, OS, and device type detection in session displays
- Device-type icons (desktop/mobile/tablet) in SessionConflictDialog and Sessions page
- Falls back to auto-revoke if Redis unavailable during SSO conflict detection

## v0.46.0 (April 2026)
- Session conflict resolution: interactive dialog when login hits session limit
- Two-phase login flow: 409 Conflict with pending token + active sessions list
- User picks which session to revoke via dialog, or cancels to keep all sessions
- POST /auth/login/resolve endpoint to complete login after user's choice
- PendingLoginStore: Redis-backed, single-use tokens with 5-min TTL
- SSO login retains auto-revoke behavior unchanged
- Race condition handling with fresh pending tokens on concurrent logins
- Frontend SessionConflictDialog with device info, IP, last active time
- Docs: removed outdated BUILDPLAN.md, TODO.md, web/README.md
- Docs: synced MDX docs with session limits config and conflict resolution API
- Fix: revocation cache now marked on all session revocation paths (user, admin, bulk)
- Fix: Redis fallback in Login() — auto-revokes oldest session when Redis is unavailable
- Fix: OpenAPI spec updated with /auth/login/resolve endpoint and 409 schemas

## v0.45.0 (April 2026)
- Session limits: configurable max active sessions per user (platform default + per-user override)
- Migration 000042: nullable max_sessions column on users table
- Admin platform settings: max_sessions_per_user (1-100, default 5)
- Admin user management: per-user session limit override
- Best-effort enforcement: oldest sessions auto-revoked on login when limit exceeded
- Immediate session invalidation: Redis-based revocation cache rejects old access tokens instantly
- Frontend: Session Limits section in Platform Settings, Session Limit field in User Detail Dialog
- Fix: LoadFromDB now restores all platform settings (max_sessions_per_user, inbox TTLs, quotas) from DB on restart

## v0.24.x (April 2026)
- Domains page: 6 UI enhancements (bulk actions, sort/filter, DNS copy, health indicator)
- Infrastructure: graceful shutdown, SMTP DATA timeout, chart gap filling
- RBAC page guards on admin-only pages
- Role-appropriate dashboard for members vs admins
- Persistent notifications with DB storage (migration 027-028)
- Real-time email notifications via Redis pub/sub bridge
- Single-org enforcement (4-layer protection)
- Premium auth pages (two-column layout, password strength, confirm password)
- Timezone/date-format user preferences (migration 026)

## v0.21.x-v0.22.x (April 2026)
- Neutral slate theme with orange accents
- Design system alignment (typography, shadows, transitions)
- All audit records enriched with metadata (35 actions)
- API key scope enforcement
- Analytics: top sender domains, UUID validation, error propagation

## v0.18.x-v0.20.x (April 2026)
- Full CRUD for Roles & Permissions
- Comprehensive audit logging (12 new actions)
- Auth page header/footer
- Setup TOCTOU race condition fix
- Unified UI elements across all pages
- Domain detail two-column layout
- All-time inbox counter per domain (migration 025)

## v0.9.8-v0.17.x (April 2026)
- Routing & auth fixes (redirect loops, invite acceptance)
- Security hardening (15 fixes: SSO, SSRF, bcrypt, rate limiting)
- Admin users management
- Dynamic RBAC with permissions tables (migration 024)
- AES-256-GCM encryption for sensitive config
- Enhanced notification center and command palette
- MDX documentation sync

## v0.1.0-v0.9.7 (Feb-Mar 2026)
- Initial platform: Go backend (chi, pgx, Redis)
- Next.js 16 frontend with shadcn/ui
- SMTP inbound server
- Domain management with DNS verification
- Team-based organization with RBAC
- Webhook system with retry
- API key authentication
- Real-time WebSocket inbox updates
