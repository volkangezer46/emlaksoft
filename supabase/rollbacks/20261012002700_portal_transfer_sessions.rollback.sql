-- 20261012002700 geri alma: aktarim oturumu tablosu ve RPC'leri kaldirilir. portal_listings kayitlari (baglanmis ilanlar)
-- DEGISMEZ; yalniz oturum gecmisi (olcum) silinir. Kod tablo/RPC yokken "sistem guncellemesi bekleniyor" durumuna duser.
drop function if exists public.pt_record_import(text, jsonb);
drop function if exists public.pt_import_bind(uuid, text, text, text);
drop function if exists public.pt_complete_session(uuid, text, text, text, jsonb);
drop function if exists public.pt_consume_code(text);
drop function if exists public.pt_prepare_session(uuid, text, text, text, text, text[], integer);
drop function if exists public.pt_property_visible(uuid);
drop table if exists public.portal_transfer_sessions;
notify pgrst, 'reload schema';
