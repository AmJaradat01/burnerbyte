# ── Build stage ──
FROM golang:1.25-alpine3.23 AS builder

RUN apk add --no-cache git

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o /bin/api ./cmd/api
RUN CGO_ENABLED=0 go build -o /bin/smtpd ./cmd/smtpd

# ── API image ──
# No config.yaml is baked in: the binary boots fully from environment variables
# (every operational key has a registered default since v1.0.3), and config.yaml
# is gitignored/per-deployment, so copying it would break the build on a clean
# checkout. Mount one at /etc/burnerbyte/config.yaml to override via file instead.
FROM alpine:3.20 AS api
RUN apk add --no-cache ca-certificates tzdata && adduser -D -H appuser
COPY --from=builder /bin/api /usr/local/bin/api
COPY migrations /migrations
RUN mkdir -p /data/attachments && chown appuser:appuser /data/attachments
USER appuser
EXPOSE 8080
ENTRYPOINT ["api"]

# ── SMTP image ──
FROM alpine:3.20 AS smtpd
RUN apk add --no-cache ca-certificates tzdata && adduser -D -H appuser
COPY --from=builder /bin/smtpd /usr/local/bin/smtpd
USER appuser
EXPOSE 2525
ENTRYPOINT ["smtpd"]
