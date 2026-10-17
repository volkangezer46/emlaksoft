-- MIGRATION 20261024020000_demo_mode_lock_purge_v2.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261024020000_demo_mode_lock_purge_v2.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261024020000_demo_mode_lock_purge_v2.rollback.sql
-- BAGIMLILIK: 20261006000600_purge_sample_data_rpc (fonksiyonun ilk govdesi; bu dosya onu YENIDEN tanimlar, imza ayni).
--
-- AMAC (sahip kurali, 2026-10-24 demo sistemi):
--   1. KILIT: "demo silinip gercek kayit yuklenince tekrar demo kayitlar yuklenemesin". tenants.real_use_at (gercek kullanima
--      gecis ani) + gercek (is_sample=false) musteri/portfoy varligi. public.sample_seed_guard(uuid) kurali TEK yerde hesaplar;
--      BEFORE INSERT tetikleyicisi is_sample=true musteri/portfoy eklemesini ayni kuralla REDDEDER (uygulama kapisi atlansa bile).
--      Istisna yalniz platform super admininin verdigi kisa sureli izin (sample_seed_override_until) ve YALNIZ gercek kaydi
--      olmayan ofiste; genel demo ofisi (slug demo-ofis) kilit disidir.
--   2. DEMO EKIP: profiles.is_sample (20260816001600; giris yapamayan ornek danisman profilleri) artik tohumda kullanilir; koltuk sayimi 20261024020100.
--   3. Yeni ornek varliklar: campaigns.is_sample, communications.is_sample.
--   4. purge_tenant_sample_data v2: TUM ornek kapsami tek transaction'da (eski TS on-adimi purge-extras.ts'in isleri dahil:
--      kira->anlasma bagi, FSBO adaylari, bina/site, meydan okuma, danisman uzmanlik/bolge, finans; yeni: kampanya, mesaj,
--      demo ekip). Demo ekip profili PASIFLESTIRILIR ve silinebiliyorsa silinir (gercek kayda bagliysa pasif kalir); kimlik
--      silmesi uygulamada (personas.ts) yalniz .invalid ornek alan adinda yapilir. Gercek kullaniciya/kayda DOKUNULMAZ.
--      Genel demo ofisinde reddedilir. Bitince real_use_at = now() (kilit).
--   Statik demo fotograflari: property_media satiri storage_path NULL + external_url /img/demo/... tasir; portfoyle kaskatlanir,
--   depo silme kuyrugu (storage_object_lifecycle) yolu bos satirda is yazmaz -> statik dosyalara asla dokunulmaz.
-- ETKI: ek sutunlar (varsayilanli, NOT NULL default false), yeni fonksiyonlar, iki tetikleyici; mevcut satirlar degismez
--   (yalniz geri doldurma: daha once gecis yapmis ofislerde real_use_at = sample_cleared_at).

set local lock_timeout = '5s';

do $$
declare
  t text;
begin
  foreach t in array array['tenants','profiles','customers','properties','customer_demands','tasks','appointments','deals',
                           'commissions','offers','contracts','rentals','rent_charges','calls','expenses','notifications',
                           'property_control_state','campaigns','communications']
  loop
    if pg_catalog.to_regclass('public.' || t) is null then
      raise exception '20261024020000: public.% yok; once temel migrationlar uygulanmali.', t;
    end if;
  end loop;
  if pg_catalog.to_regprocedure('public.purge_tenant_sample_data(uuid)') is null then
    raise exception '20261024020000: purge_tenant_sample_data yok; once 20261006000600 uygulanmali.';
  end if;
end $$;

-- ---------------------------------------------------------------- sutunlar
alter table public.tenants add column if not exists real_use_at timestamptz;
alter table public.tenants add column if not exists sample_seed_override_until timestamptz;
alter table public.tenants add column if not exists sample_seed_override_by uuid;
-- profiles.is_sample 20260816001600'dan beri var (if not exists: no-op); kapsam artik uygulamada kullaniliyor.
alter table public.profiles add column if not exists is_sample boolean not null default false;
alter table public.campaigns add column if not exists is_sample boolean not null default false;
alter table public.communications add column if not exists is_sample boolean not null default false;

comment on column public.tenants.real_use_at is
  'Gercek kullanima gecis ani (purge_tenant_sample_data). Doluysa ornek veri bir daha yuklenemez (sample_seed_guard).';
comment on column public.tenants.sample_seed_override_until is
  'Platform super admininin verdigi kisa sureli yeniden yukleme izni; yalniz gercek kaydi olmayan ofiste gecerli.';
comment on column public.profiles.is_sample is
  'Ornek (demo) ekip uyesi: giris yapamaz, koltuk sayilmaz, gercek kullanima geciste kaldirilir.';

-- Daha once gercek kullanima gecmis ofisler kilitlenir (yeniden yukleme damgasi olmayanlar).
update public.tenants
   set real_use_at = sample_cleared_at
 where real_use_at is null
   and sample_cleared_at is not null
   and sample_seeded_at is null;

-- ---------------------------------------------------------------- kilit kurali
create or replace function public.tenant_real_record_count(p_tenant_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (
    (select count(*) from (select 1 from public.customers c where c.tenant_id = p_tenant_id and c.is_sample = false limit 1000) x)
    + (select count(*) from (select 1 from public.properties p where p.tenant_id = p_tenant_id and p.is_sample = false limit 1000) y)
  )::integer;
$$;

revoke all on function public.tenant_real_record_count(uuid) from public, anon, authenticated;
grant execute on function public.tenant_real_record_count(uuid) to service_role;

create or replace function public.sample_seed_guard(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_is_service boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  v_uid uuid := auth.uid();
  v_t record;
  v_real integer;
  v_allowed boolean;
  v_code text := null;
begin
  if p_tenant_id is null then
    raise exception 'ofis kimligi gerekli' using errcode = '22023';
  end if;
  if not v_is_service then
    if v_uid is null or not exists (
      select 1 from public.profiles p where p.id = v_uid and p.tenant_id = p_tenant_id and p.is_active
    ) then
      raise exception 'Bu ofisin ornek veri durumunu goremezsiniz.' using errcode = '42501';
    end if;
  end if;

  select t.slug, t.real_use_at, t.sample_seed_override_until, t.sample_seeded_at
    into v_t from public.tenants t where t.id = p_tenant_id;
  if not found then
    raise exception 'ofis bulunamadi' using errcode = '22023';
  end if;
  v_real := public.tenant_real_record_count(p_tenant_id);

  if v_t.slug = 'demo-ofis' then
    v_allowed := true;
  elsif v_real > 0 then
    v_allowed := false; v_code := 'real_records';
  elsif v_t.real_use_at is not null and coalesce(v_t.sample_seed_override_until > pg_catalog.now(), false) is not true then
    v_allowed := false; v_code := 'real_use';
  else
    v_allowed := true;
  end if;

  return pg_catalog.jsonb_build_object(
    'allowed', v_allowed,
    'code', v_code,
    'real_records', v_real,
    'real_use_at', v_t.real_use_at,
    'override_until', v_t.sample_seed_override_until,
    'seeded_at', v_t.sample_seeded_at,
    'demo_tenant', v_t.slug = 'demo-ofis'
  );
end;
$$;

revoke all on function public.sample_seed_guard(uuid) from public, anon;
grant execute on function public.sample_seed_guard(uuid) to authenticated, service_role;

-- Tetikleyici: yalniz is_sample = true eklemesinde calisir (gercek kayit eklemesine maliyet yok).
create or replace function public.sample_seed_lock_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_real_use timestamptz;
  v_override timestamptz;
begin
  if new.is_sample is distinct from true then
    return new;
  end if;
  select t.slug, t.real_use_at, t.sample_seed_override_until into v_slug, v_real_use, v_override
    from public.tenants t where t.id = new.tenant_id;
  if v_slug = 'demo-ofis' then
    return new;
  end if;
  if public.tenant_real_record_count(new.tenant_id) > 0 then
    raise exception using errcode = 'P0001', message = 'SAMPLE_SEED_LOCKED:real_records';
  end if;
  if v_real_use is not null and coalesce(v_override > pg_catalog.now(), false) is not true then
    raise exception using errcode = 'P0001', message = 'SAMPLE_SEED_LOCKED:real_use';
  end if;
  return new;
end;
$$;

revoke all on function public.sample_seed_lock_guard() from public, anon, authenticated;

drop trigger if exists trg_customers_sample_seed_lock on public.customers;
create trigger trg_customers_sample_seed_lock
  before insert on public.customers
  for each row when (new.is_sample is true)
  execute function public.sample_seed_lock_guard();

drop trigger if exists trg_properties_sample_seed_lock on public.properties;
create trigger trg_properties_sample_seed_lock
  before insert on public.properties
  for each row when (new.is_sample is true)
  execute function public.sample_seed_lock_guard();

-- ---------------------------------------------------------------- purge v2
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
