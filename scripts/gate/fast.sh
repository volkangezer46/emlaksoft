#!/bin/bash
# HIZLI kontrol zinciri (yayın öncesi): tip + lint + tam vitest PARALEL, ardından link/cron/migration/action denetimleri.
# Yerel `npm run build` YOK: derlemeyi scripts/sunucu/deploy.sh Docker içinde zaten yapar ve başarısızsa yayın olmaz
# (çift derleme kaldırıldı). Tam zincir (yerel build dahil) için scripts/gate/full.sh.
# Sonuç: $LOG (varsayılan /tmp/emlaksoft-gate/fast.log); son satır GATE_OK ya da *_FAIL.
#
# SK1/B042: kapı canlı uygulamayla aynı makinede koşar → tüm zincir en düşük CPU (nice 19) ve boşta G/Ç (ionice -c3)
# önceliğinde çalışır; vitest iş parçacığı sayısı vitest.config.ts'te sınırlı (VITEST_MAX_WORKERS, varsayılan 4).
# SK1/B181: vitest kırılırsa yalnız kırık dosyalar yeniden koşulur; yeniden koşuda GEÇEN dosya "FLAKY <dosya>" olarak
# günlüğe yazılır ve kalıcı sayaçta ($FLAKY_DB, varsayılan /var/tmp/emlaksoft-gate/flaky.tsv) bir artar. Aynı dosya
# FLAKY_LIMIT (varsayılan 3) kez flaky olursa kapı FLAKY_FAIL ile kırılır (testi düzeltip satırı sayaçtan silin).
# Zaman aşımı vitest.config.ts'ten gelir: varsayılan 30 sn, pglite projesi 120 sn (eski 300 sn komut satırı sınırı kaldırıldı).
cd "$(dirname "$0")/../.." || exit 1
if [ -z "${GATE_NICED:-}" ]; then
  export GATE_NICED=1
  if command -v ionice >/dev/null 2>&1; then exec nice -n 19 ionice -c3 bash "$0" "$@"; fi
  exec nice -n 19 bash "$0" "$@"
fi
D=${GATE_DIR:-/tmp/emlaksoft-gate}; mkdir -p "$D"; L=${LOG:-$D/fast.log}; : > "$L"
FLAKY_DB=${FLAKY_DB:-/var/tmp/emlaksoft-gate/flaky.tsv}; FLAKY_LIMIT=${FLAKY_LIMIT:-3}
mkdir -p "$(dirname "$FLAKY_DB")"; touch "$FLAKY_DB"
# Kapı koşarken measure-live "sakin sunucu değil" der (scripts/perf/live-budget.ts: GATE_LOCK).
LOCK=$D/gate.running; echo $$ > "$LOCK"; trap 'rm -f "$LOCK"' EXIT
( NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit > "$D/tsc.log" 2>&1; echo $? > "$D/tsc.rc" ) &
( npm run -s lint > "$D/lint.log" 2>&1; echo $? > "$D/lint.rc" ) &
npx vitest run > "$D/vitest.log" 2>&1; V=$?
wait
# tsc'nin ÇIKIŞ KODU da şart: bellek yetmezliğinde çöken tsc "0 hata" sayılmamalı.
n=$(grep "error TS" "$D/tsc.log" | grep -v "^tmp-" | wc -l); echo "TSC=$n rc=$(cat "$D/tsc.rc")" >> "$L"
if [ "$n" != 0 ] || [ "$(cat "$D/tsc.rc")" != 0 ]; then grep -E "error TS|heap|Aborted" "$D/tsc.log" | head -10 >> "$L"; echo TSC_FAIL >> "$L"; exit 1; fi
[ "$(cat "$D/lint.rc")" = 0 ] || { echo LINT_FAIL >> "$L"; tail -20 "$D/lint.log" >> "$L"; exit 1; }
if [ $V -ne 0 ]; then
  FAILS=$(grep "FAIL" "$D/vitest.log" | grep -oE "(src|scripts)/[^ ]+\.test\.tsx?" | sort -u | xargs)
  [ -n "$FAILS" ] || { echo VITEST_FAIL >> "$L"; tail -30 "$D/vitest.log" >> "$L"; exit 1; }
  echo "rerun: $FAILS" >> "$L"
  # shellcheck disable=SC2086  # dosya listesi bilinçli olarak sözcüklere bölünür
  npx vitest run $FAILS > "$D/vitest2.log" 2>&1 || { echo VITEST_FAIL >> "$L"; grep -E "FAIL|×|AssertionError" "$D/vitest2.log" | head -30 >> "$L"; exit 1; }
  # Yeniden koşuda geçti → flaky. Sayaç: "<dosya>\t<sayı>\t<son tarih>".
  NOW=$(date -u +%FT%TZ)
  for f in $FAILS; do
    echo "FLAKY $f" >> "$L"
    awk -F'\t' -v OFS='\t' -v f="$f" -v now="$NOW" '
      $1 == f { $2 = $2 + 1; $3 = now; hit = 1 } { print }
      END { if (!hit) print f, 1, now }' "$FLAKY_DB" > "$FLAKY_DB.tmp" && mv "$FLAKY_DB.tmp" "$FLAKY_DB"
  done
  OVER=$(awk -F'\t' -v lim="$FLAKY_LIMIT" '$2 >= lim { printf "%s (%s kez) ", $1, $2 }' "$FLAKY_DB")
  if [ -n "$OVER" ]; then
    echo "FLAKY_FAIL: $OVER— testi düzeltin, sonra satırı $FLAKY_DB dosyasından silin" >> "$L"; exit 1
  fi
fi
grep -E "Test Files|Tests " "$D/vitest.log" >> "$L"
npm run -s check:links >> "$L" 2>&1 || { echo LINKS_FAIL >> "$L"; exit 1; }
npm run -s check:cron >> "$L" 2>&1 || { echo CRON_FAIL >> "$L"; exit 1; }
npm run -s check:migrations >> "$L" 2>&1 || { echo MIG_FAIL >> "$L"; exit 1; }
npm run -s audit:actions > "$D/act.log" 2>&1 || { echo ACTIONS_FAIL >> "$L"; tail -5 "$D/act.log" >> "$L"; exit 1; }
echo GATE_OK >> "$L"
