#!/bin/bash
# Tek komutla yayın: hızlı kontrol (scripts/gate/fast.sh) → migration'lar (npm run db:migrate) → .env.production
# RELEASE_MIGRATION(_CHECKSUM) güncellemesi → deploy (Docker build + sağlık) → git push. Herhangi bir adım başarısızsa durur.
# Migration adımı (KQ4): db:migrate çıktısı yalnız süzülerek gösterilir, ÇIKIŞ KODU korunur (PIPESTATUS); migration
# düşerse sürüm işareti yazılmaz, deploy ve push yapılmaz, betik sıfırdan farklı kodla biter. Tam çıktı:
# /tmp/emlaksoft-gate/migrate.log. Geri dönüş: docs/runbooks/GERI_DONUS.md (scripts/sunucu/rollback.sh).
# Kullanım: bash scripts/sunucu/release.sh   (SKIP_GATE=1 yalnız acil düzeltmede)
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p /tmp/emlaksoft-gate
if [ "${SKIP_GATE:-0}" != 1 ]; then
  bash scripts/gate/fast.sh || { echo "Kontrol başarısız:"; tail -25 /tmp/emlaksoft-gate/fast.log; exit 1; }
  tail -1 /tmp/emlaksoft-gate/fast.log
fi

# Migration: tam çıktı dosyaya, süzülmüş özet ekrana. grep'in "eşleşme yok" (1) kodu yutulur; db:migrate'inki ASLA.
set +e
npm run -s db:migrate 2>&1 | tee /tmp/emlaksoft-gate/migrate.log | grep -E "tamam|uygulandı|güncel|Hata|hata"
MIGRATE_RC=${PIPESTATUS[0]}
set -e
if [ "$MIGRATE_RC" -ne 0 ]; then
  echo "Migration başarısız (çıkış kodu $MIGRATE_RC) — yayın durduruldu; sürüm işareti, deploy ve push yapılmadı"
  tail -30 /tmp/emlaksoft-gate/migrate.log
  exit "$MIGRATE_RC"
fi

docker exec supabase-db-moqbebljyeyprktd19zb1ihn psql -U postgres -d postgres -Atc "notify pgrst, 'reload schema';" >/dev/null
REL=$(npm run -s check:migrations -- --release 2>/dev/null)
RM=$(printf '%s\n' "$REL" | sed -n 's/^RELEASE_MIGRATION=//p'); RC=$(printf '%s\n' "$REL" | sed -n 's/^RELEASE_MIGRATION_CHECKSUM=//p')
if [ -z "$RM" ] || [ -z "$RC" ]; then echo "Sürüm işareti hesaplanamadı"; exit 1; fi
sed -i "s/^RELEASE_MIGRATION=.*/RELEASE_MIGRATION=$RM/; s/^RELEASE_MIGRATION_CHECKSUM=.*/RELEASE_MIGRATION_CHECKSUM=$RC/" .env.production
echo "Sürüm işareti: $RM ($RC)"

# Deploy: çıktı dosyaya + süzülmüş ekrana; karar deploy.sh'in çıkış kodundan VE sağlık satırından verilir.
set +e
bash scripts/sunucu/deploy.sh 2>&1 | tee /tmp/emlaksoft-gate/deploy.log | grep -E "Yayında|\"ok\"|durduruldu|HATA|Error"
DEPLOY_RC=${PIPESTATUS[0]}
set -e
if [ "$DEPLOY_RC" -ne 0 ] || ! grep -q '"ok":true' /tmp/emlaksoft-gate/deploy.log; then
  echo "Deploy başarısız (çıkış kodu $DEPLOY_RC)"; tail -30 /tmp/emlaksoft-gate/deploy.log; exit 1
fi
git push -q origin HEAD:main && echo "GitHub'a gönderildi: $(git log --oneline -1)"
