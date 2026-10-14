-- MIGRATION 20261015015000_agent_photos_bucket_limits.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular (gölgede denendi).
-- Geri alma: supabase/rollbacks/20261015015000_agent_photos_bucket_limits.rollback.sql (sinirlar NULL'a doner).
-- BAGIMLILIK: 20260728000118_agent_public_profile.sql (agent-photos kovasi, public).
--
-- AMAC (KQ2, depolama yuzeyi): agent-photos kovasi sinirsizdi (file_size_limit/allowed_mime_types NULL): public kovaya
--   service role disinda bir yol acilirsa her boyut/tur kabul edilirdi. Uygulama zaten 3 MB + jpeg/png/webp dogruluyor
--   (src/app/actions/agent-profile.ts PHOTO_MAX_SIZE / PHOTO_ALLOWED, icerik imzasi verifyImageFile); kova ayni siniri
--   Storage katmaninda da uygular. Mevcut nesneler etkilenmez (sinir yalniz yeni yuklemede denetlenir).
-- public bayragi DEGISMEZ. Kova yoksa (yalin Postgres) atlanir. Idempotent.
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is null then
    raise notice 'KQ2: storage.buckets yok, atlandi';
    return;
  end if;
  update storage.buckets
     set file_size_limit = 3145728,
         allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
   where id = 'agent-photos';
end $$;
