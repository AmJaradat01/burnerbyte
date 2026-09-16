# ── Build stage ──
FROM golang:1.26.8-alpine3.23 AS builder

RUN apk add --no-cache git

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Stamped into main.Version and surfaced by GET /api/v1/admin/version, the
# sidebar badge and Settings → System. .dockerignore excludes .git, so the build
# cannot run `git describe` itself; docker-compose and the Makefile pass it in.
# A bare `docker build` with no --build-arg reports "dev", which is accurate.
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -ldflags "-X main.Version=${VERSION}" -o /bin/api ./cmd/api
RUN CGO_ENABLED=0 go build -ldflags "-X main.Version=${VERSION}" -o /bin/smtpd ./cmd/smtpd

# ── API image ──
# No config.yaml is baked in: the binary boots fully from environment variables
# (every operational key has a registered default since v1.0.3), and config.yaml
# is gitignored/per-deployment, so copying it would break the build on a clean
# checkout. Mount one at /etc/burnerbyte/config.yaml to override via file instead.
FROM alpine:3.23 AS api
RUN apk add --no-cache ca-certificates tzdata && adduser -D -H appuser
COPY --from=builder /bin/api /usr/local/bin/api
COPY migrations /migrations
RUN mkdir -p /data/attachments && chown appuser:appuser /data/attachments
USER appuser
EXPOSE 8080
ENTRYPOINT ["api"]

# ── SMTP image ──
FROM alpine:3.23 AS smtpd
RUN apk add --no-cache ca-certificates tzdata && adduser -D -H appuser
COPY --from=builder /bin/smtpd /usr/local/bin/smtpd
# Same local-storage fallback as the api image: if MinIO is unreachable at boot
# the binary falls back to ./data/attachments, which must be writable by appuser.
RUN mkdir -p /data/attachments && chown appuser:appuser /data/attachments
USER appuser
EXPOSE 2525
ENTRYPOINT ["smtpd"]
