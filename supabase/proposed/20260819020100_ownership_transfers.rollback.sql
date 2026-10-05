-- TASLAK geri alma: 20260819020100_ownership_transfers.sql. Yalnız bu taslağın yarattıklarını kaldırır.
-- Not: kabul edilmiş devirler profil rollerini zaten değiştirmiştir; bu dosya rolleri GERİ ALMAZ.
drop function if exists public.resolve_ownership_transfer(uuid, uuid, uuid, text);
drop function if exists public.accept_ownership_transfer(uuid, uuid, uuid);
drop function if exists public.request_ownership_transfer(uuid, uuid, uuid, text);
drop table if exists public.ownership_transfers;
notify pgrst, 'reload schema';
