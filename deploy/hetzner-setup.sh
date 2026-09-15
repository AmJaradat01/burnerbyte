#!/bin/bash
# One-time Hetzner VPS setup for BurnerByte
# Run as root on the fresh Debian 13 server
set -euo pipefail

echo "=== BurnerByte Hetzner Setup ==="

# ── Fix locale ──
apt-get update
apt-get install -y locales
sed -i 's/# en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen
locale-gen
update-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

# ── System user ──
useradd -r -s /bin/false -d /opt/burnerbyte burnerbyte 2>/dev/null || true
mkdir -p /opt/burnerbyte /etc/burnerbyte

# ── PostgreSQL 16 ──
apt-get install -y curl gnupg2 lsb-release
echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --batch --dearmor -o /etc/apt/trusted.gpg.d/pgdg.gpg
apt-get update
apt-get install -y postgresql-16

# Generate a random DB password
DB_PASS=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 32)
sudo -u postgres psql -c "CREATE USER burnerbyte WITH PASSWORD '${DB_PASS}';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE burnerbyte OWNER burnerbyte;" 2>/dev/null || true
echo "DB_PASS=${DB_PASS}" > /root/.burnerbyte-db-creds
chmod 600 /root/.burnerbyte-db-creds
echo "✅ PostgreSQL ready (password saved to /root/.burnerbyte-db-creds)"

# ── Redis 7 ──
apt-get install -y redis-server
systemctl enable redis-server

# ── Node.js 22 (for frontend) ──
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# ── golang-migrate ──
curl -L https://github.com/golang-migrate/migrate/releases/download/v4.18.3/migrate.linux-amd64.tar.gz | tar xz -C /usr/local/bin

# ── Production .env file ──
JWT_SECRET=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 64)
cat > /etc/burnerbyte/.env << EOF
# ── Database ──
DATABASE_URL=postgres://burnerbyte:${DB_PASS}@localhost:5432/burnerbyte?sslmode=disable

# ── Redis ──
REDIS_URL=redis://localhost:6379/0

# ── JWT ──
JWT_SECRET=${JWT_SECRET}
BB_JWT_ACCESS_TTL=15m
BB_JWT_REFRESH_TTL=168h

# ── Server ──
API_PORT=8080
API_BASE_URL=https://burnerbyte.com
FRONTEND_URL=https://burnerbyte.com
BB_SERVER_READ_TIMEOUT=30s
BB_SERVER_WRITE_TIMEOUT=30s

# ── CORS ──
BB_CORS_ALLOWED_ORIGINS=https://burnerbyte.com

# ── SMTP Inbound ──
BB_SMTP_LISTEN=0.0.0.0:25
BB_SMTP_HOSTNAME=mail.burnerbyte.com
BB_SMTP_MAX_SIZE=26214400
BB_SMTP_QUEUE_SIZE=1000
BB_SMTP_WORKERS=4

# ── Mailer (outbound — configure when ready) ──
BB_MAILER_HOST=
BB_MAILER_PORT=587
BB_MAILER_USERNAME=
BB_MAILER_PASSWORD=
BB_MAILER_FROM=noreply@burnerbyte.com
BB_MAILER_TLS=true

# ── Rate Limiting ──
BB_RATE_LIMIT_ENABLED=true
BB_RATE_LIMIT_AUTHENTICATED=300
BB_RATE_LIMIT_UNAUTHENTICATED=60
BB_RATE_LIMIT_LOGIN=10
BB_RATE_LIMIT_FORGOT_PASSWORD=3

# ── Logging ──
LOG_LEVEL=info
LOG_FORMAT=json

# ── Attachments disabled for now ──
BB_DEFAULTS_ATTACHMENTS_ENABLED=false
EOF
chmod 600 /etc/burnerbyte/.env
echo "✅ .env created at /etc/burnerbyte/.env"

# ── Systemd services ──
cat > /etc/systemd/system/burnerbyte-api.service << 'EOF'
[Unit]
Description=BurnerByte API
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
User=burnerbyte
WorkingDirectory=/opt/burnerbyte
EnvironmentFile=/etc/burnerbyte/.env
ExecStart=/opt/burnerbyte/api
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/burnerbyte-smtpd.service << 'EOF'
[Unit]
Description=BurnerByte SMTP Server
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
User=burnerbyte
WorkingDirectory=/opt/burnerbyte
EnvironmentFile=/etc/burnerbyte/.env
ExecStart=/opt/burnerbyte/smtpd
Restart=always
RestartSec=5
LimitNOFILE=65535

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
Environment=HOSTNAME=0.0.0.0
Environment=NEXT_PUBLIC_API_URL=https://burnerbyte.com/api/v1
Environment=NEXT_PUBLIC_WS_URL=wss://burnerbyte.com/api/v1/ws

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable burnerbyte-api burnerbyte-smtpd burnerbyte-frontend

# ── Firewall ──
apt-get install -y ufw
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 25/tcp
ufw --force enable

# ── Caddy ──
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
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
    handle /healthz {
        reverse_proxy localhost:8080
    }
    handle /readyz {
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
echo "=== ✅ Setup complete ==="
echo ""
echo "DB password saved to: /root/.burnerbyte-db-creds"
echo "Env file: /etc/burnerbyte/.env"
echo ""
# Read the addresses off the host rather than hardcoding them, so the printed
# instructions are correct on whatever server this actually runs on.
PUBLIC_IPV4="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
PUBLIC_IPV6="$(ip -6 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
: "${PUBLIC_IPV4:=<this-server-ipv4>}"
: "${PUBLIC_IPV6:=<this-server-ipv6>}"
: "${APP_DOMAIN:=example.com}"

echo "Next steps:"
echo "  1. Point DNS: $APP_DOMAIN A → $PUBLIC_IPV4"
echo "  2. Point DNS: $APP_DOMAIN AAAA → $PUBLIC_IPV6"
echo "  3. Point DNS: mail.$APP_DOMAIN A → $PUBLIC_IPV4"
echo "  4. Add MX record for your domains → mail.$APP_DOMAIN"
echo "  5. Add the deploy SSH key to /root/.ssh/authorized_keys"
echo "  6. Point your CI deploy-host credential at $PUBLIC_IPV4"
echo "  7. Tag a release and trigger Jenkins pipeline"
