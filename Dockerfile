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
FROM alpine:3.20 AS api
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /bin/api /usr/local/bin/api
COPY config.yaml /etc/burnerbyte/config.yaml
COPY migrations /migrations
EXPOSE 8080
ENTRYPOINT ["api"]

# ── SMTP image ──
FROM alpine:3.20 AS smtpd
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /bin/smtpd /usr/local/bin/smtpd
COPY config.yaml /etc/burnerbyte/config.yaml
EXPOSE 2525
ENTRYPOINT ["smtpd"]
