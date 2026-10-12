-- MIGRATION 20261012002210_search_trgm_tasks_docs.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261012002210_search_trgm_tasks_docs.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261012002210_search_trgm_tasks_docs.rollback.sql
-- BAGIMLILIK: pg_trgm eklentisi (`public.gin_trgm_ops`; 20261010000200 ile ayni), public.tasks, public.customer_files,
--   public.property_media, public.contracts, public.deal_checklist_items.
--
-- AMAC (HIZ-2): gorev ve belge listesi aramalari `ilike '%q%'` (or) ile seq scan'e dusuyordu. OR'un tek kolonu bile
--   indekssiz ise planlayici tum OR'u seq scan'e dusurur; bu yuzden her OR'un tum kolonlari indekslenir.
--   Kolonlar koddan DOGRULANDI:
--     tasks               title, notes            <- src/app/app/gorevler/page.tsx (orIlike)
--     customer_files      file_name, label        <- src/app/app/belgeler/page.tsx (musteri)
--     property_media      file_name               <- belgeler/page.tsx (portfoy)
--     contracts           title                   <- belgeler/page.tsx (sozlesme)
--     deal_checklist_items label, file_url        <- belgeler/page.tsx (evrak)
-- NOT: runner tek transaction'da calistigi icin CONCURRENTLY YOK; kismi indeks YOK (20261010000200 ile ayni gerekce).
-- ETKI: yalniz 8 yeni indeks; tablo/veri/politika degismez. Yazma maliyeti kucuk.

set local lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_trgm') then
    raise exception 'pg_trgm eklentisi yok; once create extension pg_trgm.';
  end if;
  if pg_catalog.to_regclass('public.tasks') is null or pg_catalog.to_regclass('public.customer_files') is null
     or pg_catalog.to_regclass('public.property_media') is null or pg_catalog.to_regclass('public.contracts') is null
     or pg_catalog.to_regclass('public.deal_checklist_items') is null then
    raise exception 'tasks/customer_files/property_media/contracts/deal_checklist_items tablolarindan biri yok.';
  end if;
end $$;

create index if not exists idx_tasks_title_trgm on public.tasks using gin (title public.gin_trgm_ops);
create index if not exists idx_tasks_notes_trgm on public.tasks using gin (notes public.gin_trgm_ops);

create index if not exists idx_customer_files_file_name_trgm on public.customer_files using gin (file_name public.gin_trgm_ops);
create index if not exists idx_customer_files_label_trgm on public.customer_files using gin (label public.gin_trgm_ops);
create index if not exists idx_property_media_file_name_trgm on public.property_media using gin (file_name public.gin_trgm_ops);
create index if not exists idx_contracts_title_trgm on public.contracts using gin (title public.gin_trgm_ops);
create index if not exists idx_deal_checklist_items_label_trgm on public.deal_checklist_items using gin (label public.gin_trgm_ops);
create index if not exists idx_deal_checklist_items_file_url_trgm on public.deal_checklist_items using gin (file_url public.gin_trgm_ops);
