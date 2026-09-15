# Security Policy

## Supported versions

Security fixes land on the latest release. If you are running an older tag,
upgrade before reporting — the issue may already be fixed.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting:

1. Go to the **Security** tab on the repository.
2. Choose **Report a vulnerability**.

That opens a private advisory visible only to you and the maintainer. If the tab
is not available to you, open a normal issue saying only that you have a
security report — with no detail — and you will be invited to a private
advisory.

Include as much of the following as you can:

- What the issue is and which component is affected (`cmd/api`, `cmd/smtpd`,
  the frontend, a migration, the Docker setup).
- The version or commit you tested against.
- Steps to reproduce, ideally a minimal request sequence or script.
- What an attacker gains — data read, privilege escalated, availability lost.

You can expect an acknowledgement within a few days and a status update as the
fix progresses. Please give us a reasonable window to ship a fix before
disclosing publicly.

## Scope

In scope: authentication and session handling, the RBAC permission model,
tenant isolation between organizations and teams, inbox access control, SMTP
ingest handling, webhook signing, API key scoping, encryption of stored
secrets, and injection or traversal issues anywhere in the codebase.

Out of scope: findings that require a misconfigured deployment the project
documents against — notably running with the default `JWT_SECRET`, an unset
`ENCRYPTION_KEY`, an exposed `/metrics` endpoint, or infrastructure ports
published to a public interface. Those defaults exist for local development and
are called out in the README and `docker-compose.yml`.

## Hardening a deployment

Before exposing BurnerByte to a network:

- Set `JWT_SECRET` to at least 32 random bytes (`openssl rand -hex 32`).
- Set `ENCRYPTION_KEY`; without it, SSO client secrets and SMTP and storage
  credentials are stored unencrypted in the database.
- Change the default Postgres, Redis and MinIO credentials.
- Use `sslmode=require` or `verify-full` in `DATABASE_URL`.
- Terminate TLS in front of the API and frontend, and set `CORS_ALLOWED_ORIGINS`
  to your real origins.
- Keep Postgres, Redis and MinIO off public interfaces. The base
  `docker-compose.yml` already publishes no host ports for them.

`web/content/docs/self-hosting/production.mdx` covers this in more detail.
