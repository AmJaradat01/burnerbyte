#!/bin/bash
# Remote deployment script — runs on the VPS
# Usage: remote-deploy.sh <tag>
set -euo pipefail

TAG="${1:-unknown}"
APP_DIR="/opt/burnerbyte"
CONF_DIR="/etc/burnerbyte"
ARCHIVE="/tmp/burnerbyte.tar.gz"

echo "=== Deploying BurnerByte ${TAG} ==="

# ── Backup current binaries ──
for svc in api smtpd; do
    [ -f "$APP_DIR/$svc" ] && cp "$APP_DIR/$svc" "$APP_DIR/$svc.prev" 2>/dev/null || true
done
[ -d "$APP_DIR/frontend" ] && cp -r "$APP_DIR/frontend" "$APP_DIR/frontend.prev" 2>/dev/null || true

# ── Extract ──
mkdir -p "$APP_DIR" "$CONF_DIR"
cd "$APP_DIR"
tar -xzf "$ARCHIVE"
chown -R burnerbyte:burnerbyte "$APP_DIR"

# ── Migrations ──
echo "Running migrations..."
source "$CONF_DIR/infisical.env"
TOKEN=$(curl -sf --request POST \
    --url "${INFISICAL_URL}/api/v1/auth/universal-auth/login" \
    --header "Content-Type: application/x-www-form-urlencoded" \
    --data "clientId=${INFISICAL_UNIVERSAL_AUTH_CLIENT_ID}&clientSecret=${INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["accessToken"])')

DB_URL=$(infisical export \
    --token="$TOKEN" \
    --domain="$INFISICAL_URL" \
    --env=prod \
    --projectId="$INFISICAL_PROJECT_ID" \
    --format=dotenv 2>/dev/null | grep DATABASE_URL | cut -d= -f2-)

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
