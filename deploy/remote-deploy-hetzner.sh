#!/bin/bash
# Remote deployment script — runs on the Hetzner VPS
# Usage: remote-deploy.sh <tag>
set -euo pipefail

TAG="${1:-unknown}"
APP_DIR="/opt/burnerbyte"
ENV_FILE="/etc/burnerbyte/.env"
ARCHIVE="/tmp/burnerbyte.tar.gz"

echo "=== Deploying BurnerByte ${TAG} ==="

# ── Backup current binaries ──
for svc in api smtpd; do
    [ -f "$APP_DIR/$svc" ] && cp "$APP_DIR/$svc" "$APP_DIR/$svc.prev" 2>/dev/null || true
done
[ -d "$APP_DIR/frontend" ] && cp -r "$APP_DIR/frontend" "$APP_DIR/frontend.prev" 2>/dev/null || true

# ── Extract ──
mkdir -p "$APP_DIR"
cd "$APP_DIR"
tar -xzf "$ARCHIVE"
[ -f "$APP_DIR/config.yaml" ] && cp "$APP_DIR/config.yaml" /etc/burnerbyte/config.yaml
chown -R burnerbyte:burnerbyte "$APP_DIR"
# api and smtpd need to be executable by root (systemd runs them as root)
chmod +x "$APP_DIR/api" "$APP_DIR/smtpd" 2>/dev/null || true

# ── Migrations ──
echo "Running migrations..."
DB_URL=$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)
if [ -n "$DB_URL" ]; then
    migrate -database "$DB_URL" -path "$APP_DIR/migrations" up || {
        echo "❌ Migration failed — rolling back"
        for svc in api smtpd; do
            [ -f "$APP_DIR/$svc.prev" ] && mv "$APP_DIR/$svc.prev" "$APP_DIR/$svc"
        done
        [ -d "$APP_DIR/frontend.prev" ] && rm -rf "$APP_DIR/frontend" && mv "$APP_DIR/frontend.prev" "$APP_DIR/frontend"
        systemctl start burnerbyte-api burnerbyte-smtpd burnerbyte-frontend
        exit 1
    }
fi

# ── Restart services ──
echo "Restarting services..."
systemctl restart burnerbyte-api
systemctl restart burnerbyte-smtpd
systemctl restart burnerbyte-frontend

# ── Health check ──
# Retry up to 5 times with 2-second intervals (total wait: 10s max).
HEALTH_OK=false
for i in 1 2 3 4 5; do
    sleep 2
    if curl -sf http://localhost:8080/healthz > /dev/null 2>&1; then
        HEALTH_OK=true
        break
    fi
done
if [ "$HEALTH_OK" = true ]; then
    echo "✅ API healthy"
else
    echo "❌ API health check failed — rolling back"
    systemctl stop burnerbyte-api burnerbyte-smtpd burnerbyte-frontend
    for svc in api smtpd; do
        [ -f "$APP_DIR/$svc.prev" ] && mv "$APP_DIR/$svc.prev" "$APP_DIR/$svc"
    done
    [ -d "$APP_DIR/frontend.prev" ] && rm -rf "$APP_DIR/frontend" && mv "$APP_DIR/frontend.prev" "$APP_DIR/frontend"
    systemctl start burnerbyte-api burnerbyte-smtpd burnerbyte-frontend
    exit 1
fi

# ── Cleanup ──
rm -f "$ARCHIVE" /tmp/burnerbyte-deploy.sh
for svc in api smtpd; do rm -f "$APP_DIR/$svc.prev"; done
rm -rf "$APP_DIR/frontend.prev"

echo "✅ BurnerByte ${TAG} deployed successfully"
