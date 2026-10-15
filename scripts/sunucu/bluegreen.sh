#!/usr/bin/env bash
# Mavi/yeşil kesintisiz geçiş kitaplığı (SK1/B043) — deploy.sh ve rollback.sh `source` eder; tek başına çalıştırılmaz.
# Çağıran depo kökünde olmalıdır (deploy/compose.prod.yml göreli yol). Ayar (ortamdan): DRAIN_WAIT, SETTLE_WAIT,
# READY_TRIES, HEALTH_URL (dış sağlık adresi; varsayılan https://emlaksoft.com.tr/api/health).
# Tanımlar: COMPOSE, BLUE, GREEN, container_ready, wait_ready, external_ok, drain, green_down, swap_to.
# shellcheck shell=bash
# shellcheck disable=SC2034  # COMPOSE/BLUE/GREEN çağıran betikte de kullanılır

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
    curl -fsS -o /dev/null "${HEALTH_URL:-https://emlaksoft.com.tr/api/health}" 2>/dev/null && return 0
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

