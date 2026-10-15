#!/bin/bash
# Tek komutla yayın: hızlı kontrol (scripts/gate/fast.sh) → migration provası (bekleyenler tek transaction'da + ROLLBACK)
# → RLS denetimi → migration'lar (npm run db:migrate; PostgREST DDL izleyicileri kapalı) → "tüm dosyalar ledger'da"
# denetimi + .env.production RELEASE_MIGRATION(_CHECKSUM/_COUNT) → deploy (Docker build + mavi/yeşil geçiş + bekçi)
# → git push. Herhangi bir adım başarısızsa durur.
# Migration adımı (KQ4): db:migrate çıktısı yalnız süzülerek gösterilir, ÇIKIŞ KODU korunur (PIPESTATUS); migration
# düşerse sürüm işareti yazılmaz, deploy ve push yapılmaz, betik sıfırdan farklı kodla biter. Tam çıktı:
# /tmp/emlaksoft-gate/migrate.log. Geri dönüş: docs/runbooks/GERI_DONUS.md (scripts/sunucu/rollback.sh).
# SK1 yayın güvenliği:
#   - Prova (npm run db:rehearse -- --pending): bekleyen migration'lar GERÇEK şemada tek transaction'da çalışır ve HER
#     KOŞULDA geri alınır; bozuk dosya yayını gerçek migration'dan ÖNCE durdurur (/tmp/emlaksoft-gate/rehearse.log).
#     Prova sınırları (statement 20 sn, lock 10 sn) aşılırsa ve bilinçli geçiş gerekiyorsa: REHEARSE_GATE=warn.
#   - RLS denetimi (npm run db:rls-audit, B182) gerçek migration'dan ÖNCE koşar; ihlalde yayın durur. Bilinçli geçiş
#     (ör. kurallar güncellenene kadar): RLS_GATE=warn.
#   - B044: migrate süresince extensions.pgrst_ddl_watch / pgrst_drop_watch event trigger'ları KAPALI (her DDL'de
#     PostgREST şema yeniden yüklemesi olmasın); EXIT tuzağı hata dahil her çıkışta yeniden AÇAR. Tek "reload schema"
#     NOTIFY'ı deploy.sh yeni sürüm açılmadan hemen önce gönderir; deploy'a varılamadan durulursa tuzak gönderir.
#   - Migration sonrası `check:migrations -- --database --release`: diskteki TÜM dosyalar ledger'da değilse durur;
#     RELEASE_MIGRATION_COUNT /api/health'e geçer (bekleyen varsa sağlık 503).
# Kullanım: bash scripts/sunucu/release.sh   (SKIP_GATE=1 yalnız acil düzeltmede)
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p /tmp/emlaksoft-gate
DB_CONTAINER=${DB_CONTAINER:-supabase-db-moqbebljyeyprktd19zb1ihn}
if [ "${SKIP_GATE:-0}" != 1 ]; then
  bash scripts/gate/fast.sh || { echo "Kontrol başarısız:"; tail -25 /tmp/emlaksoft-gate/fast.log; exit 1; }
  tail -1 /tmp/emlaksoft-gate/fast.log
fi

# Prova: yazmaz (ROLLBACK), ledger'a dokunmaz. Bekleyen yoksa tek satır PASS.
set +e
npm run -s db:rehearse -- --yes-i-understand-locks --pending > /tmp/emlaksoft-gate/rehearse.log 2>&1
REHEARSE_RC=$?
set -e
if [ "$REHEARSE_RC" -ne 0 ]; then
  grep -E "\[FAIL\]|ATLANDI|Hata|hata" /tmp/emlaksoft-gate/rehearse.log | head -20 || true
  if [ "${REHEARSE_GATE:-}" = "warn" ]; then
    echo "[uyari] migration provası başarısız (REHEARSE_GATE=warn, yayına devam): /tmp/emlaksoft-gate/rehearse.log"
  else
    echo "Migration provası başarısız (çıkış kodu $REHEARSE_RC) — yayın durduruldu; gerçek migration uygulanmadı (bilinçli geçiş: REHEARSE_GATE=warn)"
    exit 1
  fi
fi
grep -E "\[PASS\] .*bekleyen|2-uygula" /tmp/emlaksoft-gate/rehearse.log | tail -5 || true

if ! npm run -s db:rls-audit > /tmp/emlaksoft-gate/rls-audit.log 2>&1; then
  if [ "${RLS_GATE:-}" = "warn" ]; then
    echo "[uyari] RLS denetimi başarısız (RLS_GATE=warn, yayına devam): /tmp/emlaksoft-gate/rls-audit.log"
  else
    echo "RLS denetimi başarısız — yayın durduruldu; migration uygulanmadı (bilinçli geçiş: RLS_GATE=warn)"
    grep -E "^\[|^   " /tmp/emlaksoft-gate/rls-audit.log | head -30 || true
    exit 1
  fi
fi

# PostgREST DDL izleyicileri: sahibi supabase_admin (yalnız o rol açıp kapatabilir).
pgrst_watch() {
  docker exec "$DB_CONTAINER" psql -U supabase_admin -d postgres -Atq -v ON_ERROR_STOP=1 \
    -c "alter event trigger pgrst_ddl_watch $1" -c "alter event trigger pgrst_drop_watch $1"
}
MIGRATED=0
DEPLOY_STARTED=0
# shellcheck disable=SC2317  # EXIT tuzağıyla dolaylı çağrılır
on_exit() {
  local rc=$?
  pgrst_watch enable || echo "[UYARI] pgrst event trigger'ları yeniden AÇILAMADI: elle 'alter event trigger pgrst_ddl_watch enable' (ve drop_watch)"
  if [ "$MIGRATED" = 1 ] && [ "$DEPLOY_STARTED" = 0 ]; then
    docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atqc "notify pgrst, 'reload schema';" >/dev/null 2>&1 || true
  fi
  return "$rc"
}
trap on_exit EXIT
pgrst_watch disable

# Migration: tam çıktı dosyaya, süzülmüş özet ekrana. grep'in "eşleşme yok" (1) kodu yutulur; db:migrate'inki ASLA.
set +e
npm run -s db:migrate 2>&1 | tee /tmp/emlaksoft-gate/migrate.log | grep -E "tamam|uygulandı|güncel|Hata|hata"
MIGRATE_RC=${PIPESTATUS[0]}
set -e
MIGRATED=1
if [ "$MIGRATE_RC" -ne 0 ]; then
  echo "Migration başarısız (çıkış kodu $MIGRATE_RC) — yayın durduruldu; sürüm işareti, deploy ve push yapılmadı"
  tail -30 /tmp/emlaksoft-gate/migrate.log
  exit "$MIGRATE_RC"
fi
pgrst_watch enable

# Tüm dosyalar ledger'da (bekleyen 0, checksum aynı) + sürüm işareti. Yazmaz.
REL=$(npm run -s check:migrations -- --database --release 2>&1) || {
  echo "Migration ledger denetimi başarısız (bekleyen/drift) — yayın durduruldu"; printf '%s\n' "$REL" | tail -15; exit 1; }
RM=$(printf '%s\n' "$REL" | sed -n 's/^RELEASE_MIGRATION=//p'); RC=$(printf '%s\n' "$REL" | sed -n 's/^RELEASE_MIGRATION_CHECKSUM=//p')
RN=$(printf '%s\n' "$REL" | sed -n 's/^RELEASE_MIGRATION_COUNT=//p')
if [ -z "$RM" ] || [ -z "$RC" ] || [ -z "$RN" ]; then echo "Sürüm işareti hesaplanamadı"; exit 1; fi
sed -i "s/^RELEASE_MIGRATION=.*/RELEASE_MIGRATION=$RM/; s/^RELEASE_MIGRATION_CHECKSUM=.*/RELEASE_MIGRATION_CHECKSUM=$RC/" .env.production
if grep -q '^RELEASE_MIGRATION_COUNT=' .env.production; then
  sed -i "s/^RELEASE_MIGRATION_COUNT=.*/RELEASE_MIGRATION_COUNT=$RN/" .env.production
else
  printf 'RELEASE_MIGRATION_COUNT=%s\n' "$RN" >> .env.production
fi
echo "Sürüm işareti: $RM ($RC, $RN dosya)"

# Deploy: çıktı dosyaya + süzülmüş ekrana; karar deploy.sh'in çıkış kodundan VE sağlık satırından verilir.
DEPLOY_STARTED=1
set +e
bash scripts/sunucu/deploy.sh 2>&1 | tee /tmp/emlaksoft-gate/deploy.log | grep -E "Yayında|\"ok\"|durduruldu|HATA|Error|Bekçi|Geri"
DEPLOY_RC=${PIPESTATUS[0]}
set -e
if [ "$DEPLOY_RC" -ne 0 ] || ! grep -q '"ok":true' /tmp/emlaksoft-gate/deploy.log; then
  echo "Deploy başarısız (çıkış kodu $DEPLOY_RC)"; tail -30 /tmp/emlaksoft-gate/deploy.log; exit 1
fi
git push -q origin HEAD:main && echo "GitHub'a gönderildi: $(git log --oneline -1)"
