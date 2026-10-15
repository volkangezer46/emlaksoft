-- MIGRATION 20261018060200_communications_body_trgm.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- Geri alma: supabase/rollbacks/20261018060200_communications_body_trgm.rollback.sql
-- BAGIMLILIK: pg_trgm eklentisi (canli: schema `public`; 20261010000200 ile ayni varsayim), public.communications,
--   public.calls.
--
-- AMAC (COM-10): gelen kutusu aramasi artik mesaj icerigi (communications.body) ve numara (communications.contact_address,
--   calls.phone) uzerinde de `ilike '%q%'` yapar. Buyuk kiracida seq scan olmasin diye GIN trigram indeksleri.
-- NOT: runner tek transaction'da calistigi icin CONCURRENTLY YOK.
-- ETKI: ek (yalniz indeks; tablo/veri/politika degismez; yazma maliyeti hafif artar).
set local lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_trgm') then
    raise exception 'pg_trgm eklentisi yok; once create extension pg_trgm.';
  end if;
end $$;

create index if not exists idx_communications_body_trgm on public.communications using gin (body public.gin_trgm_ops);
create index if not exists idx_communications_contact_trgm on public.communications using gin (contact_address public.gin_trgm_ops);
create index if not exists idx_calls_phone_trgm on public.calls using gin (phone public.gin_trgm_ops);
