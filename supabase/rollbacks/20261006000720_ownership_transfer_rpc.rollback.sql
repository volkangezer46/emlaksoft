-- Rollback: 20261006000720_ownership_transfer_rpc. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Yalniz 3 JWT kimlikli RPC duser. ownership_transfers tablosu, kayitlari ve 20260825001300'un service_role RPC'leri
-- KALIR. Kabul edilmis devirlerin rolleri geri ALINMAZ (gerekirse /admin ofis sahipligi devri ile duzeltilir).
-- Kod RPC yokken "bu ortamda etkin degil" der (src/app/actions/ownership-transfer.ts).

set local lock_timeout = '5s';

drop function if exists public.ownership_transfer_request(uuid, text);
drop function if exists public.ownership_transfer_accept(uuid);
drop function if exists public.ownership_transfer_resolve(uuid, text);

notify pgrst, 'reload schema';
