#!/usr/bin/env bash
# Anlık hata akışı: public.error_logs'ta (/admin/hatalar; sunucu + istemci hataları) yeni görülen veya tekrarlayan
# her çözülmemiş hata için /var/log/emlaksoft/hatalar.jsonl'a TEK SATIR JSON yazar. 15 sn aralık.
# systemd: /etc/systemd/system/emlaksoft-error-watch.service (scripts/sunucu/install-error-watch.sh).
set -uo pipefail
DB=supabase-db-moqbebljyeyprktd19zb1ihn
OUT_DIR=/var/log/emlaksoft
OUT=$OUT_DIR/hatalar.jsonl
STATE=$OUT_DIR/hatalar.cursor
mkdir -p "$OUT_DIR"
CURSOR=$(cat "$STATE" 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
TICK=0
DOWN=0
# Dakikada bir dış sağlık kontrolü: site/DB yanıt vermezse "KESİNTİ", düzelince "DÜZELDİ" satırı yazılır.
health_check() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://emlaksoft.com.tr/api/health || echo 000)
  local t; t=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  if [ "$code" != "200" ] && [ "$DOWN" = 0 ]; then
    DOWN=1
    printf '{"zaman":"%s","kaynak":"saglik","tekrar":1,"digest":null,"yol":"/api/health","mesaj":"KESİNTİ: sağlık kontrolü HTTP %s"}\n' "$t" "$code" >> "$OUT"
  elif [ "$code" = "200" ] && [ "$DOWN" = 1 ]; then
    DOWN=0
    printf '{"zaman":"%s","kaynak":"saglik","tekrar":1,"digest":null,"yol":"/api/health","mesaj":"DÜZELDİ: sağlık kontrolü yeniden 200"}\n' "$t" >> "$OUT"
  fi
}

while true; do
  TICK=$((TICK + 1))
  if [ $((TICK % 4)) = 1 ]; then health_check; fi
  ROWS=$(docker exec "$DB" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c "
    select json_build_object(
      'zaman', to_char(last_seen at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),
      'kaynak', source, 'tekrar', occurrences, 'digest', digest, 'yol', path,
      'mesaj', left(message, 400), 'yigin', left(coalesce(stack,''), 1200), 'id', id)
    from public.error_logs
    where last_seen > '$CURSOR'::timestamptz and resolved_at is null
    order by last_seen" 2>/dev/null) || { sleep 15; continue; }
  if [ -n "$ROWS" ]; then
    printf '%s\n' "$ROWS" >> "$OUT"
    CURSOR=$(printf '%s\n' "$ROWS" | tail -1 | python3 -I -c "import sys,json; print(json.loads(sys.stdin.read())['zaman'])")
    echo "$CURSOR" > "$STATE"
  fi
  sleep 15
done
