-- Olay anında kapatma: müşteriyle temas (arama / iletişim kaydı) girilince o müşterinin AÇIK "Bugün ara"
-- (call_priority) önerileri motor turunu (30 dk) beklemeden kapanır.
--
-- Neden RPC: insights tablosuna doğrudan yazma yoktur (yalnız service_role). Sözleşme (insights-contract.test.ts)
-- insights kodunda createAdminClient'i yasaklar; bu yüzden dar, SECURITY DEFINER bir fonksiyon açılır.
-- Kapsam: yalnız çağıranın ofisi (current_tenant_id) + yalnız kind='call_priority' + müşteri o ofise ait + yalnız AÇIK satırlar.
-- Yazılan tek alan valid_until = now(); state / state_reason DEĞİŞMEZ (kalite sayaçları kirlenmez).
-- Fonksiyon yoksa (bu migration uygulanmadıysa) kod hatayı yutar; öneri bir sonraki motor turunda kapanır (davranış kaybı yok).

create or replace function public.insight_close_call_priority(p_customer_id uuid)
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
  if v_uid is null or v_tenant is null or p_customer_id is null then
    return 0;
  end if;
  if not exists (
    select 1 from public.customers c where c.id = p_customer_id and c.tenant_id = v_tenant
  ) then
    return 0;
  end if;

  update public.insights i
     set valid_until = pg_catalog.now()
   where i.tenant_id = v_tenant
     and i.kind = 'call_priority'
     and i.entity_type = 'customer'
     and i.entity_id = p_customer_id
     and i.state in ('new', 'seen', 'snoozed')
     and i.valid_until > pg_catalog.now();
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.insight_close_call_priority(uuid) from public, anon;
grant execute on function public.insight_close_call_priority(uuid) to authenticated;

notify pgrst, 'reload schema';

-- DOGRULAMA (salt-okunur):
-- select proname, prosecdef from pg_proc where proname = 'insight_close_call_priority';
