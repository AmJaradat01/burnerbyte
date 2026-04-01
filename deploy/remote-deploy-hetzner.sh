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
sleep 3
if curl -sf http://localhost:8080/healthz > /dev/null; then
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
