-- Geri alma: 20261019070003_feature_request_changelog_link.sql
-- Yalniz baglanti kolonu ve indeksi duser; oneri ve yenilik kayitlari degismez.
set local lock_timeout = '5s';
drop index if exists public.idx_product_feature_requests_changelog;
alter table public.product_feature_requests drop column if exists changelog_entry_id;
