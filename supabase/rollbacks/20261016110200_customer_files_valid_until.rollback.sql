-- Geri alma: 20261016110200_customer_files_valid_until.sql
-- Girilen belge gecerlilik tarihleri KAYBOLUR. Kod sutun yokken listeyi tarihsiz gosterir; document_expiry@1 "etkin degil" sayilir.
set local lock_timeout = '5s';
drop index if exists public.idx_customer_files_valid_until;
alter table public.customer_files drop column if exists valid_until;
notify pgrst, 'reload schema';
