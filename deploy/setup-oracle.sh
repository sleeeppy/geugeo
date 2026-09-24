#!/usr/bin/env bash
# Oracle Ubuntu 24.04 에 그거를 설치한다. root로 실행하고, 여러 번 실행해도 된다.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "root로 실행하세요. 예: sudo bash deploy/setup-oracle.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
apt-get install -y unattended-upgrades ufw fail2ban curl ca-certificates gnupg build-essential git

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! id geugeo >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/geugeo --shell /usr/sbin/nologin geugeo
fi
install -d -o geugeo -g geugeo -m 700 /var/lib/geugeo
install -d -o root -g root -m 755 /etc/geugeo

if [[ ! -f /etc/geugeo/master-key ]]; then
  openssl rand -base64 32 > /etc/geugeo/master-key
  chmod 600 /etc/geugeo/master-key
  echo "마스터 키를 비밀번호 관리자에 따로 보관하세요: /etc/geugeo/master-key"
  echo "이 파일을 잃으면 모아 둔 대화를 복구할 수 없어요."
fi

if [[ ! -f /etc/geugeo/geugeo.env ]]; then
  cat > /etc/geugeo/geugeo.env <<'EOF'
DISCORD_BOT_TOKEN=
DISCORD_APP_ID=
ALLOWED_USER_IDS=
DATA_DIR=/var/lib/geugeo
AI_ENABLED=true
SYNC_INTERVAL_MIN=30
USER_API_DELAY_MS=1200
LOG_LEVEL=info
EOF
  chmod 600 /etc/geugeo/geugeo.env
fi

if [[ ! -f /opt/geugeo/package.json ]]; then
  echo "/opt/geugeo 에 이 저장소를 둔 다음 다시 실행하세요."
  exit 1
fi

if ! grep -q '^DISCORD_BOT_TOKEN=.\+' /etc/geugeo/geugeo.env || ! grep -q '^DISCORD_APP_ID=.\+' /etc/geugeo/geugeo.env || ! grep -q '^ALLOWED_USER_IDS=.\+' /etc/geugeo/geugeo.env; then
  echo "먼저 /etc/geugeo/geugeo.env 에 봇 토큰, 앱 ID, 허용 사용자 ID를 채우세요."
  exit 1
fi

cd /opt/geugeo
npm ci
npm run build
set -a
# shellcheck disable=SC1091
source /etc/geugeo/geugeo.env
set +a
npm run register

install -m 644 deploy/geugeo.service /etc/systemd/system/geugeo.service
systemctl daemon-reload
systemctl enable --now geugeo

ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw --force enable
systemctl enable --now fail2ban || true
systemctl enable --now unattended-upgrades || true

if grep -qE '^#?PasswordAuthentication' /etc/ssh/sshd_config; then
  sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  systemctl reload ssh || systemctl reload sshd || true
fi

echo "그거 서비스가 실행 중이에요. journalctl -u geugeo -f 로 로그를 볼 수 있어요."
