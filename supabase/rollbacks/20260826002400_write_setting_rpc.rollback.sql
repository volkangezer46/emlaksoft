-- Rollback: 20260826002400_write_setting_rpc. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Kod RPC yokken eski dogrudan-upsert yoluna duser (gecmis satiri yazilmaz; tetikleyici 'dogrudan yazim' isler).
drop function if exists public.write_setting(text, uuid, text, jsonb, boolean, uuid, text, text, text, text, integer);