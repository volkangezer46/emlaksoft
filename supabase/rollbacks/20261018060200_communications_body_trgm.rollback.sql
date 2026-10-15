-- 20261018060200 geri alma: gelen kutusu arama indeksleri duser (arama calismaya devam eder, yalniz yavaslar).
set local lock_timeout = '5s';

drop index if exists public.idx_calls_phone_trgm;
drop index if exists public.idx_communications_contact_trgm;
drop index if exists public.idx_communications_body_trgm;
