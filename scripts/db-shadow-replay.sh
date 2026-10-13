#!/usr/bin/env bash
# Gölge migration replay'i: sıfırdan kurulan bir Supabase Postgres'e TÜM
# supabase/migrations/*.sql dosyalarını uygular ve yetki (ACL) dökümünü çıkarır.
#
# Kullanım: bash scripts/db-shadow-replay.sh <çıktı-dizini> [--keep]
#   <çıktı-dizini>/function-acl.tsv  public fonksiyonlar: oid::regprocedure \t ACL (NULL ise acldefault)
#   <çıktı-dizini>/relation-acl.tsv  public tablo/görünüm/dizi: relname \t relkind \t ACL
#   <çıktı-dizini>/replay.log        dosya başına uygulama günlüğü (+ gotrue/storage göç günlükleri)
#   --keep  konteyneri bırakır (gölgede ek doğrulama için); soket yolu ve
#           konteyner adı yazdırılır, iş bitince `docker rm -f <ad>`.
# Son adımda gölgenin kendisine `check:acl` koşar (anon kabul listesi + kendi
# dökümüyle sapma = 0); hata varsa betik 1 ile çıkar. Canlı ↔ gölge sapması:
#   npm run check:acl -- --container <canlı-db> --shadow <çıktı-dizini>
#
# CANLIYA DOKUNMAZ: konteyner `--network none` ile başlar, bağlantı yalnız
# çıktı dizinine bağlanan unix soketi üzerinden kurulur. .env.local'deki
# DATABASE_URL hiç okunmaz. GoTrue/Storage göç konteynerleri gölgenin ağ ad
# alanını paylaşır (yalnız loopback).
#
# Neden `npm run db:migrate` değil: runner'ın şema-kanıtı yoklamaları
# (SCHEMA_EVIDENCE_PROBES) boş veritabanında `'public.deals'::regclass` ile
# patlar; yani runner sıfırdan kuruluma bağlanamaz. Bu betik runner'ın
# uygulama biçimini birebir taklit eder: dosya adı sırası (localeCompare 'en'),
# dosya başına `begin; <dosyanın tamamı tek simple query>; commit;`, oturum
# rolü postgres, ledger tablosu runner'daki yetkilerle. Boş veritabanında
# tarihsel olarak hiç çalışamamış 2 dosya gerekçeli listeyle atlanır (ATLANDI).
set -euo pipefail

OUT=${1:?"kullanım: db-shadow-replay.sh <çıktı-dizini> [--keep]"}
KEEP=0
[[ "${2:-}" == "--keep" ]] && KEEP=1
IMG=supabase/postgres:17.6.1.178
GOTRUE_IMG=supabase/gotrue:v2.197.0 # canlıdaki auth servisiyle aynı sürüm
STORAGE_IMG=supabase/storage-api:v1.80.2 # canlıdaki storage servisiyle aynı sürüm
ROOT=$(cd "$(dirname "$0")/.." && pwd)

mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
SOCK="$OUT/sock"
mkdir -p "$SOCK"
chmod 777 "$SOCK"
NAME="emlaksoft-shadow-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"

cleanup() {
  if [[ $KEEP -eq 0 ]]; then docker rm -f "$NAME" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

docker run -d --rm --name "$NAME" --network none \
  -e POSTGRES_PASSWORD="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')" \
  -v "$SOCK":/var/run/postgresql "$IMG" >/dev/null

# İmajın init'i (roller, auth/storage şemaları, varsayılan yetkiler) geçici bir
# sunucuda koşar; pg_isready o sırada da "hazır" der. Asıl sunucuyu bekle.
for _ in $(seq 1 120); do
  if docker logs "$NAME" 2>&1 | grep -q "PostgreSQL init process complete" \
    && docker exec "$NAME" pg_isready -h /var/run/postgresql -U supabase_admin >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$NAME" pg_isready -h /var/run/postgresql -U supabase_admin >/dev/null

# auth.jwt(), auth.sessions vb. GoTrue'nun kendi göçleriyle gelir (canlıda auth
# servisi kurar). Aynı sürümün `auth migrate`'i gölgenin ağ ad alanında koşar
# (yalnız loopback; 127.0.0.1 imajın pg_hba'sında trust) — dış ağ yok.
docker run --rm --network "container:$NAME" \
  -e GOTRUE_DB_DRIVER=postgres \
  -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin@127.0.0.1:5432/postgres?sslmode=disable" \
  -e API_EXTERNAL_URL=http://localhost -e GOTRUE_SITE_URL=http://localhost \
  -e GOTRUE_JWT_SECRET=shadow-only-not-a-secret-0123456789abcdef \
  "$GOTRUE_IMG" auth migrate >"$OUT/gotrue-migrate.log" 2>&1 \
  || { tail -20 "$OUT/gotrue-migrate.log"; exit 1; }

# storage.buckets/objects sütunları da Storage servisinin göçleriyle gelir.
docker run --rm --network "container:$NAME" \
  -e DATABASE_URL="postgres://supabase_storage_admin@127.0.0.1:5432/postgres?sslmode=disable" \
  -e DB_INSTALL_ROLES=false -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/tmp \
  -e TENANT_ID=shadow -e REGION=local -e GLOBAL_S3_BUCKET=shadow \
  -e AUTH_JWT_SECRET=shadow-only-not-a-secret-0123456789abcdef \
  -e PGRST_JWT_SECRET=shadow-only-not-a-secret-0123456789abcdef \
  -e ANON_KEY=shadow -e SERVICE_KEY=shadow \
  "$STORAGE_IMG" node dist/scripts/migrate-call.js >"$OUT/storage-migrate.log" 2>&1 \
  || { tail -20 "$OUT/storage-migrate.log"; exit 1; }

# supabase_admin yerel sokette trust; oturum rolü canlıdaki runner gibi postgres.
export SHADOW_URL="postgresql://supabase_admin@localhost/postgres?host=$SOCK&sslmode=disable&options=-c%20role%3Dpostgres"

cd "$ROOT"
node - >"$OUT/replay.log" 2>&1 <<'NODE' || { tail -20 "$OUT/replay.log"; exit 1; }
const fs = require("node:fs");
const path = require("node:path");
const pg = require(path.join(process.cwd(), "node_modules", "pg"));
(async () => {
  const c = new pg.Client({ connectionString: process.env.SHADOW_URL });
  await c.connect();
  const dir = "supabase/migrations";
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort((a, b) => a.localeCompare(b, "en"));
  await c.query(`create table if not exists public.schema_migrations (
    version text primary key, checksum text not null, applied_at timestamptz not null default now())`);
  await c.query(`revoke all on table public.schema_migrations from anon, authenticated;
    grant select on table public.schema_migrations to service_role`);
  // Tarihsel olarak boş veritabanında HİÇ çalışamamış dosyalar: canlı ledger'a
  // elle işlenmiş, etkileri sonraki düzeltme dosyalarında yeniden kurulmuş.
  // Şema/ACL etkileri yoktur; gölgede atlanır ve günlükte "ATLANDI" yazar.
  const KNOWN_UNREPLAYABLE = new Map([
    // DO bloğu `text = text[]` karşılaştırması yüzünden her zaman hata verir;
    // geriye kalan tek etkisi pg_stat_statements eklenti yorumu.
    ["20260722000011_permission_tests.sql", "sembolik test bloğu her kurulumda hata verir"],
    // Var olmayan portal_closures tablosunu değiştirir; 20260722000019_leak_sla_fix.sql
    // aynı sütunları doğru tabloya ekler.
    ["20260722000012_leak_sla.sql", "var olmayan tabloya yazar; 000019 düzeltir"],
  ]);
  let applied = 0;
  for (const f of files) {
    if (KNOWN_UNREPLAYABLE.has(f)) {
      console.log("ATLANDI", f, "-", KNOWN_UNREPLAYABLE.get(f));
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    await c.query("begin");
    try {
      await c.query(sql);
      await c.query("insert into public.schema_migrations(version, checksum) values ($1, 'shadow')", [f]);
      await c.query("commit");
      console.log("tamam", f);
      applied += 1;
    } catch (err) {
      await c.query("rollback");
      console.log("HATA", f, String(err && err.message).slice(0, 400));
      process.exitCode = 1;
      // SHADOW_CONTINUE=1: teşhis için hatadan sonra devam et (zincir sonucu güvenilmez).
      if (process.env.SHADOW_CONTINUE !== "1") break;
    }
  }
  console.log(`uygulandı: ${applied}/${files.length} dosya (${KNOWN_UNREPLAYABLE.size} bilinen atlama)`);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
NODE

# ACL dökümü: sorgular tek kaynakta (scripts/check-function-acl.ts), salt-okunur oturum.
npx tsx scripts/check-function-acl.ts --container "$NAME" --dump "$OUT"

echo "gölge replay tamam: $(grep -c '^tamam' "$OUT/replay.log") migration" \
  "($(grep -c '^ATLANDI' "$OUT/replay.log") bilinen atlama);" \
  "$(wc -l <"$OUT/function-acl.tsv") fonksiyon, $(wc -l <"$OUT/relation-acl.tsv") ilişki → $OUT"

# Gölgenin kendi ACL kapısı: anon kabul listesi + döküm sapması 0 olmalı.
npx tsx scripts/check-function-acl.ts --container "$NAME" --shadow "$OUT"
if [[ $KEEP -eq 1 ]]; then
  echo "konteyner açık bırakıldı: $NAME (soket: $SOCK)"
  echo "  docker exec -it $NAME psql -h /var/run/postgresql -U supabase_admin -d postgres"
  echo "  iş bitince: docker rm -f $NAME"
fi
