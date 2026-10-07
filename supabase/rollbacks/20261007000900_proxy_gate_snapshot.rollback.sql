-- Rollback: 20261007000900_proxy_gate_snapshot
-- Yalniz fonksiyon duser; veri etkilenmez. Proxy kodu RPC yokken eski uc sorguya (profiles/platform_staff/tenants) duser.

set local lock_timeout = '5s';

drop function if exists public.proxy_gate_snapshot(uuid, uuid);

notify pgrst, 'reload schema';
