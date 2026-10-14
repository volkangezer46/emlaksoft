#!/usr/bin/env bash
# Elle geri dönüş (KQ4): yayındaki sürümden bir önceki SAĞLAM ("ok") sürümün imajına döner.
#
# Kullanım:  bash scripts/sunucu/rollback.sh --dry-run        → hedef imajı ve çalıştırılacak komutu yazar, hiçbir şey yapmaz
#            bash scripts/sunucu/rollback.sh                  → bir önceki ok sürüme döner
#            bash scripts/sunucu/rollback.sh 202610141107-62e14a2e   → belirtilen sürüme döner (imajı yerelde olmalı)
#
# Adımlar: (1) yayındaki sürüm konteynerden okunur; (2) hedef = public.release_history'de yayındakinden ÖNCE "ok" biten,
# sonradan geri alınmamış ("rolled_back") en yeni sürüm; (3) hedef imajın yerelde varlığı doğrulanır (deploy.sh'in
# prune_images'ı son iki ok sürümü korur); (4) hedef imajın statik parçaları kalıcı klasöre eklenir (14 gün budaması
# eski parçaları silmiş olabilir); (5) `docker compose up`; (6) sağlık 120 sn beklenir (konteyner içi + dış adres);
# (7) release_history'ye geri alınan sürüm için "rolled_back" satırı yazılır. Hedef sağlıklı olmazsa önceki imaja
# geri çıkılır ve "failed" yazılır; betik 1 ile biter.
#
# ŞEMA UYUMU: migration'lar forward-only'dir; geri dönüş DB'yi geri ALMAZ. Hedef kod mevcut (daha yeni) şemayla
# çalışmalıdır (eklemeli migration'lar uyumludur). .env.production RELEASE_MIGRATION'ı değişmez: DB zaten o
# migration'dadır, /api/health hazır döner. Ayrıntı: docs/runbooks/GERI_DONUS.md.
# Ortam (yalnız test): ROLLBACK_HEALTH_URL (dış sağlık adresi), ROLLBACK_LOCK_DIR.
set -euo pipefail
cd "$(dirname "$0")/../.."

DB_CONTAINER=supabase-db-moqbebljyeyprktd19zb1ihn
APP=emlaksoft-app
COMPOSE=deploy/compose.prod.yml
STATIC_DIR=/srv/emlaksoft/next-static
HEALTH_URL=${ROLLBACK_HEALTH_URL:-https://emlaksoft.com.tr/api/health}
TAG_RE='^[0-9]{12}-[0-9a-f]{4,40}(-dirty)?$'

DRY=0
REQ=""
for a in "$@"; do
  case "$a" in
    --dry-run|-n) DRY=1 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    -*) echo "Bilinmeyen seçenek: $a"; exit 2 ;;
    *) REQ=$a ;;
  esac
done
if [ -n "$REQ" ] && ! [[ "$REQ" =~ $TAG_RE ]]; then
  echo "Geçersiz sürüm etiketi: $REQ (beklenen: YYYYMMDDHHMM-<sha>)"; exit 2
fi

LOCK_DIR=${ROLLBACK_LOCK_DIR:-/run/lock}
exec 8>"$LOCK_DIR/emlaksoft-rollback.lock"
flock -n 8 || { echo "Başka bir geri dönüş sürüyor"; exit 1; }

psql_ro() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 "$@"
}

# (1) Yayındaki sürüm: konteyner etiketi; latest/onceki ise aynı imaj kimliğine sahip sürüm etiketi aranır.
CUR_IMAGE=$(docker inspect "$APP" --format '{{.Config.Image}}' 2>/dev/null || true)
CUR=${CUR_IMAGE#"$APP":}
if [ -n "$CUR_IMAGE" ] && ! [[ "$CUR" =~ $TAG_RE ]]; then
  CUR_ID=$(docker inspect "$APP" --format '{{.Image}}' 2>/dev/null || true)
  CUR=$(docker images "$APP" --format '{{.Tag}} {{.ID}}' --no-trunc \
    | awk -v id="$CUR_ID" '$2 == id {print $1}' | grep -E "$TAG_RE" | sort -r | head -n 1 || true)
fi
[ -n "$CUR" ] || CUR="(bilinmiyor)"

# (2) Hedef sürüm.
if [ -n "$REQ" ]; then
  TARGET=$REQ
else
  TARGET=$(psql_ro -v cur="$CUR" <<'SQL' 2>/dev/null || true
begin read only;
with anchor as (
  select coalesce(max(finished_at), now() + interval '1 day') as at
  from public.release_history where tag = :'cur' and outcome = 'ok'
)
select h.tag
from public.release_history h, anchor
where h.outcome = 'ok' and h.tag <> :'cur' and h.finished_at < anchor.at
  and not exists (
    select 1 from public.release_history r
    where r.tag = h.tag and r.outcome = 'rolled_back' and r.finished_at > h.finished_at)
order by h.finished_at desc, h.id desc
limit 1;
rollback;
SQL
  )
  TARGET=$(printf '%s\n' "$TARGET" | grep -E "$TAG_RE" | head -n 1 || true)
  if [ -z "$TARGET" ]; then
    echo "release_history'de yayındakinden ($CUR) önce biten bir 'ok' sürüm bulunamadı — etiketi elle verin:"
    echo "  docker images $APP --format '{{.Tag}}' | sort -r"
    exit 1
  fi
fi
if [ "$TARGET" = "$CUR" ]; then
  echo "Hedef ($TARGET) zaten yayında; yapılacak bir şey yok"; exit 1
fi

# (3) İmaj yerelde mi?
if ! docker image inspect "$APP:$TARGET" >/dev/null 2>&1; then
  echo "Hedef imaj yerelde yok: $APP:$TARGET (budanmış olabilir) — geri dönüş yapılamaz"
  echo "Yerel sürümler: $(docker images "$APP" --format '{{.Tag}}' | grep -E "$TAG_RE" | sort -r | tr '\n' ' ')"
  exit 1
fi

TARGET_MIG=$(psql_ro -v t="$TARGET" -c "select coalesce(release_migration, '') from public.release_history where tag = :'t' and outcome = 'ok' order by finished_at desc limit 1" 2>/dev/null </dev/null || true)
ENV_MIG=$(sed -n 's/^RELEASE_MIGRATION=//p' .env.production 2>/dev/null | head -n 1 || true)
CMD="APP_TAG=$TARGET docker compose -f $COMPOSE up -d --remove-orphans"

echo "Yayındaki sürüm : $APP:$CUR"
echo "Hedef imaj      : $APP:$TARGET"
echo "Komut           : $CMD"
if [ -n "$TARGET_MIG" ] && [ -n "$ENV_MIG" ] && [ "$TARGET_MIG" != "$ENV_MIG" ]; then
  echo "Şema notu       : hedef $TARGET_MIG ile yayınlanmıştı; DB $ENV_MIG'de kalır (forward-only). Hedef kod yeni şemayla uyumlu olmalı."
fi
if [ "$DRY" = 1 ]; then
  echo "[kuru] hiçbir şey değiştirilmedi"; exit 0
fi

START_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
START_S=$(date +%s)

# Sürüm satırı: geri ALINAN sürüm (CUR) için. Değerler psql değişkeni olarak geçer; asla betiği düşürmez.
record_rollback() {
  local outcome="$1" detail="$2" sha mig dur
  sha=${CUR#*-}
  [[ "$CUR" =~ $TAG_RE ]] || sha="bilinmiyor"
  mig=$(docker inspect "$APP" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | sed -n 's/^RELEASE_MIGRATION=//p' | head -n 1 || true)
  dur=$(( $(date +%s) - START_S ))
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 \
    -v sha="${sha:0:64}" -v tag="${CUR:0:120}" -v outcome="$outcome" -v started="$START_TS" -v dur="$dur" \
    -v mig="${mig:0:200}" -v actor="${SUDO_USER:-${USER:-root}}" -v host="$(hostname -s | cut -c1-80)" \
    -v detail="${detail:0:500}" <<'SQL' >/dev/null 2>&1 || echo "[uyari] sürüm satırı yazılamadı"
insert into public.release_history (sha, tag, outcome, started_at, duration_sec, release_migration, subject, actor, host, detail)
values (:'sha', :'tag', :'outcome', :'started'::timestamptz, :'dur'::integer, nullif(:'mig', ''), 'elle geri dönüş (rollback.sh)',
        nullif(:'actor', ''), nullif(:'host', ''), nullif(:'detail', ''));
SQL
}

wait_healthy() {
  local _i
  for _i in $(seq 1 60); do
    if docker exec "$APP" node -e \
      "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" \
      >/dev/null 2>&1 \
      && curl -fsS -o /dev/null "$HEALTH_URL" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# (4) Hedefin statik parçaları (açık sekmeler ve sayfa ilk yüklemesi için; konteyner klasörü salt-okunur bağlar).
if [ -d "$STATIC_DIR" ]; then
  CID=$(docker create "$APP:$TARGET")
  docker cp "$CID:/app/.next/static/." "$STATIC_DIR/" || echo "[uyari] hedef statik dosyaları kopyalanamadı"
  docker rm "$CID" >/dev/null
  chown -R 1001:1001 "$STATIC_DIR" || true
fi

# (5) + (6)
echo "Geri dönülüyor: $APP:$CUR → $APP:$TARGET"
APP_TAG="$TARGET" docker compose -f "$COMPOSE" up -d --remove-orphans
if wait_healthy; then
  echo "Geri dönüş başarılı: $APP:$TARGET yayında"
  record_rollback rolled_back "elle geri dönüş: $APP:$CUR → $APP:$TARGET (sağlık 200)"
  curl -s "$HEALTH_URL"; echo
  exit 0
fi

echo "Hedef 120 sn içinde sağlıklı olmadı: $APP:$TARGET"
docker logs --tail 30 "$APP" || true
if [[ "$CUR" =~ $TAG_RE ]] && docker image inspect "$APP:$CUR" >/dev/null 2>&1; then
  echo "Önceki sürüme geri çıkılıyor: $APP:$CUR"
  APP_TAG="$CUR" docker compose -f "$COMPOSE" up -d --remove-orphans
  if wait_healthy; then echo "$APP:$CUR yeniden yayında"; else echo "$APP:$CUR de sağlıklı değil — elle müdahale gerekiyor"; fi
fi
record_rollback failed "elle geri dönüş başarısız: $APP:$TARGET 120 sn içinde sağlıklı olmadı; $APP:$CUR'e geri çıkıldı"
exit 1
