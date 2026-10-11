-- 20261012000900 geri alma. ON KOSUL: rent-receipts kovasindaki nesneler once Storage panelinden/API'den silinmeli
-- (kova satiri, icinde nesne varken silinemez).
drop function if exists public.portal_rent_receipt_target(text, uuid);
alter table public.rent_payment_notices drop constraint if exists rent_payment_notices_receipt_check;
alter table public.rent_payment_notices
  drop column if exists receipt_path,
  drop column if exists receipt_name,
  drop column if exists receipt_mime,
  drop column if exists receipt_size,
  drop column if exists receipt_status,
  drop column if exists receipt_prepared_at;
delete from storage.buckets where id = 'rent-receipts';
