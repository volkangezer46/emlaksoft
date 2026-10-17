-- MIGRATION 20261027010200_purge_v3_real_child_guard.sql
-- UYGULANMADI: 20261027010000 SONRASI (sample_trusted_op kullanir). KOD YAYININDAN ONCE ya da SONRA uygulanabilir:
--   kod ES409'u yeni ayrintili mesajla esler; eski kod ES409'u genel "temizlenemedi" mesajina dusurur (hicbir sey silinmez).
-- Geri alma: supabase/rollbacks/20261027010200_purge_v3_real_child_guard.rollback.sql (purge v2 govdesine doner).
-- BAGIMLILIK: 20261024020000 (purge v2), 20261027010000 (sample_trusted_op).
--
-- NEDEN (denetim F2): purge v2 ornek musteri/portfoyu silerken ON DELETE CASCADE ile bagli GERCEK kayitlari (ornek
--   musteriye eklenen gercek teklif, IYS onayi, dosya, anahtar, ilan sahibi bilgisi, portal ilani...) sessizce siliyordu.
--   Ayrica oturumlu sahip yolunda tenants.sample_seeded_at ve ornek ekip pasiflestirmesi kimlik/yasam dongusu
--   tetikleyicilerine (auth.role() = authenticated) takiliyordu.
-- NE YAPAR:
--   1. public.purge_sample_real_children(p_tenant_id): pg_constraint'ten (confdeltype = 'c') customers/properties'e
--      kaskatli TUM cocuk tablolari bulur ve ornek ebeveyne bagli GERCEK satirlari sayar. Siniflama:
--        - is_sample sutunu olan cocuk: is_sample = false satir gercektir;
--        - property_media: yalniz depoya yuklenmis dosya (storage_path dolu) gercektir (statik demo fotografi degil);
--        - turetilmis/sistem tablolari (gecmis, analiz, eslesme, belirtec): sayilmaz (v_derived listesi);
--        - DIGER HER cocuk tablo (yeni eklenenler dahil): her satir gercek sayilir (guvenli varsayilan).
--      Doner: {total, tables:[{table,parent,count}], rows:[{table,id,parent,parent_id,parent_label}] (en cok 25)}.
--   2. purge_tenant_sample_data v3: silmeden ONCE (1)'i calistirir; gercek cocuk varsa ES409 ile durur (ayrinti JSON,
--      hicbir sey silinmez). Govde v2 ile ayni; ek olarak transaction yerel guvenilir isaret (app.sample_trusted_tenant)
--      kurulur ki oturumlu sahip yolunda damga ve ornek ekip pasiflestirmesi tetikleyicilere takilmasin.
-- ETKI: davranis (purge artik gercek cocuk kayitta durur).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.purge_tenant_sample_data(uuid)') is null
     or pg_catalog.to_regprocedure('public.sample_trusted_op(uuid)') is null then
    raise exception '20261027010200: once 20261024020000 ve 20261027010000 uygulanmali.';
  end if;
end $$;

create or replace function public.purge_sample_real_children(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_is_service boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  v_uid uuid := auth.uid();
  -- Turetilmis / sistem cocuklari: ornek kayda kullanici eylemiyle ya da tetikleyiciyle olusur, kaybi veri kaybi degildir.
  v_derived text[] := array[
    'property_price_history', 'property_status_history', 'lc_lifecycle_events', 'listing_views', 'listing_analyses',
    'listing_anomalies', 'listing_pool_entries', 'pool_assignments', 'portal_match_feedback', 'demand_property_matches',
    'presentation_feedback', 'lost_sale_dismissals', 'portal_transfer_sessions', 'owner_portal_tokens',
    'customer_portal_tokens', 'message_sequence_enrollments', 'vitrin_price_alerts', 'property_control_state'
  ];
  r record;
  v_pred text;
  v_label text;
  v_n bigint;
  v_total bigint := 0;
  v_tables jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_part jsonb;
  v_has_id boolean;
begin
  if p_tenant_id is null then
    raise exception 'ofis kimligi gerekli' using errcode = '22023';
  end if;
  if not v_is_service then
    if v_uid is null or not exists (
      select 1 from public.profiles p where p.id = v_uid and p.tenant_id = p_tenant_id and p.is_active and p.is_sample = false
    ) then
      raise exception 'Bu ofisin ornek veri durumunu goremezsiniz.' using errcode = '42501';
    end if;
  end if;

  for r in
    select distinct
           c.conrelid as child_oid,
           cl.relname::text as child,
           pr.relname::text as parent,
           a.attname::text as col
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class cl on cl.oid = c.conrelid and cl.relnamespace = 'public'::regnamespace
      join pg_catalog.pg_class pr on pr.oid = c.confrelid
      join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey) and a.attname <> 'tenant_id'
     where c.contype = 'f'
       and c.confdeltype = 'c'
       and c.confrelid in ('public.customers'::regclass, 'public.properties'::regclass)
       and cl.relname not in ('customers', 'properties')
     order by 2, 3, 4
  loop
    continue when r.child = any (v_derived);
    if exists (select 1 from pg_catalog.pg_attribute x where x.attrelid = r.child_oid and x.attname = 'is_sample' and not x.attisdropped) then
      v_pred := 'x.is_sample = false';
    elsif r.child = 'property_media' then
      v_pred := 'x.storage_path is not null';
    else
      v_pred := 'true';
    end if;
    v_label := case when r.parent = 'customers' then 'p.full_name' else 'p.title' end;
    execute pg_catalog.format(
      'select count(*) from public.%I x join public.%I p on p.id = x.%I where p.tenant_id = $1 and p.is_sample = true and %s',
      r.child, r.parent, r.col, v_pred
    ) into v_n using p_tenant_id;
    if v_n > 0 then
      v_total := v_total + v_n;
      v_tables := v_tables || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('table', r.child, 'parent', r.parent, 'column', r.col, 'count', v_n));
      if pg_catalog.jsonb_array_length(v_rows) < 25 then
        v_has_id := exists (select 1 from pg_catalog.pg_attribute x where x.attrelid = r.child_oid and x.attname = 'id' and not x.attisdropped);
        execute pg_catalog.format(
          'select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(''table'', %L, ''id'', %s, ''parent'', %L, ''parent_id'', p.id, ''parent_label'', %s)), ''[]''::jsonb) '
          || 'from (select x.* from public.%I x join public.%I p on p.id = x.%I where p.tenant_id = $1 and p.is_sample = true and %s limit $2) x '
          || 'join public.%I p on p.id = x.%I',
          r.child, case when v_has_id then 'x.id::text' else 'null' end, r.parent, v_label,
          r.child, r.parent, r.col, v_pred,
          r.parent, r.col
        ) into v_part using p_tenant_id, 25 - pg_catalog.jsonb_array_length(v_rows);
        v_rows := v_rows || v_part;
      end if;
    end if;
  end loop;

  return pg_catalog.jsonb_build_object('total', v_total, 'tables', v_tables, 'rows', v_rows);
end;
$$;

comment on function public.purge_sample_real_children(uuid) is
  'F2 (20261027010200): ornek musteri/portfoye ON DELETE CASCADE ile bagli GERCEK cocuk kayitlar (pg_constraint confdeltype=c; turetilmis tablolar haric). purge v3 bu liste bos degilse ES409 ile durur.';

revoke all on function public.purge_sample_real_children(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.purge_sample_real_children(uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.purge_sample_real_children(uuid) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.purge_sample_real_children(uuid) to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------- purge v3
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
  v_real jsonb;
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

  -- (v3) Ornek ebeveyne kaskatla bagli GERCEK kayit varsa hicbir sey silinmez (ES409 + ayrinti JSON).
  v_real := public.purge_sample_real_children(p_tenant_id);
  if coalesce((v_real ->> 'total')::bigint, 0) > 0 then
    raise exception using errcode = 'ES409', message = 'SAMPLE_PURGE_REAL_CHILDREN', detail = v_real::text;
  end if;

  -- (v3) Guvenilir isaret (yalniz bu transaction): damga ve ornek ekip pasiflestirmesi kimlik tetikleyicilerine takilmaz.
  perform pg_catalog.set_config('app.sample_trusted_tenant', p_tenant_id::text, true);

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

  perform pg_catalog.set_config('app.sample_trusted_tenant', '', true);

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
  'v3 (20261027010200): v2 + ornek ebeveyne kaskatla bagli gercek cocuk kayit varsa ES409 ile durur (purge_sample_real_children); TUM ornek kayitlari tek transaction''da siler, real_use_at ile kilitler; demo-ofis reddedilir.';

revoke all on function public.purge_tenant_sample_data(uuid) from public, anon;
grant execute on function public.purge_tenant_sample_data(uuid) to authenticated, service_role;
