-- Rollback: 20260825001300_ownership_transfers (eski taslak adı 20261005000700; 2026-10-05 terfi etti).
-- Elle çalıştırılır; schema_migrations ledger satırına DOKUNMAZ. Yalnız bu migration'ın yarattıklarını kaldırır.
-- Not: kabul edilmiş devirler profil rollerini zaten değiştirmiştir; bu dosya rolleri GERİ ALMAZ.
drop function if exists public.resolve_ownership_transfer(uuid, uuid, uuid, text);
drop function if exists public.accept_ownership_transfer(uuid, uuid, uuid);
drop function if exists public.request_ownership_transfer(uuid, uuid, uuid, text);
drop table if exists public.ownership_transfers;
notify pgrst, 'reload schema';
