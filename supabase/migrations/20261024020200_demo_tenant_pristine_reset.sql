-- MIGRATION 20261024020200_demo_tenant_pristine_reset.sql
-- UYGULANMADI: 20261016150301 SONRASI. Siranin onemi yok (20261024020000'e bagli degil); KOD ILE AYNI pencere onerilir.
-- Geri alma: supabase/rollbacks/20261024020200_demo_tenant_pristine_reset.rollback.sql
-- BAGIMLILIK: demo_reset_state ve demo_tenant_nightly_reset (20261015041000 + 20261016150301 son govde).
--
-- AMAC (sahip istegi): genel demo ofisi (giris sayfasindaki demo kartlari) her gece PRISTINE haline doner.
--   1. public.demo_reset_snapshots: tohum kayitlarinin taban anindaki anlik goruntusu (jsonb). RLS acik, politika YOK
--      (yalniz SECURITY DEFINER fonksiyonlar ve service_role okur/yazar).
--   2. demo_tenant_capture_baseline(uuid, timestamptz): yeniden tohumdan sonra (scripts/demo-cleanup-reseed.ts) taban +
--      goruntu alinir. [SAHA] kalintilari goruntuye ALINMAZ.
--   3. demo_tenant_saha_cleanup(uuid, timestamptz, boolean): "[SAHA]" ile baslayan test kalintilarini (ve onlara bagli test
--      kayitlarini) siler; FK yuzunden silinemeyen satir yumusak silinir (deleted_at). p_dry_run = true yalniz sayar.
--   4. demo_tenant_restore_snapshot(uuid): goruntudeki satirlari geri yazar (degisen sutunlar, silinen satir yeniden eklenir).
--      Goruntude olmayan YENI sutunlara dokunulmaz. Satir bazinda hata yutulur ve sayilir (tetikleyici reddi gece isini durdurmaz).
--   5. demo_tenant_nightly_reset: govde 20261016150301'den AYNEN alinip sonuna 3 ve 4 eklendi.
-- GUVENLIK: her fonksiyon slug = 'demo-ofis' degilse 42501 ile reddeder; EXECUTE yalniz service_role.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.demo_reset_state') is null then
    raise exception 'public.demo_reset_state yok: once 20261015041000_demo_tenant_nightly_reset uygulanmali.';
  end if;
end $$;

create table if not exists public.demo_reset_snapshots (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tbl text not null,
  row_id uuid not null,
  data jsonb not null,
  captured_at timestamptz not null default now(),
  primary key (tenant_id, tbl, row_id)
);

alter table public.demo_reset_snapshots enable row level security;
revoke all on table public.demo_reset_snapshots from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.demo_reset_snapshots from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.demo_reset_snapshots from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on table public.demo_reset_snapshots to service_role';
  end if;
end $$;

comment on table public.demo_reset_snapshots is
  'Genel demo ofisinin tohum anlik goruntusu (gece sifirlamasi pristine geri yukleme). Yalniz demo-ofis; RLS acik, politika yok.';

-- Ortak: geri yuklenen tablolar (EBEVEYN -> COCUK sirasi) ve [SAHA] arama sutunlari.
create or replace function public.demo_reset_snapshot_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['customers', 'properties', 'property_media', 'customer_demands', 'deals', 'offers', 'contracts', 'rentals',
               'rent_charges', 'commissions', 'tasks', 'appointments', 'expenses', 'calls', 'notifications']::text[];
$$;

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

revoke all on function public.demo_reset_snapshot_tables() from public;
revoke all on function public.demo_saha_columns() from public;

create or replace function public.demo_tenant_saha_cleanup(p_tenant_id uuid, p_now timestamptz default now(), p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slug text;
  v_spec text[];
  v_item text;
  v_n bigint;
  v_total bigint := 0;
  v_tables jsonb := '{}'::jsonb;
  v_has_deleted boolean;
  v_dep text;
  -- Test musterisine / portfoyune bagli kayitlar da test kaydidir: once onlar silinir (FK NO ACTION engeli kalmaz).
  v_children text[] := array['deals', 'offers', 'customer_demands', 'tasks', 'appointments', 'calls', 'communications', 'contracts', 'property_media'];
begin
  select t.slug into v_slug from public.tenants t where t.id = p_tenant_id;
  if v_slug is distinct from 'demo-ofis' then
    raise exception 'demo_reset_not_demo_tenant' using errcode = '42501';
  end if;

  if not p_dry_run then
    foreach v_dep in array v_children loop
      if pg_catalog.to_regclass('public.' || v_dep) is null then continue; end if;
      foreach v_item in array array['customer_id:customers:full_name', 'property_id:properties:title'] loop
        v_spec := string_to_array(v_item, ':');
        if not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = v_dep and c.column_name = v_spec[1]) then
          continue;
        end if;
        begin
          execute format(
            'delete from public.%I d where d.tenant_id = $1 and d.%I in (select x.id from public.%I x where x.tenant_id = $1 and x.%I like $2)',
            v_dep, v_spec[1], v_spec[2], v_spec[3]
          ) using p_tenant_id, '[SAHA]%';
          get diagnostics v_n = row_count;
          if v_n > 0 then
            v_tables := v_tables || jsonb_build_object(v_dep, coalesce((v_tables ->> v_dep)::bigint, 0) + v_n);
            v_total := v_total + v_n;
          end if;
        exception when others then
          null; -- sonraki adimda kendi satiri yumusak silinir ya da kalir (sayimda gorunur)
        end;
      end loop;
    end loop;
  end if;

  foreach v_item in array public.demo_saha_columns() loop
    v_spec := string_to_array(v_item, ':');
    if pg_catalog.to_regclass('public.' || v_spec[1]) is null then continue; end if;
    if not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = v_spec[1] and c.column_name = v_spec[2]) then
      continue;
    end if;
    v_has_deleted := exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = v_spec[1] and c.column_name = 'deleted_at');
    if p_dry_run then
      execute format('select count(*) from public.%I where tenant_id = $1 and %I like $2' || case when v_has_deleted then ' and deleted_at is null' else '' end, v_spec[1], v_spec[2])
        into v_n using p_tenant_id, '[SAHA]%';
    else
      begin
        execute format('delete from public.%I where tenant_id = $1 and %I like $2', v_spec[1], v_spec[2]) using p_tenant_id, '[SAHA]%';
        get diagnostics v_n = row_count;
      exception when others then
        v_n := 0;
        if v_has_deleted then
          execute format('update public.%I set deleted_at = $3 where tenant_id = $1 and %I like $2 and deleted_at is null', v_spec[1], v_spec[2])
            using p_tenant_id, '[SAHA]%', p_now;
          get diagnostics v_n = row_count;
        end if;
      end;
    end if;
    if v_n > 0 then
      v_tables := v_tables || jsonb_build_object(v_spec[1], coalesce((v_tables ->> v_spec[1])::bigint, 0) + v_n);
      v_total := v_total + v_n;
    end if;
  end loop;

  return jsonb_build_object('dry_run', p_dry_run, 'tables', v_tables, 'total', v_total);
end;
$$;

create or replace function public.demo_tenant_capture_baseline(p_tenant_id uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slug text;
  v_table text;
  v_n bigint;
  v_counts jsonb := '{}'::jsonb;
  v_filter text;
  v_item text;
  v_spec text[];
begin
  select t.slug into v_slug from public.tenants t where t.id = p_tenant_id;
  if v_slug is distinct from 'demo-ofis' then
    raise exception 'demo_reset_not_demo_tenant' using errcode = '42501';
  end if;

  delete from public.demo_reset_snapshots where tenant_id = p_tenant_id;
  foreach v_table in array public.demo_reset_snapshot_tables() loop
    if pg_catalog.to_regclass('public.' || v_table) is null then continue; end if;
    if not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = v_table and c.column_name = 'id') then
      continue;
    end if;
    -- [SAHA] satirlari goruntuye girmez (gece geri gelmesinler).
    v_filter := '';
    foreach v_item in array public.demo_saha_columns() loop
      v_spec := string_to_array(v_item, ':');
      if v_spec[1] = v_table and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = v_table and c.column_name = v_spec[2]) then
        v_filter := v_filter || format(' and coalesce(t.%I, '''') not like ''[SAHA]%%''', v_spec[2]);
      end if;
    end loop;
    execute format(
      'insert into public.demo_reset_snapshots(tenant_id, tbl, row_id, data, captured_at) '
      || 'select $1, %L, t.id, to_jsonb(t), $2 from public.%I t where t.tenant_id = $1',
      v_table, v_table
    ) || v_filter using p_tenant_id, p_now;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(v_table, v_n);
  end loop;

  insert into public.demo_reset_state(tenant_id, baseline_at, last_reset_at, last_result)
  values (p_tenant_id, p_now, p_now, jsonb_build_object('baseline_captured', v_counts))
  on conflict (tenant_id) do update set baseline_at = excluded.baseline_at, last_result = excluded.last_result;

  return jsonb_build_object('baseline_at', p_now, 'captured', v_counts);
end;
$$;

create or replace function public.demo_tenant_restore_snapshot(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slug text;
  v_table text;
  v_cols text;
  v_set text;
  v_row record;
  v_n bigint;
  v_total bigint := 0;
  v_failed bigint := 0;
  v_tables jsonb := '{}'::jsonb;
  v_keys text[];
  v_exists boolean;
  v_changed bigint;
begin
  select t.slug into v_slug from public.tenants t where t.id = p_tenant_id;
  if v_slug is distinct from 'demo-ofis' then
    raise exception 'demo_reset_not_demo_tenant' using errcode = '42501';
  end if;

  foreach v_table in array public.demo_reset_snapshot_tables() loop
    if pg_catalog.to_regclass('public.' || v_table) is null then continue; end if;
    select array(select jsonb_object_keys(s.data)) into v_keys
      from public.demo_reset_snapshots s where s.tenant_id = p_tenant_id and s.tbl = v_table limit 1;
    if v_keys is null or cardinality(v_keys) = 0 then continue; end if;
    -- Goruntude OLAN ve tabloda hala bulunan, uretilmis olmayan sutunlar (yeni sutunlara dokunulmaz).
    select string_agg(format('%I', a.attname), ', ' order by a.attnum),
           string_agg(format('%I = r.%I', a.attname, a.attname), ', ' order by a.attnum) filter (where a.attname <> 'id')
      into v_cols, v_set
      from pg_catalog.pg_attribute a
     where a.attrelid = ('public.' || v_table)::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
       and a.attname = any (v_keys);
    if v_cols is null or v_set is null then continue; end if;
    v_n := 0;
    for v_row in
      select s.row_id, s.data from public.demo_reset_snapshots s where s.tenant_id = p_tenant_id and s.tbl = v_table
    loop
      begin
        execute format('select exists (select 1 from public.%I x where x.id = $1 and x.tenant_id = $2)', v_table)
          into v_exists using v_row.row_id, p_tenant_id;
        if v_exists then
          -- Yalniz goruntudeki sutunlar karsilastirilir; degismemis satira yazilmaz (tetikleyici calismaz).
          execute format(
            'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r '
            || 'where t.id = $2 and t.tenant_id = $3 '
            || 'and (select jsonb_object_agg(k, to_jsonb(t) -> k) from unnest($4::text[]) k) is distinct from $1',
            v_table, v_set, v_table
          ) using v_row.data, v_row.row_id, p_tenant_id, v_keys;
          get diagnostics v_changed = row_count;
          v_n := v_n + v_changed;
        else
          execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)', v_table, v_cols, v_cols, v_table)
            using v_row.data;
          v_n := v_n + 1;
        end if;
      exception when others then
        v_failed := v_failed + 1;
      end;
    end loop;
    if v_n > 0 then
      v_tables := v_tables || jsonb_build_object(v_table, v_n);
      v_total := v_total + v_n;
    end if;
  end loop;

  return jsonb_build_object('tables', v_tables, 'total', v_total, 'failed', v_failed);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.demo_tenant_saha_cleanup(uuid, timestamptz, boolean)',
    'public.demo_tenant_capture_baseline(uuid, timestamptz)',
    'public.demo_tenant_restore_snapshot(uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;

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
  'YD1 + 20261024020200: yalniz slug=demo-ofis; dis baglanti yuzeyleri, tabandan sonra eklenen is kayitlari, [SAHA] kalintilari silinir; tohum anlik goruntuden geri yuklenir (pristine). Gercek kiracida hata verir.';
