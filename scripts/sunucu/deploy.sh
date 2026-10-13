#!/usr/bin/env bash
# EmlakSoft'u bu sunucuda derleyip yayınlar (https://emlaksoft.com.tr).
# Kullanım: scripts/sunucu/deploy.sh            (çalışma ağacının mevcut hali)
# Sırlar: .env.production (600) — derlemeye BuildKit secret olarak, çalışmaya env_file olarak girer.
# DB'ye yeni migration uygulandıysa önce .env.production'daki RELEASE_MIGRATION(_CHECKSUM) güncellenir
# (`npm run check:migrations -- --release`), yoksa /api/health 503 döner.
# Geri dönüş: yeni sürüm 120 sn içinde sağlıklı olmazsa önceki imaj (PREV) yeniden ayağa kaldırılır
# ve betik exit 1 ile biter. ACL_GATE=strict → ACL denetimi başarısızsa yayın durur (varsayılan: uyarı).
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f .env.production ] || { echo ".env.production yok"; exit 1; }
SHA=$(git rev-parse --short HEAD)$(git diff --quiet && git diff --cached --quiet || echo "-dirty")
TAG=$(date -u +%Y%m%d%H%M)-$SHA

# Geri dönüş için yayındaki imaj (ilk kurulumda boş). Derleme `latest` etiketini yeni imaja taşıdığından
# yayındaki imaj `latest` ise kimliği önce sabit bir etikete bağlanır.
PREV=$(docker inspect emlaksoft-app --format '{{.Config.Image}}' 2>/dev/null || true)
if [ "$PREV" = "emlaksoft-app:latest" ] || [ "$PREV" = "emlaksoft-app" ]; then
  PREV_ID=$(docker inspect emlaksoft-app --format '{{.Image}}' 2>/dev/null || true)
  if [ -n "$PREV_ID" ] && docker tag "$PREV_ID" emlaksoft-app:onceki; then
    PREV=emlaksoft-app:onceki
  else
    PREV=""
  fi
fi

DOCKER_BUILDKIT=1 docker build --secret id=appenv,src=.env.production \
  --build-arg RELEASE_SHA="$SHA" -t "emlaksoft-app:$TAG" -t emlaksoft-app:latest .

# Statik dosyalar (/_next/static) yayınlar arasında KORUNUR: yayın anında açık sekmeler eski parça adlarını ister;
# yalnız yeni imajın dosyaları sunulursa "Failed to load chunk" (ChunkLoadError) olur. Yayındaki ve yeni imajın
# dosyaları kalıcı klasörde birleşir; konteyner bu klasörü salt-okunur bağlar (deploy/compose.prod.yml). 14 gün tutulur.
STATIC_DIR=/srv/emlaksoft/next-static
mkdir -p "$STATIC_DIR"
docker cp emlaksoft-app:/app/.next/static/. "$STATIC_DIR/" 2>/dev/null || true
CID=$(docker create "emlaksoft-app:$TAG")
docker cp "$CID:/app/.next/static/." "$STATIC_DIR/"
# Paket bütçesi YENİ İMAJIN derlemesinde ölçülür (ana makinedeki .next eski/eksik olabilir). Aşımda yayın durur;
# bilinçli geçiş için BUNDLE_GATE=warn.
BUDGET_DIR=$(mktemp -d)
docker cp "$CID:/app/.next" "$BUDGET_DIR/"
docker rm "$CID" >/dev/null
find "$STATIC_DIR" -type f -mtime +14 -delete
find "$STATIC_DIR" -mindepth 1 -type d -empty -delete
# Yetim .br/.gz kopyaları (asıl dosyası budanmış) silinir, yeni dosyalar önceden sıkıştırılır (static servisi sunar).
find "$STATIC_DIR" -type f \( -name '*.br' -o -name '*.gz' \) | while read -r z; do [ -e "${z%.*}" ] || rm -f "$z"; done
node scripts/sunucu/precompress-static.mjs "$STATIC_DIR"
chown -R 1001:1001 "$STATIC_DIR"

if ! npx tsx scripts/check-bundle-budget.ts --gate --next-dir="$BUDGET_DIR/.next"; then
  rm -rf "$BUDGET_DIR"
  if [ "${BUNDLE_GATE:-}" = "warn" ]; then echo "[uyari] paket bütçesi aşıldı (BUNDLE_GATE=warn, yayına devam)"
  else echo "Paket bütçesi aşıldı — yayın durduruldu (bilinçli geçiş: BUNDLE_GATE=warn)"; exit 1; fi
fi
rm -rf "$BUDGET_DIR"

# Migration'lar yayından önce elle uygulanır (RELEASE_MIGRATION yukarıda). Ardından ACL farkı denetlenir;
# yalnız ACL_GATE=strict iken başarısızlık yayını durdurur.
if ! npm run --if-present check:acl -- --warn; then
  if [ "${ACL_GATE:-}" = "strict" ]; then
    echo "ACL denetimi başarısız (ACL_GATE=strict) — yayın durduruldu"; exit 1
  fi
  echo "[uyari] ACL denetimi başarısız (ACL_GATE=strict değil, devam ediliyor)"
fi

# Sağlık: önce konteyner içinden (Traefik'ten bağımsız), sonra dış adresten 200 beklenir.
# Traefik yeni konteyneri görene kadar dış adres 502/503 verebilir. Toplam süre 120 sn.
wait_healthy() {
  local i
  for i in $(seq 1 60); do
    if docker exec emlaksoft-app node -e \
      "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" \
      >/dev/null 2>&1 \
      && curl -fsS -o /dev/null https://emlaksoft.com.tr/api/health 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

APP_TAG="$TAG" docker compose -f deploy/compose.prod.yml up -d --remove-orphans
echo "Yayında: emlaksoft-app:$TAG — sağlık bekleniyor"
# Disk: son 3 sürüm imajı (+ latest/onceki ve yayındaki) kalır; eski derleme önbelleği temizlenir.
prune_images() {
  docker images emlaksoft-app --format '{{.Tag}}' | grep -E '^[0-9]{12}-' | sort -r | tail -n +4 \
    | while read -r t; do docker rmi "emlaksoft-app:$t" >/dev/null 2>&1 || true; done
  docker builder prune -f --reserved-space 5gb >/dev/null 2>&1 || docker builder prune -f --keep-storage 5gb >/dev/null 2>&1 || true
}

if wait_healthy; then
  prune_images
  curl -s https://emlaksoft.com.tr/api/health; echo; exit 0
fi

echo "Uygulama 120 sn içinde açılmadı"; docker logs --tail 50 emlaksoft-app || true
if [ -z "$PREV" ] || [ "$PREV" = "emlaksoft-app:$TAG" ]; then
  echo "Geri dönülecek önceki imaj yok — elle müdahale gerekiyor"; exit 1
fi
echo "Geri dönülüyor: $PREV"
APP_TAG="${PREV#emlaksoft-app:}" docker compose -f deploy/compose.prod.yml up -d --remove-orphans
if wait_healthy; then
  echo "Geri dönüş başarılı: $PREV yayında (yeni sürüm emlaksoft-app:$TAG yayınlanmadı)"
else
  echo "Geri dönüş de sağlıklı değil: $PREV — elle müdahale gerekiyor"
fi
exit 1
