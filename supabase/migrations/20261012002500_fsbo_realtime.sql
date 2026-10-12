-- MIGRATION 20261012002500_fsbo_realtime.sql
-- Sahibinden ilanlar (FSBO) v2: (1) fsbo_leads realtime yayınına eklenir (başka danışmanın değişikliği sayfa yenilenmeden görünür);
-- (2) FSBO ilan kartı olay anında kapatma: dar SECURITY DEFINER RPC insight_close_fsbo_lead (yalnız valid_until yazar).
-- Realtime RLS'e tabidir; istemci tenant_id=eq süzer. İdempotent. Tablo/veri değişmez.
-- RPC yoksa kod hatayı yutar; kart bir sonraki motor turunda kapanır (davranış kaybı yok).

set local lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime yayını yok; atlandı';
    return;
  end if;
  if pg_catalog.to_regclass('public.fsbo_leads') is not null
     and not exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fsbo_leads') then
    alter publication supabase_realtime add table public.fsbo_leads;
  end if;
end
$$;

create or replace function public.insight_close_fsbo_lead(p_lead_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_rows integer := 0;
begin
  if v_uid is null or v_tenant is null or p_lead_id is null then
    return 0;
  end if;
  if pg_catalog.to_regclass('public.fsbo_leads') is null then
    return 0;
  end if;
  if not exists (
    select 1 from public.fsbo_leads l where l.id = p_lead_id and l.tenant_id = v_tenant
  ) then
    return 0;
  end if;

  update public.insights i
     set valid_until = pg_catalog.now()
   where i.tenant_id = v_tenant
     and i.kind = 'call_priority'
     and i.entity_type = 'fsbo_lead'
     and i.entity_id = p_lead_id
     and i.state in ('new', 'seen', 'snoozed')
     and i.valid_until > pg_catalog.now();
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.insight_close_fsbo_lead(uuid) from public, anon;
grant execute on function public.insight_close_fsbo_lead(uuid) to authenticated;

notify pgrst, 'reload schema';

-- DOGRULAMA (salt-okunur):
-- select proname, prosecdef from pg_proc where proname = 'insight_close_fsbo_lead';
-- select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='fsbo_leads';
