#!/usr/bin/env bash
# EmlakSoft'u bu sunucuda derleyip yayınlar (https://emlaksoft.com.tr).
# Kullanım: scripts/sunucu/deploy.sh            (çalışma ağacının mevcut hali)
# Sırlar: .env.production (600) — derlemeye BuildKit secret olarak, çalışmaya env_file olarak girer.
# DB'ye yeni migration uygulandıysa önce .env.production'daki RELEASE_MIGRATION(_CHECKSUM) güncellenir
# (`npm run check:migrations -- --release`), yoksa /api/health 503 döner.
# Geri dönüş: yeni sürüm 120 sn içinde sağlıklı olmazsa önceki imaj (PREV) yeniden ayağa kaldırılır
# ve betik exit 1 ile biter. ACL_GATE=strict → ACL denetimi başarısızsa yayın durur (varsayılan: uyarı).
# Sürüm geçmişi (DG5): yayın sonunda (yayında / geri dönüldü / başarısız) public.release_history'ye bir satır yazılır
# (/admin/sistem?sekme=durum). Tablo yoksa ya da yazım başarısızsa yalnız uyarı basılır; yayın sonucu değişmez.
# Yayından önce düşen çalışmalar (derleme, paket bütçesi, ACL strict…) EXIT tuzağıyla "failed" olarak yazılır.
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f .env.production ] || { echo ".env.production yok"; exit 1; }
SHA=$(git rev-parse --short HEAD)$(git diff --quiet && git diff --cached --quiet || echo "-dirty")
TAG=$(date -u +%Y%m%d%H%M)-$SHA
START_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
START_S=$(date +%s)
DB_CONTAINER=supabase-db-moqbebljyeyprktd19zb1ihn
# YENİ sürümün RELEASE_MIGRATION'ı: yeni konteyner oluşturulunca yapılandırmasından okunur (geri dönüşten sonra
# çalışan konteyner eski sürümdür; oradan okumak başarısız SHA'ya eski migration'ı yazardı). Erken çıkışta boş kalır.
NEW_MIG=""
RECORDED=0

# Sürüm satırı: sonuç (ok | rolled_back | failed) + isteğe bağlı ayrıntı. Değerler psql değişkeni olarak geçer (:'ad'
# tırnaklaması psql'de; SQL'e metin birleştirilmez). Asla betiği düşürmez.
record_release() {
  local outcome="$1" detail="${2:-}" has mig subject actor dur
  RECORDED=1
  has=$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atc "select pg_catalog.to_regclass('public.release_history') is not null" 2>/dev/null || echo f)
  if [ "$has" != "t" ]; then
    echo "[bilgi] release_history yok (migration 20261014005000 bekliyor); sürüm satırı yazılmadı"
    return 0
  fi
  mig="$NEW_MIG"
  subject=$(git log -1 --format=%s 2>/dev/null || true)
  actor="${SUDO_USER:-${USER:-root}}"
  dur=$(( $(date +%s) - START_S ))
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 \
    -v sha="${SHA:0:64}" -v tag="${TAG:0:120}" -v outcome="$outcome" -v started="$START_TS" -v dur="$dur" \
    -v mig="${mig:0:200}" -v subject="${subject:0:200}" -v actor="${actor:0:80}" -v host="$(hostname -s | cut -c1-80)" \
    -v detail="${detail:0:500}" <<'SQL' >/dev/null 2>&1 || echo "[uyari] sürüm satırı yazılamadı (yayın sonucu etkilenmedi)"
insert into public.release_history (sha, tag, outcome, started_at, duration_sec, release_migration, subject, actor, host, detail)
values (:'sha', :'tag', :'outcome', :'started'::timestamptz, :'dur'::integer, nullif(:'mig', ''), nullif(:'subject', ''),
        nullif(:'actor', ''), nullif(:'host', ''), nullif(:'detail', ''));
SQL
}

# Yayın öncesi düşen çalışma (set -e ya da açık exit 1) için tek satır; sonucu kaydedilmiş çalışmada no-op.
on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$RECORDED" = 0 ]; then
    record_release failed "yayından önce durdu (çıkış kodu $rc; derleme, paket bütçesi ya da ACL denetimi)" || true
  fi
  return "$rc"
}
trap on_exit EXIT

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
NEW_MIG=$(docker inspect emlaksoft-app --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
  | sed -n 's/^RELEASE_MIGRATION=//p' | head -n1 || true)
echo "Yayında: emlaksoft-app:$TAG — sağlık bekleniyor"
# Disk: son 3 sürüm imajı (+ latest/onceki ve yayındaki) kalır; eski derleme önbelleği temizlenir.
prune_images() {
  docker images emlaksoft-app --format '{{.Tag}}' | grep -E '^[0-9]{12}-' | sort -r | tail -n +4 \
    | while read -r t; do docker rmi "emlaksoft-app:$t" >/dev/null 2>&1 || true; done
  docker builder prune -f --reserved-space 5gb >/dev/null 2>&1 || docker builder prune -f --keep-storage 5gb >/dev/null 2>&1 || true
}

if wait_healthy; then
  record_release ok
  prune_images
  curl -s https://emlaksoft.com.tr/api/health; echo; exit 0
fi

echo "Uygulama 120 sn içinde açılmadı"; docker logs --tail 50 emlaksoft-app || true
if [ -z "$PREV" ] || [ "$PREV" = "emlaksoft-app:$TAG" ]; then
  echo "Geri dönülecek önceki imaj yok — elle müdahale gerekiyor"
  record_release failed "120 sn içinde sağlıklı olmadı; geri dönülecek önceki imaj yok"
  exit 1
fi
echo "Geri dönülüyor: $PREV"
APP_TAG="${PREV#emlaksoft-app:}" docker compose -f deploy/compose.prod.yml up -d --remove-orphans
if wait_healthy; then
  echo "Geri dönüş başarılı: $PREV yayında (yeni sürüm emlaksoft-app:$TAG yayınlanmadı)"
  record_release rolled_back "120 sn içinde sağlıklı olmadı; $PREV yeniden yayında"
else
  echo "Geri dönüş de sağlıklı değil: $PREV — elle müdahale gerekiyor"
  record_release failed "120 sn içinde sağlıklı olmadı; geri dönüş ($PREV) de sağlıklı değil"
fi
exit 1
