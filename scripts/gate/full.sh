#!/bin/bash
# Tam kontrol zinciri (tip, lint, tam vitest + başarısızları tekrar, link/cron/migration/action denetimleri, sahte env ile build, push).
# Kullanım:  RM=<son migration dosyası> RC=<checksum> bash scripts/gate/full.sh   (RM/RC: npm run check:migrations -- --release)
# Sonuç: $LOG (varsayılan /tmp/emlaksoft-gate/full.log). Aynı anda başka ağır iş çalıştırma (bkz. memory: yerel kaynak bütçesi).
cd "$(dirname "$0")/../.." || exit 1
D=${GATE_DIR:-/tmp/emlaksoft-gate}; mkdir -p "$D"; L=${LOG:-$D/full.log}; : > "$L"
n=$(npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "^tmp-" | wc -l); echo "TSC=$n" >> "$L"; [ "$n" = 0 ] || exit 1
npm run -s lint > "$D/lint.log" 2>&1 || { echo LINT_FAIL >> "$L"; tail -20 "$D/lint.log" >> "$L"; exit 1; }
npx vitest run --testTimeout=300000 > "$D/vitest.log" 2>&1; V=$?
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
F=abcdefghijklmnopqrstuvwxyz0123456789abcdefghijkl
NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy SUPABASE_SECRET_KEY=dummy ALLOW_PLATFORM_DEMO=0 ENABLE_DEMO_LOGIN=0 EMLAKSOFT_ENV=preview OTP_HMAC_SECRET=${F} TWO_FACTOR_COOKIE_SECRET=${F}x PROPERTY_MEDIA_SIGNING_SECRET=${F}y HEALTHCHECK_SECRET=${F}z NEXT_PUBLIC_APP_URL=${GATE_APP_URL:-https://emlaksoft.com.tr} RELEASE_MIGRATION=$RM RELEASE_MIGRATION_CHECKSUM=$RC npm run build > "$D/build.log" 2>&1 || { echo BUILD_FAIL >> "$L"; tail -20 "$D/build.log" >> "$L"; exit 1; }
echo BUILD_OK >> "$L"
if [ "${GATE_PUSH:-1}" = 1 ]; then git push -q origin main && echo PUSHED >> "$L" && git log --oneline -1 >> "$L"; fi
