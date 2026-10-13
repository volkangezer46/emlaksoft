#!/bin/bash
# Tek komutla yayın: hızlı kontrol (scripts/gate/fast.sh) → migration'lar (npm run db:migrate) → .env.production
# RELEASE_MIGRATION(_CHECKSUM) güncellemesi → deploy (Docker build + sağlık) → git push. Herhangi bir adım başarısızsa durur.
# Kullanım: bash scripts/sunucu/release.sh   (SKIP_GATE=1 yalnız acil düzeltmede)
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ "${SKIP_GATE:-0}" != 1 ]; then
  bash scripts/gate/fast.sh || { echo "Kontrol başarısız:"; tail -25 /tmp/emlaksoft-gate/fast.log; exit 1; }
  tail -1 /tmp/emlaksoft-gate/fast.log
fi
npm run -s db:migrate 2>&1 | grep -E "tamam|uygulandı|güncel|Hata|hata" || true
docker exec supabase-db-moqbebljyeyprktd19zb1ihn psql -U postgres -d postgres -Atc "notify pgrst, 'reload schema';" >/dev/null
REL=$(npm run -s check:migrations -- --release 2>/dev/null)
RM=$(printf '%s\n' "$REL" | sed -n 's/^RELEASE_MIGRATION=//p'); RC=$(printf '%s\n' "$REL" | sed -n 's/^RELEASE_MIGRATION_CHECKSUM=//p')
[ -n "$RM" ] && [ -n "$RC" ] || { echo "Sürüm işareti hesaplanamadı"; exit 1; }
sed -i "s/^RELEASE_MIGRATION=.*/RELEASE_MIGRATION=$RM/; s/^RELEASE_MIGRATION_CHECKSUM=.*/RELEASE_MIGRATION_CHECKSUM=$RC/" .env.production
echo "Sürüm işareti: $RM ($RC)"
bash scripts/sunucu/deploy.sh 2>&1 | tee /tmp/emlaksoft-gate/deploy.log | grep -E "Yayında|\"ok\"|durduruldu|HATA|Error" || true
grep -q '"ok":true' /tmp/emlaksoft-gate/deploy.log || { echo "Deploy başarısız"; tail -30 /tmp/emlaksoft-gate/deploy.log; exit 1; }
git push -q origin HEAD:main && echo "GitHub'a gönderildi: $(git log --oneline -1)"
