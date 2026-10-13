#!/usr/bin/env bash
# Anlık hata akışı: public.error_logs'ta (/admin/hatalar; sunucu + istemci hataları) yeni görülen veya tekrarlayan
# her çözülmemiş (ve yok sayılmamış/ertelenmemiş) hata için /var/log/emlaksoft/hatalar.jsonl'a TEK SATIR JSON yazar. 15 sn aralık.
# systemd: /etc/systemd/system/emlaksoft-error-watch.service (scripts/sunucu/install-error-watch.sh).
#
# UYARI MOTORU BAĞLANTISI (AD10): 30 sn'de bir /api/health yoklanır. Kesinti "health_down" kuralının eşiği (varsayılan
# 2 dk; Sistem > Uyarılar) boyunca sürerse scripts/sunucu/alert-send.py kanallara (Telegram/webhook/e-posta) uyarı
# gönderir ve alert_events'e (source='host') yazar; düzelince "düzeldi" mesajı gider. Uygulama çökükken de çalışır
# (kanallar şifreli önbellekten). Hata akışındaki olaylar ise error_rate_minutely sayacıyla uygulama içi
# "hata patlaması" kuralına girer (record_error_occurrence). Betik değişince: scripts/sunucu/install-error-watch.sh.
set -uo pipefail
DB=supabase-db-moqbebljyeyprktd19zb1ihn
OUT_DIR=/var/log/emlaksoft
OUT=$OUT_DIR/hatalar.jsonl
STATE=$OUT_DIR/hatalar.cursor
ALERT="$(cd "$(dirname "$0")" && pwd)/alert-send.py"
mkdir -p "$OUT_DIR"
CURSOR=$(cat "$STATE" 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
TICK=0
DOWN=0
DOWN_SINCE=0
LAST_CODE=200
ALERTED=0
NOTIFIED=0

# Kural: "etkin eşik_dk sessiz" (DB yoksa önbellek; o da yoksa 1 2 0).
rule_threshold_sec() {
  local r; r=$(python3 -I "$ALERT" rule 2>/dev/null || echo "1 2 0")
  local th; th=$(printf '%s' "$r" | awk '{print $2}')
  python3 -I -c "import sys; v=float(sys.argv[1] or 2); print(int(max(1.0, min(30.0, v))*60))" "${th:-2}" 2>/dev/null || echo 120
}

# Sağlık yoklaması: site/DB yanıt vermezse "KESİNTİ", düzelince "DÜZELDİ" satırı yazılır; eşik dolunca uyarı gider.
health_check() {
  local code t nowsec
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://emlaksoft.com.tr/api/health || echo 000)
  t=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  nowsec=$(date +%s)
  if [ "$code" != "200" ]; then
    LAST_CODE=$code
    if [ "$DOWN" = 0 ]; then
      DOWN=1
      DOWN_SINCE=$nowsec
      printf '{"zaman":"%s","kaynak":"saglik","tekrar":1,"digest":null,"yol":"/api/health","mesaj":"KESİNTİ: sağlık kontrolü HTTP %s"}\n' "$t" "$code" >> "$OUT"
    fi
    if [ "$ALERTED" = 0 ] && [ $((nowsec - DOWN_SINCE)) -ge "$(rule_threshold_sec)" ]; then
      ALERTED=1
      local mins=$(( (nowsec - DOWN_SINCE) / 60 ))
      local res; res=$(python3 -I "$ALERT" fire --title "Site yanıt vermiyor" \
        --body "https://emlaksoft.com.tr/api/health ${mins} dakikadır 200 dönmüyor (son yanıt HTTP ${code})." 2>&1)
      case "$res" in gönderildi*) NOTIFIED=1 ;; *) NOTIFIED=0 ;; esac
      printf '{"zaman":"%s","kaynak":"uyari","tekrar":1,"digest":null,"yol":"/api/health","mesaj":%s}\n' "$t" \
        "$(printf '%s' "UYARI: $res" | python3 -I -c 'import sys,json; print(json.dumps(sys.stdin.read()[:400]))')" >> "$OUT"
    fi
  elif [ "$DOWN" = 1 ]; then
    local mins=$(( (nowsec - DOWN_SINCE) / 60 ))
    DOWN=0
    printf '{"zaman":"%s","kaynak":"saglik","tekrar":1,"digest":null,"yol":"/api/health","mesaj":"DÜZELDİ: sağlık kontrolü yeniden 200"}\n' "$t" >> "$OUT"
    if [ "$ALERTED" = 1 ]; then
      local res; res=$(python3 -I "$ALERT" resolve --notified "$NOTIFIED" --title "Site yeniden yanıt veriyor" \
        --body "Kesinti yaklaşık ${mins} dakika sürdü (son hata HTTP ${LAST_CODE}); /api/health yeniden 200." 2>&1)
      printf '{"zaman":"%s","kaynak":"uyari","tekrar":1,"digest":null,"yol":"/api/health","mesaj":%s}\n' "$t" \
        "$(printf '%s' "DÜZELDİ: $res" | python3 -I -c 'import sys,json; print(json.dumps(sys.stdin.read()[:400]))')" >> "$OUT"
    fi
    ALERTED=0
    NOTIFIED=0
  fi
}

python3 -I "$ALERT" refresh >/dev/null 2>&1 || true

while true; do
  TICK=$((TICK + 1))
  if [ $((TICK % 2)) = 1 ]; then health_check; fi
  # Kanal/kural önbelleği 5 dakikada bir (DB çökerse son şifreli kopya kullanılır).
  if [ $((TICK % 20)) = 0 ]; then python3 -I "$ALERT" refresh >/dev/null 2>&1 || true; fi
  ROWS=$(docker exec "$DB" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c "
    select json_build_object(
      'zaman', to_char(last_seen at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),
      'kaynak', source, 'tekrar', occurrences, 'digest', digest, 'yol', path,
      'mesaj', left(message, 400), 'yigin', left(coalesce(stack,''), 1200), 'id', id)
    from public.error_logs e
    where last_seen > '$CURSOR'::timestamptz and resolved_at is null
      and coalesce(to_jsonb(e)->>'status', 'open') = 'open'
    order by last_seen" 2>/dev/null) || { sleep 15; continue; }
  if [ -n "$ROWS" ]; then
    printf '%s\n' "$ROWS" >> "$OUT"
    CURSOR=$(printf '%s\n' "$ROWS" | tail -1 | python3 -I -c "import sys,json; print(json.loads(sys.stdin.read())['zaman'])")
    echo "$CURSOR" > "$STATE"
  fi
  sleep 15
done
