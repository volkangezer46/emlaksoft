#!/usr/bin/env bash
# EmlakSoft'u bu sunucuda derleyip yayınlar (https://emlaksoft.com.tr).
# Kullanım: scripts/sunucu/deploy.sh            (çalışma ağacının mevcut hali)
# Sırlar: .env.production (600) — derlemeye BuildKit secret olarak, çalışmaya env_file olarak girer.
# DB'ye yeni migration uygulandıysa önce .env.production'daki RELEASE_MIGRATION(_CHECKSUM) güncellenir
# (`npm run check:migrations -- --release`), yoksa /api/health 503 döner.
# Kesintisiz geçiş (SK1/B043): yeni imaj önce yeşil konteynerde (emlaksoft-app-green) açılır; sağlıklı olunca mavi
# (emlaksoft-app) boşaltılıp yeni imajla yeniden kurulur, sonra yeşil boşaltılıp kaldırılır (ayrıntı: swap_to). Yeşil
# 120 sn içinde sağlıklı olmazsa mavi hiç kapanmamıştır: önceki sürüm kesintisiz yayında kalır, betik exit 1 ile biter.
# Yeni sürüm açılmadan hemen önce tek "reload schema" NOTIFY'ı + RPC ısıtma (SK1/B044). Yayından sonra bekçi (SK1/B179):
# public smoke + measure-live bütçesi; art arda 3 yeşilden sonra kırmızıda önceki sürüme kesintisiz döner.
# Yayından SONRA elle geri dönüş: scripts/sunucu/rollback.sh (docs/runbooks/GERI_DONUS.md).
# ACL_GATE=strict → ACL denetimi başarısızsa yayın durur (varsayılan: uyarı).
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
# shellcheck disable=SC2317  # EXIT tuzağıyla dolaylı çağrılır
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

# ---------------------------------------------------------------------------------------------------------------
# SK1/B044: tek "reload schema" + ısıtma. release.sh migrate süresince PostgREST DDL izleyicilerini kapatır; şema önbelleği
# burada, yeni sürüm açılmadan HEMEN önce bir kez yenilenir. Ardından kapı/kabuk/finans RPC'leri PostgREST havuzunun
# birkaç bağlantısında paralel çağrılır (plpgsql derlemesi + katalog önbelleği ilk kullanıcıya kalmasın). Asla düşürmez.
# ---------------------------------------------------------------------------------------------------------------
REST_CONTAINER=${REST_CONTAINER:-supabase-rest-moqbebljyeyprktd19zb1ihn}
# Anahtar yoksa boş döner (set -e + pipefail altında grep'in "eşleşme yok" kodu betiği düşürmesin).
env_value() { { grep -E "^$1=" .env.production || true; } | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
pgrst_reload_and_warm() {
  local since url key i n=0
  since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atqc "notify pgrst, 'reload schema';" >/dev/null 2>&1 \
    || { echo "[uyari] PostgREST reload NOTIFY gönderilemedi"; return 0; }
  for i in $(seq 1 20); do
    n=$(docker logs --since "$since" "$REST_CONTAINER" 2>&1 | grep -c "Schema cache loaded" || true)
    [ "${n:-0}" -ge 1 ] && break
    sleep 0.5
  done
  echo "PostgREST şema önbelleği yenilendi (${n:-0} yükleme)"
  url=$(env_value NEXT_PUBLIC_SUPABASE_URL); key=$(env_value SUPABASE_SECRET_KEY)
  [ -n "$key" ] || key=$(env_value SUPABASE_SERVICE_ROLE_KEY)
  [ -n "$url" ] && [ -n "$key" ] || { echo "[uyari] ısıtma atlandı (Supabase adresi/anahtarı yok)"; return 0; }
  local auth=()
  [[ "$key" == eyJ* ]] && auth=(-H "Authorization: Bearer $key")
  for i in 1 2 3 4 5 6; do
    for rpc in 'proxy_gate_snapshot|{"p_user_id":null,"p_tenant_id":null}' 'app_shell_bootstrap|{}' 'finance_overview|{"p_from":null,"p_to":null}'; do
      curl -s -o /dev/null --max-time 10 -X POST "$url/rest/v1/rpc/${rpc%%|*}" -H "apikey: $key" "${auth[@]}" \
        -H "Content-Type: application/json" -d "${rpc#*|}" &
    done
  done
  wait
  echo "RPC ısıtma tamam (proxy_gate_snapshot, app_shell_bootstrap, finance_overview × 6 paralel)"
}

# ---------------------------------------------------------------------------------------------------------------
# SK1/B043 kesintisiz geçiş (mavi/yeşil, deploy/compose.prod.yml). Mavi = emlaksoft-app (kalıcı), yeşil =
# emlaksoft-app-green (yalnız geçiş sırasında). Traefik, Docker sağlığı "healthy" olmayan konteyneri havuza almaz ve
# her sunucuyu /api/health ile 2 sn'de bir yoklar; boşaltılan konteyner (/tmp/emlaksoft-drain) 503 döner ve havuzdan
# çıkar. Sıra: yeşil YENİ imajla açılır → sağlıklı → mavi boşaltılır → mavi YENİ imajla yeniden kurulur → sağlıklı →
# yeşil boşaltılıp kaldırılır. Her an en az bir sağlıklı sunucu trafikte kalır.
# ---------------------------------------------------------------------------------------------------------------
COMPOSE=(docker compose -f deploy/compose.prod.yml)
BLUE=emlaksoft-app
GREEN=emlaksoft-app-green
DRAIN_WAIT=${DRAIN_WAIT:-6}
SETTLE_WAIT=${SETTLE_WAIT:-4}
READY_TRIES=${READY_TRIES:-60}

# Konteyner hazır: Docker sağlığı healthy (Traefik havuza alır) VE konteyner içinden /api/health 200.
container_ready() {
  [ "$(docker inspect "$1" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null)" = healthy ] \
    && docker exec "$1" node -e \
      "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" >/dev/null 2>&1
}
wait_ready() {
  local _i
  for _i in $(seq 1 "$READY_TRIES"); do
    container_ready "$1" && return 0
    sleep 2
  done
  return 1
}
external_ok() {
  local _i
  for _i in $(seq 1 15); do
    curl -fsS -o /dev/null https://emlaksoft.com.tr/api/health 2>/dev/null && return 0
    sleep 2
  done
  return 1
}
drain() {
  docker exec "$1" sh -c ': > /tmp/emlaksoft-drain' >/dev/null 2>&1 || return 0
  sleep "$DRAIN_WAIT"
}
green_down() {
  drain "$GREEN"
  "${COMPOSE[@]}" --profile green rm -sf app-green >/dev/null 2>&1 || docker rm -f "$GREEN" >/dev/null 2>&1 || true
}

# Traefik aynı servisi/yönlendiriciyi/ara katmanı FARKLI yapılandırmayla tanımlayan iki konteyner görürse üçünü de
# düşürür ("defined multiple times with different configurations") → tüm site 404. Bu yüzden yayındaki mavinin traefik.*
# etiketleri compose dosyasındakilerle aynı değilse (etiket değişen yayın, ör. SK1'in ilk yayını) mavi/yeşil YAPILMAZ:
# mavi tek seferlik yeniden kurulur (kısa kesinti), sonraki yayınlar yine kesintisizdir.
traefik_labels_running() {
  docker inspect "$BLUE" --format '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}{{"\n"}}{{end}}' 2>/dev/null \
    | grep '^traefik\.' | sort || true
}
traefik_labels_compose() {
  "${COMPOSE[@]}" config --format json 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const l = JSON.parse(s).services.app.labels || {};
        for (const [k, v] of Object.entries(l)) if (k.startsWith("traefik.")) console.log(k + "=" + String(v).replace(/\$\$/g, "$"));
      } catch {}
    });' 2>/dev/null | sort || true
}

# swap_to <etiket>: 0 = mavi yeni etikette ve sağlıklı, yeşil kapalı · 1 = yeşil sağlıklı olmadı (mavi HİÇ kapanmadı,
# eski sürüm kesintisiz yayında) · 2 = mavi yeniden kurulamadı (yeşil varsa yeni etiketle trafikte kalır).
swap_to() {
  local tag=$1
  if docker inspect "$BLUE" >/dev/null 2>&1 && [ "$(traefik_labels_running)" != "$(traefik_labels_compose)" ]; then
    echo "Traefik etiketleri değişti: mavi/yeşil yerine tek seferlik yeniden kurma (kısa kesinti)"
    APP_TAG="$tag" "${COMPOSE[@]}" up -d --no-deps app
    if wait_ready "$BLUE"; then return 0; fi
    echo "Mavi (emlaksoft-app:$tag) 120 sn içinde sağlıklı olmadı"; docker logs --tail 50 "$BLUE" || true
    return 2
  fi
  docker rm -f "$GREEN" >/dev/null 2>&1 || true
  GREEN_TAG="$tag" "${COMPOSE[@]}" --profile green up -d --no-deps app-green
  if ! wait_ready "$GREEN"; then
    echo "Yeşil (emlaksoft-app:$tag) 120 sn içinde sağlıklı olmadı"; docker logs --tail 50 "$GREEN" || true
    "${COMPOSE[@]}" --profile green rm -sf app-green >/dev/null 2>&1 || docker rm -f "$GREEN" >/dev/null 2>&1 || true
    return 1
  fi
  sleep "$SETTLE_WAIT"
  drain "$BLUE"
  APP_TAG="$tag" "${COMPOSE[@]}" up -d --no-deps app
  if ! wait_ready "$BLUE"; then
    echo "Mavi (emlaksoft-app:$tag) 120 sn içinde sağlıklı olmadı; yeşil trafikte"; docker logs --tail 50 "$BLUE" || true
    return 2
  fi
  sleep "$SETTLE_WAIT"
  green_down
  return 0
}

# ---------------------------------------------------------------------------------------------------------------
# SK1/B179-B181 yayın sonrası bekçi: canlıya karşı public smoke (npm run test:e2e:public) + bütçe ölçümü
# (scripts/perf/measure-live.mts --watchdog: TTFB/DCL + realtime olay gecikmesi). Art arda WATCHDOG_GREENS (3) yeşil
# koşuya kadar yalnız uyarır; seri dolduktan sonra kırmızıda önceki sürüme (PREV) döner. Seri: $WATCHDOG_STATE.
# measure-live çıkış 3 (sakin sunucu değil) nötrdür: seri değişmez. WATCHDOG=warn → asla geri dönmez; WATCHDOG=off → koşmaz.
# Ayrıntılı çıktı: /tmp/emlaksoft-gate/{e2e-public,measure-live}.log (+ measure-live.json).
# ---------------------------------------------------------------------------------------------------------------
WATCHDOG_GREENS=3
WATCHDOG_STATE=${WATCHDOG_STATE:-/srv/emlaksoft/bekci-seri}
# 0 = yeşil/uyarı/nötr · 1 = geri dön
watchdog() {
  [ "${WATCHDOG:-on}" = off ] && { echo "Bekçi: kapalı (WATCHDOG=off)"; return 0; }
  local gd=/tmp/emlaksoft-gate red="" streak mrc
  mkdir -p "$gd" "$(dirname "$WATCHDOG_STATE")" 2>/dev/null || true
  streak=$(cat "$WATCHDOG_STATE" 2>/dev/null || echo 0); [[ "$streak" =~ ^[0-9]+$ ]] || streak=0
  if ! APP_URL=https://emlaksoft.com.tr npm run -s test:e2e:public > "$gd/e2e-public.log" 2>&1; then
    red="public smoke kırık ($(grep -cE '✘|failed' "$gd/e2e-public.log" || true) satır)"
  fi
  mrc=0
  npx tsx scripts/perf/measure-live.mts --watchdog --json "$gd/measure-live.json" > "$gd/measure-live.log" 2>&1 || mrc=$?
  case "$mrc" in
    0) ;;
    3) echo "Bekçi: ölçüm yapılmadı ($(tail -1 "$gd/measure-live.log")); seri değişmedi"
       [ -z "$red" ] && return 0 ;;
    *) red="${red:+$red; }bütçe/ölçüm: $({ grep -E '^BÜTÇE|hatası|HTTP' "$gd/measure-live.log" || true; } | tail -1)" ;;
  esac
  grep -E "^(TTFB|DCL|REALTIME)" "$gd/measure-live.log" | sed 's/^/  /' || true
  if [ -z "$red" ]; then
    echo $((streak + 1)) > "$WATCHDOG_STATE" 2>/dev/null || true
    echo "Bekçi: yeşil (art arda $((streak + 1)))"
    return 0
  fi
  echo 0 > "$WATCHDOG_STATE" 2>/dev/null || true
  if [ "$streak" -lt "$WATCHDOG_GREENS" ] || [ "${WATCHDOG:-on}" = warn ]; then
    echo "[uyari] Bekçi kırmızı: $red (art arda yeşil $streak < $WATCHDOG_GREENS ya da WATCHDOG=warn: yalnız uyarı)"
    return 0
  fi
  echo "Bekçi kırmızı: $red — önceki sürüme dönülüyor"
  WATCHDOG_REASON=$red
  return 1
}

"${COMPOSE[@]}" up -d --no-deps static
pgrst_reload_and_warm
echo "Yayına alınıyor: emlaksoft-app:$TAG (mavi/yeşil geçiş)"
set +e
swap_to "$TAG"
SWAP_RC=$?
set -e
NEW_MIG=$(docker inspect "$([ "$SWAP_RC" = 2 ] && echo "$GREEN" || echo "$BLUE")" \
  --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | sed -n 's/^RELEASE_MIGRATION=//p' | head -n1 || true)
# Disk: son 3 sürüm imajı (+ latest/onceki ve yayındaki) kalır; eski derleme önbelleği temizlenir.
# KQ4: release_history'deki SON İKİ "ok" sürümün imajı (yayındaki + bir önceki = scripts/sunucu/rollback.sh hedefi) ve
# çalışan konteynerin imajı yaşına bakılmadan HER ZAMAN korunur. Tablo okunamazsa yalnız son 3 kuralı uygulanır.
prune_images() {
  local keep running
  keep=$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -At -c \
    "select tag from public.release_history where outcome = 'ok' order by finished_at desc, id desc limit 2" 2>/dev/null || true)
  running=$(docker inspect emlaksoft-app --format '{{.Config.Image}}' 2>/dev/null || true)
  keep=$(printf '%s\n%s\n' "$keep" "${running#emlaksoft-app:}")
  docker images emlaksoft-app --format '{{.Tag}}' | grep -E '^[0-9]{12}-' | sort -r | tail -n +4 \
    | while read -r t; do
        if printf '%s\n' "$keep" | grep -qxF -- "$t"; then
          echo "[bilgi] imaj korundu (son ok sürüm / yayındaki): emlaksoft-app:$t"
          continue
        fi
        docker rmi "emlaksoft-app:$t" >/dev/null 2>&1 || true
      done
  docker builder prune -f --reserved-space 5gb >/dev/null 2>&1 || docker builder prune -f --keep-storage 5gb >/dev/null 2>&1 || true
}

PREV_TAG=${PREV#emlaksoft-app:}
if [ "$SWAP_RC" = 0 ] && external_ok; then
  echo "Yayında: emlaksoft-app:$TAG (kesintisiz geçiş tamam)"
  WATCHDOG_REASON=""
  if watchdog; then
    record_release ok
    prune_images
    curl -s https://emlaksoft.com.tr/api/health; echo; exit 0
  fi
  if [ -z "$PREV" ] || [ "$PREV" = "emlaksoft-app:$TAG" ]; then
    record_release failed "bekçi kırmızı ($WATCHDOG_REASON); geri dönülecek önceki imaj yok"
    exit 1
  fi
  echo "Geri dönülüyor (bekçi): $PREV"
  set +e; swap_to "$PREV_TAG"; RB_RC=$?; set -e
  if [ "$RB_RC" = 0 ]; then
    echo "Geri dönüş başarılı: $PREV yayında (bekçi: $WATCHDOG_REASON)"
    record_release rolled_back "bekçi kırmızı ($WATCHDOG_REASON); $PREV kesintisiz yeniden yayında"
  else
    record_release failed "bekçi kırmızı ($WATCHDOG_REASON); geri dönüş ($PREV) sağlıklı olmadı — elle müdahale"
  fi
  exit 1
fi

if [ "$SWAP_RC" = 1 ]; then
  echo "Yeni sürüm yayına alınmadı: önceki sürüm (mavi) hiç kapanmadan yayında"
  record_release rolled_back "yeşil (yeni sürüm) 120 sn içinde sağlıklı olmadı; önceki sürüm kesintisiz yayında kaldı"
  exit 1
fi
if [ "$SWAP_RC" = 2 ] && [ -n "$PREV" ] && [ "$PREV" != "emlaksoft-app:$TAG" ]; then
  echo "Geri dönülüyor: mavi → $PREV (yeşil yeni sürümle trafikte)"
  APP_TAG="$PREV_TAG" "${COMPOSE[@]}" up -d --no-deps app
  if wait_ready "$BLUE"; then
    green_down
    echo "Geri dönüş başarılı: $PREV yayında (yeni sürüm emlaksoft-app:$TAG yayınlanmadı)"
    record_release rolled_back "mavi yeni sürümle sağlıklı olmadı; $PREV yeniden yayında"
    exit 1
  fi
fi
echo "Sağlık doğrulanamadı (geçiş kodu $SWAP_RC) — elle müdahale gerekiyor: docker ps | grep emlaksoft-app"
record_release failed "geçiş kodu $SWAP_RC; sağlıklı sürüm doğrulanamadı"
exit 1
