-- Rollback: 20261007000320_webhooks_api_keys
-- API anahtarlari, webhook uclari ve teslim kuyrugu SILINIR (anahtarlar kalici gecersiz olur). Once dokum alin:
--   select id, tenant_id, name, key_prefix, scopes, created_at, revoked_at from public.api_keys;
--   select * from public.webhook_endpoints;
drop function if exists public.api_v1_list(text, text, integer, timestamptz);
drop function if exists public.webhook_mark_delivery(uuid, boolean, integer, text);
drop function if exists public.webhook_enqueue(text, text, uuid);
drop table if exists public.webhook_deliveries;
drop table if exists public.webhook_endpoints;
drop table if exists public.api_keys;
notify pgrst, 'reload schema';
