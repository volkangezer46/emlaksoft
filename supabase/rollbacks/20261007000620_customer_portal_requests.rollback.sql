-- Rollback: 20261007000620_customer_portal_requests
-- Müşteri portalı yazma RPC'si ve istek izi tablosu düşer. Portaldan oluşmuş teklif (taslak), görev ve bakım talebi
-- kayıtları SİLİNMEZ (ofisin iş kayıtlarıdır). Kod RPC yokken formları göstermez (yoklama).

set local lock_timeout = '5s';

drop function if exists public.portal_customer_request(text, text, jsonb);
drop function if exists public.portal_customer_request_ready();
drop table if exists public.portal_customer_requests;

notify pgrst, 'reload schema';
