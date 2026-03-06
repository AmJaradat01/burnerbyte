#!/bin/bash
# One-time VPS setup for BurnerByte
# Run as root on a fresh Debian/Ubuntu VPS
set -euo pipefail

echo "=== BurnerByte VPS Setup ==="

# ── System user ──
useradd -r -s /bin/false -d /opt/burnerbyte burnerbyte 2>/dev/null || true
mkdir -p /opt/burnerbyte /etc/burnerbyte

# ── PostgreSQL 16 ──
apt-get update
apt-get install -y curl gnupg2 lsb-release
echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/pgdg.gpg
apt-get update
apt-get install -y postgresql-16
sudo -u postgres psql -c "CREATE USER burnerbyte WITH PASSWORD 'CHANGE_ME';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE burnerbyte OWNER burnerbyte;" 2>/dev/null || true

# ── Redis 7 ──
apt-get install -y redis-server
systemctl enable redis-server

# ── Node.js 22 (for frontend) ──
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# ── golang-migrate ──
curl -L https://github.com/golang-migrate/migrate/releases/download/v4.18.3/migrate.linux-amd64.tar.gz | tar xz -C /usr/local/bin

# ── Infisical CLI ──
curl -1sLf 'https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.deb.sh' | bash
apt-get install -y infisical

# ── Infisical env placeholder ──
cat > /etc/burnerbyte/infisical.env << 'EOF'
INFISICAL_UNIVERSAL_AUTH_CLIENT_ID=CHANGE_ME
INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET=CHANGE_ME
INFISICAL_PROJECT_ID=CHANGE_ME
INFISICAL_URL=https://app.infisical.com
EOF
chmod 600 /etc/burnerbyte/infisical.env

# ── Infisical wrapper ──
cat > /etc/burnerbyte/infisical-wrapper.sh << 'WRAPPER'
#!/bin/bash
set -e
source /etc/burnerbyte/infisical.env
TOKEN=$(curl -sf --request POST \
    --url "${INFISICAL_URL}/api/v1/auth/universal-auth/login" \
    --header "Content-Type: application/x-www-form-urlencoded" \
    --data "clientId=${INFISICAL_UNIVERSAL_AUTH_CLIENT_ID}&clientSecret=${INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["accessToken"])')
exec infisical run --token="$TOKEN" --domain="$INFISICAL_URL" --env=prod --projectId="$INFISICAL_PROJECT_ID" -- "$@"
WRAPPER
chmod +x /etc/burnerbyte/infisical-wrapper.sh

# ── Systemd services ──
cat > /etc/systemd/system/burnerbyte-api.service << 'EOF'
[Unit]
Description=BurnerByte API
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/burnerbyte
ExecStart=/etc/burnerbyte/infisical-wrapper.sh /opt/burnerbyte/api
Restart=always
RestartSec=5
LimitNOFILE=65535
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/burnerbyte-smtpd.service << 'EOF'
[Unit]
Description=BurnerByte SMTP Server
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/burnerbyte
ExecStart=/etc/burnerbyte/infisical-wrapper.sh /opt/burnerbyte/smtpd
Restart=always
RestartSec=5
LimitNOFILE=65535
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/burnerbyte-frontend.service << 'EOF'
[Unit]
Description=BurnerByte Frontend
After=network.target burnerbyte-api.service

[Service]
Type=simple
User=burnerbyte
WorkingDirectory=/opt/burnerbyte/frontend
ExecStart=/usr/bin/node /opt/burnerbyte/frontend/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable burnerbyte-api burnerbyte-smtpd burnerbyte-frontend

# ── Firewall ──
apt-get install -y ufw
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (Caddy/nginx)
ufw allow 443/tcp   # HTTPS
ufw allow 25/tcp    # SMTP inbound
ufw --force enable

# ── Caddy reverse proxy ──
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

cat > /etc/caddy/Caddyfile << 'EOF'
burnerbyte.com {
    handle /api/* {
        reverse_proxy localhost:8080
    }
    handle /ws/* {
        reverse_proxy localhost:8080
    }
    handle {
        reverse_proxy localhost:3000
    }
}
EOF

systemctl enable caddy
systemctl restart caddy

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Create Infisical project and update /etc/burnerbyte/infisical.env"
echo "  2. Add these secrets to Infisical (prod environment):"
echo "     DATABASE_URL, REDIS_URL, JWT_SECRET, BB_SMTP_HOSTNAME,"
echo "     BB_SMTP_LISTEN, FRONTEND_URL, BB_CORS_ALLOWED_ORIGINS,"
echo "     BB_MAILER_HOST, BB_MAILER_PORT, BB_MAILER_USERNAME,"
echo "     BB_MAILER_PASSWORD, BB_MAILER_FROM"
echo "  3. Point DNS: burnerbyte.com A → this server's IP"
echo "  4. Point DNS: mail.burnerbyte.com A → this server's IP"
echo "  5. Add Jenkins credentials and run first deploy"
echo ""
