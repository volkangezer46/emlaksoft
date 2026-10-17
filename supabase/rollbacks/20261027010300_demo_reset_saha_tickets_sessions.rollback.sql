-- 20261027010300 geri alma: demo_saha_columns 20261024020200 listesine, demo_tenant_nightly_reset 20261026010100 govdesine doner
-- (bayat demo oturumu adimi ve support_tickets [SAHA] kapsami cikar). Silinen [SAHA] test talepleri geri gelmez.

set local lock_timeout = '5s';

create or replace function public.demo_saha_columns()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['customers:full_name', 'properties:title', 'tasks:title', 'expenses:title', 'notifications:title',
               'campaigns:title', 'contracts:title', 'appointments:location', 'appointments:notes', 'offers:notes',
               'customer_demands:notes', 'communications:body', 'deals:notes', 'calls:disposition']::text[];
$$;

revoke all on function public.demo_saha_columns() from public;

create or replace function public.demo_tenant_nightly_reset(p_tenant_id uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slug text;
  v_baseline timestamptz;
  v_table text;
  v_n bigint;
  v_deleted jsonb := '{}'::jsonb;
  v_skipped jsonb := '{}'::jsonb;
  v_result jsonb;
  v_dep text[];
  v_saha jsonb;
  v_restore jsonb;
  -- Dis baglanti yuzeyleri: demo ofiste HIC olmamali (tarih kosulu yok).
  v_outbound text[] := array['webhook_deliveries', 'webhook_endpoints', 'api_keys', 'tenant_integrations'];
  -- Tabandan sonra eklenen is kayitlari; SIRA ONEMLI (once cocuk, sonra ebeveyn).
  v_business text[] := array[
    'document_request_files', 'document_requests', 'rental_inspections', 'rental_applications', 'rental_application_links',
    'notifications', 'communications', 'payment_links', 'deal_notes', 'deal_costs', 'deal_checklist_items', 'deal_process_steps',
    'commission_payouts', 'commission_splits', 'commissions', 'offer_rounds', 'offers', 'contracts',
    'rent_payments', 'rent_charges', 'rent_reminders', 'rentals', 'appointments', 'tasks', 'approval_comments',
    'approval_requests', 'presentations', 'share_links', 'open_houses', 'valuations', 'property_key_events',
    'property_keys', 'customer_demands', 'deals', 'cash_entries', 'expenses', 'campaigns', 'automations',
    'message_templates', 'saved_views', 'targets', 'playbooks', 'projects', 'properties', 'customers'
  ];
  -- Musteri/anlasmaya NO ACTION FK ile bagli bagimli tablolar: {tablo, kolon, ebeveyn}. Tabandan sonra eklenen
  -- ebeveyne bagli satirlar silinir (created_at'e bakilmaz; calls/surveys'te bu kolon yok).
  v_dependents text[] := array[
    'calls:customer_id:customers', 'referrals:created_customer_id:customers', 'referrals:referrer_customer_id:customers',
    'surveys:deal_id:deals', 'surveys:customer_id:customers'
  ];
begin
  if p_tenant_id is null then
    raise exception 'demo_reset_tenant_required';
  end if;
  select t.slug into v_slug from public.tenants t where t.id = p_tenant_id;
  if v_slug is distinct from 'demo-ofis' then
    raise exception 'demo_reset_not_demo_tenant' using errcode = '42501';
  end if;

  select s.baseline_at into v_baseline from public.demo_reset_state s where s.tenant_id = p_tenant_id for update;
  if v_baseline is null then
    insert into public.demo_reset_state(tenant_id, baseline_at, last_reset_at, last_result)
    values (p_tenant_id, p_now, p_now, jsonb_build_object('baseline_set', true))
    on conflict (tenant_id) do update set baseline_at = excluded.baseline_at;
    v_baseline := p_now;
  end if;

  foreach v_table in array v_outbound loop
    if pg_catalog.to_regclass('public.' || v_table) is null then continue; end if;
    begin
      execute format('delete from public.%I where tenant_id = $1', v_table) using p_tenant_id;
      get diagnostics v_n = row_count;
      if v_n > 0 then v_deleted := v_deleted || jsonb_build_object(v_table, v_n); end if;
    exception when others then
      v_skipped := v_skipped || jsonb_build_object(v_table, sqlstate);
    end;
  end loop;

  -- Bildirim okunma durumu (SK5 notification_reads): ziyaretcinin TOHUM bildirimlerinde biraktigi "okundu" izi silinir;
  -- bir sonraki ziyaretci zili ve bildirim listesini tohumdaki gibi okunmamis gorur. Tabandan sonra eklenen bildirimlerin
  -- okumalari zaten notifications silmesiyle (ON DELETE CASCADE) gider. Tablo yoksa (SK5 uygulanmadiysa) atlanir.
  if pg_catalog.to_regclass('public.notification_reads') is not null then
    begin
      execute 'delete from public.notification_reads where tenant_id = $1 and read_at <= $2' using p_tenant_id, p_now;
      get diagnostics v_n = row_count;
      if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('notification_reads', v_n); end if;
    exception when others then
      v_skipped := v_skipped || jsonb_build_object('notification_reads', sqlstate);
    end;
  end if;

  foreach v_table in array v_dependents loop
    v_dep := string_to_array(v_table, ':');
    if pg_catalog.to_regclass('public.' || v_dep[1]) is null then continue; end if;
    if not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = v_dep[1] and c.column_name = v_dep[2]
    ) then continue; end if;
    begin
      execute format(
        'delete from public.%I d where d.tenant_id = $1 and d.%I in '
        || '(select x.id from public.%I x where x.tenant_id = $1 and x.created_at > $2 and x.created_at <= $3)',
        v_dep[1], v_dep[2], v_dep[3]
      ) using p_tenant_id, v_baseline, p_now;
      get diagnostics v_n = row_count;
      if v_n > 0 then
        v_deleted := v_deleted || jsonb_build_object(v_dep[1], coalesce((v_deleted ->> v_dep[1])::bigint, 0) + v_n);
      end if;
    exception when others then
      v_skipped := v_skipped || jsonb_build_object(v_dep[1] || '.' || v_dep[2], sqlstate);
    end;
  end loop;

  foreach v_table in array v_business loop
    if pg_catalog.to_regclass('public.' || v_table) is null then continue; end if;
    if not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = v_table and c.column_name = 'created_at'
    ) then continue; end if;
    begin
      execute format('delete from public.%I where tenant_id = $1 and created_at > $2 and created_at <= $3', v_table)
        using p_tenant_id, v_baseline, p_now;
      get diagnostics v_n = row_count;
      if v_n > 0 then v_deleted := v_deleted || jsonb_build_object(v_table, v_n); end if;
    exception when others then
      v_skipped := v_skipped || jsonb_build_object(v_table, sqlstate);
    end;
  end loop;

  -- Finans butcesi (20261026010100): tabloda created_at yok; tabandan sonra eklenen ya da duzenlenen satir updated_at ile
  -- silinir, tohum satiri asagidaki goruntu geri yuklemesiyle ayni kimlikle geri gelir.
  if pg_catalog.to_regclass('public.finance_budgets') is not null and exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'finance_budgets' and c.column_name = 'updated_at'
  ) then
    begin
      execute 'delete from public.finance_budgets where tenant_id = $1 and updated_at > $2 and updated_at <= $3'
        using p_tenant_id, v_baseline, p_now;
      get diagnostics v_n = row_count;
      if v_n > 0 then v_deleted := v_deleted || jsonb_build_object('finance_budgets', v_n); end if;
    exception when others then
      v_skipped := v_skipped || jsonb_build_object('finance_budgets', sqlstate);
    end;
  end if;

  -- [SAHA] test kalintilari (20261024020200): saha test duzenekleri artik ayri QA ofisini hedefler; demo ofiste kalanlar
  -- her gece temizlenir (silinemiyorsa yumusak silinir). Sayilar sonuca 'saha' olarak yazilir.
  v_saha := public.demo_tenant_saha_cleanup(p_tenant_id, p_now, false);
  if coalesce((v_saha ->> 'total')::bigint, 0) > 0 then
    v_deleted := v_deleted || jsonb_build_object('saha', v_saha -> 'tables');
  end if;

  -- Tohum geri yukleme (20261024020200): taban aninda alinan anlik goruntu varsa ziyaretcinin TOHUM kayitlarinda yaptigi
  -- degisiklik (asama, fiyat, silme...) geri alinir; silinen tohum satiri yeniden eklenir. Goruntu yoksa adim atlanir.
  v_restore := public.demo_tenant_restore_snapshot(p_tenant_id);
  if coalesce((v_restore ->> 'total')::bigint, 0) > 0 or coalesce((v_restore ->> 'failed')::bigint, 0) > 0 then
    v_deleted := v_deleted || jsonb_build_object('restored', v_restore);
  end if;

  v_result := jsonb_build_object('baseline_at', v_baseline, 'deleted', v_deleted, 'skipped', v_skipped);
  update public.demo_reset_state set last_reset_at = p_now, last_result = v_result where tenant_id = p_tenant_id;
  return v_result;
end;
$$;

revoke all on function public.demo_tenant_nightly_reset(uuid, timestamptz) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.demo_tenant_nightly_reset(uuid, timestamptz) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.demo_tenant_nightly_reset(uuid, timestamptz) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.demo_tenant_nightly_reset(uuid, timestamptz) to service_role';
  end if;
end $$;

comment on function public.demo_tenant_nightly_reset(uuid, timestamptz) is
  'YD1 + 20261024020200 + 20261026010100 (kayit modulleri): yalniz slug=demo-ofis; dis baglanti yuzeyleri, tabandan sonra eklenen is kayitlari, [SAHA] kalintilari silinir; tohum anlik goruntuden geri yuklenir (pristine). Gercek kiracida hata verir.';
