#!/usr/bin/env bash
# EmlakSoft'u bu sunucuda derleyip yayınlar (https://emlaksoft.com.tr).
# Kullanım: scripts/sunucu/deploy.sh            (çalışma ağacının mevcut hali)
# Sırlar: .env.production (600) — derlemeye BuildKit secret olarak, çalışmaya env_file olarak girer.
# DB'ye yeni migration uygulandıysa önce .env.production'daki RELEASE_MIGRATION(_CHECKSUM) güncellenir
# (`npm run check:migrations -- --release`), yoksa /api/health 503 döner.
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f .env.production ] || { echo ".env.production yok"; exit 1; }
SHA=$(git rev-parse --short HEAD)$(git diff --quiet && git diff --cached --quiet || echo "-dirty")
TAG=$(date -u +%Y%m%d%H%M)-$SHA

DOCKER_BUILDKIT=1 docker build --secret id=appenv,src=.env.production \
  --build-arg RELEASE_SHA="$SHA" -t "emlaksoft-app:$TAG" -t emlaksoft-app:latest .

APP_TAG="$TAG" docker compose -f deploy/compose.prod.yml up -d --remove-orphans
echo "Yayında: emlaksoft-app:$TAG — sağlık bekleniyor"
for i in $(seq 1 60); do
  if docker exec emlaksoft-app curl -fsS -o /dev/null http://127.0.0.1:3000/robots.txt 2>/dev/null; then
    curl -s https://emlaksoft.com.tr/api/health || true; echo; exit 0
  fi
  sleep 2
done
echo "Uygulama 120 sn içinde açılmadı"; docker logs --tail 50 emlaksoft-app; exit 1
