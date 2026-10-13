#!/bin/bash
# HIZLI kontrol zinciri (yayın öncesi): tip + lint + tam vitest PARALEL, ardından link/cron/migration/action denetimleri.
# Yerel `npm run build` YOK: derlemeyi scripts/sunucu/deploy.sh Docker içinde zaten yapar ve başarısızsa yayın olmaz
# (çift derleme kaldırıldı). Tam zincir (yerel build dahil) için scripts/gate/full.sh.
# Sonuç: $LOG (varsayılan /tmp/emlaksoft-gate/fast.log); son satır GATE_OK ya da *_FAIL.
cd "$(dirname "$0")/../.." || exit 1
D=${GATE_DIR:-/tmp/emlaksoft-gate}; mkdir -p "$D"; L=${LOG:-$D/fast.log}; : > "$L"
( NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit > "$D/tsc.log" 2>&1; echo $? > "$D/tsc.rc" ) &
( npm run -s lint > "$D/lint.log" 2>&1; echo $? > "$D/lint.rc" ) &
npx vitest run --testTimeout=300000 > "$D/vitest.log" 2>&1; V=$?
wait
# tsc'nin ÇIKIŞ KODU da şart: bellek yetmezliğinde çöken tsc "0 hata" sayılmamalı.
n=$(grep "error TS" "$D/tsc.log" | grep -v "^tmp-" | wc -l); echo "TSC=$n rc=$(cat "$D/tsc.rc")" >> "$L"
if [ "$n" != 0 ] || [ "$(cat "$D/tsc.rc")" != 0 ]; then grep -E "error TS|heap|Aborted" "$D/tsc.log" | head -10 >> "$L"; echo TSC_FAIL >> "$L"; exit 1; fi
[ "$(cat "$D/lint.rc")" = 0 ] || { echo LINT_FAIL >> "$L"; tail -20 "$D/lint.log" >> "$L"; exit 1; }
if [ $V -ne 0 ]; then
  FAILS=$(grep "FAIL" "$D/vitest.log" | grep -oE "src/[^ ]+\.test\.tsx?" | sort -u | xargs)
  echo "rerun: $FAILS" >> "$L"
  npx vitest run --testTimeout=300000 $FAILS > "$D/vitest2.log" 2>&1 || { echo VITEST_FAIL >> "$L"; grep -E "FAIL|×|AssertionError" "$D/vitest2.log" | head -30 >> "$L"; exit 1; }
fi
grep -E "Test Files|Tests " "$D/vitest.log" >> "$L"
npm run -s check:links >> "$L" 2>&1 || { echo LINKS_FAIL >> "$L"; exit 1; }
npm run -s check:cron >> "$L" 2>&1 || { echo CRON_FAIL >> "$L"; exit 1; }
npm run -s check:migrations >> "$L" 2>&1 || { echo MIG_FAIL >> "$L"; exit 1; }
npm run -s audit:actions > "$D/act.log" 2>&1 || { echo ACTIONS_FAIL >> "$L"; tail -5 "$D/act.log" >> "$L"; exit 1; }
echo GATE_OK >> "$L"
