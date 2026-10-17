-- 20261027010200 geri alma: purge_tenant_sample_data v2 govdesine (20261024020000) doner; gercek cocuk on kontrol fonksiyonu duser.

set local lock_timeout = '5s';

create or replace function public.purge_tenant_sample_data(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_service boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  v_counts jsonb := '{}'::jsonb;
  v_n int;
  v_slug text;
  v_spec text[];
  v_pid uuid;
  v_removed uuid[] := '{}';
  v_kept uuid[] := '{}';
  -- Istege bagli ornek tablolari {tablo, kosul}: tablo/sutun yoksa atlanir (eski ortam). Kosul yalniz sabit metindir.
  -- Sira: cocuk -> ebeveyn. compliance_ledger_entries BILEREK yok (yasal defter, append-only; ornek tohum yazmaz).
  v_optional text[] := array[
    'rental_inspections:is_sample',
    'rental_applications:is_sample',
    'rental_application_links:is_sample',
    'document_request_files:is_sample',
    'document_requests:is_sample',
    'deal_stage_events:is_sample',
    'fsbo_leads:is_sample',
    'buildings:marker:notes',
    'league_challenges:marker:description',
    'advisor_specialties:is_sample',
    'advisor_regions:is_sample',
    'cash_entries:is_sample',
    'recurring_rules:is_sample',
    'finance_accounts:is_sample',
    'expense_budgets:is_sample',
    'finance_open_items:is_sample',
    'finance_parties:is_sample',
    'finance_budgets:is_sample'
  ];
begin
  if p_tenant_id is null then
    raise exception 'ofis kimligi gerekli' using errcode = '22023';
  end if;

  -- Yetki: service_role ya da ofisin owner/gm uyesi. Baska rol / baska ofis -> hata (sessiz bosluk yok).
  if not v_is_service then
    if v_uid is null or not exists (
      select 1 from public.profiles p
      where p.id = v_uid and p.tenant_id = p_tenant_id and p.is_active and p.role in ('owner', 'gm') and p.is_sample = false
    ) then
      raise exception 'Bu islem yalniz ofis sahibi veya genel mudur tarafindan yapilabilir.' using errcode = '42501';
    end if;
  end if;

  select t.slug into v_slug from public.tenants t where t.id = p_tenant_id for update;
  if v_slug = 'demo-ofis' then
    raise exception 'Genel demo ofisi gercek kullanima gecirilemez (gece sifirlamasi kullanilir).' using errcode = '42501';
  end if;

  -- (0) Ornek kiralarin anlasma bagi: rentals.deal_id -> deals ON DELETE RESTRICT.
  update public.rentals set deal_id = null
   where is_sample = true and tenant_id = p_tenant_id and deal_id is not null;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('rentals.deal_id', v_n);

  -- (1) Istege bagli moduller (dinamik; yalniz bu ofis + ornek isareti).
  for i in 1 .. pg_catalog.array_length(v_optional, 1) loop
    v_spec := pg_catalog.string_to_array(v_optional[i], ':');
    if pg_catalog.to_regclass('public.' || v_spec[1]) is null then continue; end if;
    if v_spec[2] = 'is_sample' then
      if not exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = pg_catalog.to_regclass('public.' || v_spec[1]) and a.attname = 'is_sample' and not a.attisdropped) then
        continue;
      end if;
      execute pg_catalog.format('delete from public.%I where is_sample = true and tenant_id = $1', v_spec[1]) using p_tenant_id;
    else
      execute pg_catalog.format('delete from public.%I where tenant_id = $1 and %I like $2', v_spec[1], v_spec[3]) using p_tenant_id, '[Örnek veri]%';
    end if;
    get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object(v_spec[1], v_n);
  end loop;

  -- (2) Cekirdek: bagimli -> ana. Her satir yalniz ornek (is_sample = true) ve bu ofis (tenant_id = p_tenant_id).
  delete from public.rent_charges
    where tenant_id = p_tenant_id
      and rental_id in (select r.id from public.rentals r where r.is_sample = true and r.tenant_id = p_tenant_id);
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('rent_charges', v_n);

  delete from public.commissions where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('commissions', v_n);

  delete from public.contracts where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('contracts', v_n);

  delete from public.deals where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('deals', v_n);

  delete from public.offers where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('offers', v_n);

  delete from public.rentals where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('rentals', v_n);

  delete from public.expenses where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('expenses', v_n);

  delete from public.calls where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('calls', v_n);

  delete from public.notifications where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('notifications', v_n);

  delete from public.campaigns where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('campaigns', v_n);

  delete from public.communications where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('communications', v_n);

  delete from public.tasks where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('tasks', v_n);

  delete from public.appointments where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('appointments', v_n);

  delete from public.customer_demands where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('customer_demands', v_n);

  delete from public.property_control_state where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('property_control_state', v_n);

  delete from public.properties where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('properties', v_n);

  delete from public.customers where is_sample = true and tenant_id = p_tenant_id;
  get diagnostics v_n = row_count; v_counts := v_counts || pg_catalog.jsonb_build_object('customers', v_n);

  -- (3) Demo ekip: once pasif, sonra (baglanti kalmadiysa) sil. Gercek kullanici (is_sample = false) asla secilmez.
  for v_pid in
    select p.id from public.profiles p where p.tenant_id = p_tenant_id and p.is_sample = true
  loop
    update public.profiles set is_active = false where id = v_pid and tenant_id = p_tenant_id and is_sample = true;
    begin
      delete from public.profiles where id = v_pid and tenant_id = p_tenant_id and is_sample = true;
      v_removed := v_removed || v_pid;
    exception when others then
      v_kept := v_kept || v_pid;
    end;
  end loop;
  v_counts := v_counts || pg_catalog.jsonb_build_object('profiles', pg_catalog.cardinality(v_removed));

  -- (4) Ofis damgasi: ornek veri yok, gercek kullanima gecildi (KILIT).
  update public.tenants
     set sample_seeded_at = null,
         sample_pack = null,
         sample_cleared_at = pg_catalog.now(),
         real_use_at = pg_catalog.now(),
         sample_seed_override_until = null,
         sample_seed_override_by = null,
         updated_at = pg_catalog.now()
   where id = p_tenant_id;

  return pg_catalog.jsonb_build_object(
    'tenant_id', p_tenant_id,
    'cleared_at', pg_catalog.now(),
    'deleted', v_counts,
    'personas_removed', pg_catalog.to_jsonb(v_removed),
    'personas_kept', pg_catalog.to_jsonb(v_kept)
  );
end;
$$;

comment on function public.purge_tenant_sample_data(uuid) is
  'v2 (20261024020000): ofisin TUM ornek kayitlarini (moduller, kampanya, mesaj, demo ekip dahil) tek transaction''da siler, real_use_at ile kilitler; gercek kayit/kullaniciya dokunmaz; demo-ofis reddedilir.';

revoke all on function public.purge_tenant_sample_data(uuid) from public, anon;
grant execute on function public.purge_tenant_sample_data(uuid) to authenticated, service_role;

drop function if exists public.purge_sample_real_children(uuid);
