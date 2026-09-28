#!/usr/bin/env bash
# main 을 서버에 반영한다. root로 실행하고, 여러 번 실행해도 된다.
# 모아 둔 대화, 마스터 키, geugeo.env 는 바꾸지 않는다.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "root로 실행하세요. 예: sudo bash deploy/update.sh"
  exit 1
fi

if [[ ! -d /opt/geugeo/.git ]]; then
  echo "/opt/geugeo 에 저장소가 없어요."
  exit 1
fi

if [[ ! -f /etc/geugeo/geugeo.env || ! -f /etc/geugeo/master-key ]]; then
  echo "/etc/geugeo/geugeo.env 와 마스터 키가 있어야 배포할 수 있어요."
  exit 1
fi

cd /opt/geugeo
git config --global --get-all safe.directory | grep -qx /opt/geugeo || git config --global --add safe.directory /opt/geugeo
git fetch origin main
git checkout -f main
git reset --hard origin/main

npm ci
npm run build

set -a
# shellcheck disable=SC1091
source /etc/geugeo/geugeo.env
set +a
export MASTER_KEY_FILE=/etc/geugeo/master-key
npm run register

install -m 644 deploy/geugeo.service /etc/systemd/system/geugeo.service
systemctl daemon-reload
systemctl restart geugeo
systemctl is-active --quiet geugeo

echo "배포됐어요. $(git rev-parse --short HEAD)"
