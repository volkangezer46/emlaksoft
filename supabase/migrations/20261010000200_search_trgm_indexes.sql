-- MIGRATION 20261010000200_search_trgm_indexes.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261010000200_search_trgm_indexes.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261010000200_search_trgm_indexes.rollback.sql
-- BAGIMLILIK: pg_trgm eklentisi (canli: schema `public`; `public.gin_trgm_ops`), public.customers, public.properties.
--
-- AMAC (buyume hazirligi): musteri / portfoy / talep listelerinin ve komut paletinin `ilike '%q%'` aramalari
--   bugun seq scan (btree ilike'i cozmez). Kiraci basina binlerce kayitta GIN trigram indeksi gerekir.
--   Taslak: supabase/proposed/20260814b_perf_indexes_measured.sql (A ve B bolumleri); kolonlar koddan DOGRULANDI:
--     customers  full_name, phone, email   <- src/lib/customer-list-filters.ts (liste, OR), src/app/actions/search.ts,
--                                              src/app/actions/lookup.ts, src/lib/list-search.ts (talep listesi full_name)
--     properties title, property_code, address_line <- src/app/app/portfoyler/page.tsx (orIlike), lookup.ts, list-search.ts
--   OR'un tek kolonu bile indekssiz ise planlayici tum OR'u seq scan'e dusurur; bu yuzden her OR'un tum kolonlari indekslenir.
--   Taslaktan FARK: kismi (partial) indeks YOK. Sorgularin bir kismi (gelen-kutusu gomme aramasi, komut paleti)
--   `deleted_at is null` eklemez ve kismi indeks dis kosulu kanitlayamadan kullanilamaz; tablolar kucuk, sisme ihmal edilebilir.
-- NOT: runner tek transaction'da calistigi icin CONCURRENTLY YOK (tablolar < 1 MB, kilit suresi ms). Duz IF NOT EXISTS.
-- ETKI: yalniz 6 yeni indeks; tablo/veri/politika degismez. Yazma maliyeti kucuk (musteri/ilan yazimi seyrek).

set local lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_trgm') then
    raise exception 'pg_trgm eklentisi yok; once create extension pg_trgm.';
  end if;
  if pg_catalog.to_regclass('public.customers') is null or pg_catalog.to_regclass('public.properties') is null then
    raise exception 'public.customers/properties yok.';
  end if;
end $$;

create index if not exists idx_customers_full_name_trgm on public.customers using gin (full_name public.gin_trgm_ops);
create index if not exists idx_customers_phone_trgm on public.customers using gin (phone public.gin_trgm_ops);
create index if not exists idx_customers_email_trgm on public.customers using gin (email public.gin_trgm_ops);

create index if not exists idx_properties_title_trgm on public.properties using gin (title public.gin_trgm_ops);
create index if not exists idx_properties_code_trgm on public.properties using gin (property_code public.gin_trgm_ops);
create index if not exists idx_properties_address_trgm on public.properties using gin (address_line public.gin_trgm_ops);
