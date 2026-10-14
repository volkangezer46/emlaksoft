#!/usr/bin/env bash
# Anlık hata akışı: public.error_logs'ta (/admin/sistem?sekme=hatalar; sunucu + istemci hataları) yeni görülen veya tekrarlayan
# her çözülmemiş (ve yok sayılmamış/ertelenmemiş) hata için /var/log/emlaksoft/hatalar.jsonl'a TEK SATIR JSON yazar. 15 sn aralık.
# systemd: /etc/systemd/system/emlaksoft-error-watch.service (scripts/sunucu/install-error-watch.sh).
#
# UYARI MOTORU BAĞLANTISI (AD10): 30 sn'de bir /api/health yoklanır. Kesinti "health_down" kuralının eşiği (varsayılan
# 2 dk; Sistem > Uyarılar) boyunca sürerse scripts/sunucu/alert-send.py kanallara (Telegram/webhook/e-posta) uyarı
# gönderir ve alert_events'e (source='host') yazar; kesinti sürdükçe kuralın tekrar aralığında "SÜRÜYOR" hatırlatması,
# düzelince "düzeldi" mesajı gider. "Bildirildi mi" kararı alert-send.py'nin ÇIKIŞ KODUNDAN verilir (0 = iletildi);
# stderr ayrı dosyaya (alert-send.err) gider, stdout yalnız günlük satırıdır. Uygulama çökükken de çalışır
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
LAST_FIRE=0
ALERT_ERR=$OUT_DIR/alert-send.err

# Kural: "etkin eşik_dk sessiz tekrar_dk" (DB yoksa önbellek; o da yoksa 1 2 0 30).
rule_line() { python3 -I "$ALERT" rule 2>/dev/null || echo "1 2 0 30"; }
rule_threshold_sec() {
  local th; th=$(rule_line | awk '{print $2}')
  python3 -I -c "import sys; v=float(sys.argv[1] or 2); print(int(max(1.0, min(30.0, v))*60))" "${th:-2}" 2>/dev/null || echo 120
}
rule_repeat_sec() {
  local rp; rp=$(rule_line | awk '{print $4}')
  case "$rp" in ''|*[!0-9]*) rp=30 ;; esac
  [ "$rp" -lt 5 ] && rp=30
  echo $((rp * 60))
}

# Uyarı gönderir; çıktıyı RES'e, iletildiyse SENT=1 yazar (karar çıkış kodundan; stderr ayrı dosyaya).
alert_call() {
  RES=$(python3 -I "$ALERT" "$@" 2>>"$ALERT_ERR")
  if [ $? -eq 0 ]; then SENT=1; else SENT=0; fi
}
log_alert() {
  printf '{"zaman":"%s","kaynak":"uyari","tekrar":1,"digest":null,"yol":"/api/health","mesaj":%s}\n' "$1" \
    "$(printf '%s' "$2" | python3 -I -c 'import sys,json; print(json.dumps(sys.stdin.read()[:400]))')" >> "$OUT"
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
      LAST_FIRE=$nowsec
      local mins=$(( (nowsec - DOWN_SINCE) / 60 ))
      alert_call fire --title "Site yanıt vermiyor" \
        --body "https://emlaksoft.com.tr/api/health ${mins} dakikadır 200 dönmüyor (son yanıt HTTP ${code})."
      NOTIFIED=$SENT
      log_alert "$t" "UYARI: $RES"
    elif [ "$ALERTED" = 1 ] && [ $((nowsec - LAST_FIRE)) -ge "$(rule_repeat_sec)" ]; then
      # Tekrar aralığı doldu: kesinti sürüyor hatırlatması (ilk uyarı iletilemediyse bu ilk bildirim olur).
      LAST_FIRE=$nowsec
      local mins=$(( (nowsec - DOWN_SINCE) / 60 ))
      local rem=1; [ "$NOTIFIED" = 1 ] || rem=0
      alert_call fire --reminder "$rem" --title "Site yanıt vermiyor" \
        --body "https://emlaksoft.com.tr/api/health ${mins} dakikadır 200 dönmüyor (son yanıt HTTP ${code})."
      [ "$SENT" = 1 ] && NOTIFIED=1
      log_alert "$t" "SÜRÜYOR: $RES"
    fi
  elif [ "$DOWN" = 1 ]; then
    local mins=$(( (nowsec - DOWN_SINCE) / 60 ))
    DOWN=0
    printf '{"zaman":"%s","kaynak":"saglik","tekrar":1,"digest":null,"yol":"/api/health","mesaj":"DÜZELDİ: sağlık kontrolü yeniden 200"}\n' "$t" >> "$OUT"
    if [ "$ALERTED" = 1 ]; then
      alert_call resolve --notified "$NOTIFIED" --title "Site yeniden yanıt veriyor" \
        --body "Kesinti yaklaşık ${mins} dakika sürdü (son hata HTTP ${LAST_CODE}); /api/health yeniden 200."
      log_alert "$t" "DÜZELDİ: $RES"
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
