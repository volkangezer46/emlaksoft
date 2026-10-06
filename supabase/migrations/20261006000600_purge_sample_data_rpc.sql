-- MIGRATION 20261006000600_purge_sample_data_rpc.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261006000600_purge_sample_data_rpc.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261006000600_purge_sample_data_rpc.rollback.sql
-- BAGIMLILIK: is_sample sutunlari (20260726000086, 20260726000096, 20260816001600 — hepsi CANLIDA) ve
-- property_control_state (20260826002040, CANLIDA). On-kosul blogu eksikse HICBIR sey yazmaz.
--
-- AMAC (PB44, self-servis kurulum): "Gercek kullanima gec" tek tusu. Ofisin TUM ornek (is_sample = true)
-- kayitlarini TEK transaction'da, FK sirasiyla siler; kullanicinin kendi girdigi gercek kayitlara (is_sample = false)
-- DOKUNMAZ. Bugune kadar bu is uygulama katmaninda tablo tablo service_role ile yapiliyordu (src/lib/sample-clear.ts);
-- yarim kalma riski vardi. RPC atomiktir: bir tablo hata verirse hicbiri silinmez.
--
-- GUVENLIK: SECURITY DEFINER + bos search_path. Cagiran ya ilgili ofisin owner/gm uyesidir (profiles) ya da
-- service_role'dur; aksi halde hata. Yalniz authenticated/service_role EXECUTE alir (anon/public yok).
-- Her DELETE "where is_sample = true and tenant_id = p_tenant_id" tasir (sozlesme testi dosyayi okuyup dogrular:
-- src/lib/sample-data/purge-rpc-contract.test.ts). Depolama dosyasi: ornek set dosya uretmez; silinen satirlar
-- storage nesnesi tasimaz (property_media ornek satiri yok), bu yuzden storage_deletion_outbox'a is yazilmaz.
--
-- EK (ayni pencere, ayni dosya): kurulum sihirbazi ofis profili icin tenants'a UC nullable sutun (office_type,
-- focus_segments, work_district_ids) + CHECK. Mevcut satir/RLS/davranis degismez; kod sutunlar yokken yazmayi atlar.

set local lock_timeout = '5s';

do $$
declare
  t text;
begin
  foreach t in array array['customers','properties','customer_demands','tasks','appointments','deals',
                           'commissions','offers','contracts','rentals','rent_charges','calls','expenses',
                           'notifications','property_control_state','tenants','profiles']
  loop
    if pg_catalog.to_regclass('public.' || t) is null then
      raise exception '20261006000600: public.% yok; once temel migrationlar uygulanmali.', t;
    end if;
  end loop;
  foreach t in array array['customers','properties','customer_demands','tasks','appointments','deals',
                           'commissions','offers','contracts','rentals','calls','expenses','notifications',
                           'property_control_state']
  loop
    if not exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = pg_catalog.to_regclass('public.' || t) and a.attname = 'is_sample' and not a.attisdropped
    ) then
      raise exception '20261006000600: public.%.is_sample yok; once 20260816001600_sample_data_scope_extension uygulanmali.', t;
    end if;
  end loop;
end $$;

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
begin
  if p_tenant_id is null then
    raise exception 'ofis kimligi gerekli' using errcode = '22023';
  end if;

  -- Yetki: service_role ya da ofisin owner/gm uyesi. Baska rol / baska ofis -> hata (sessiz bosluk yok).
  if not v_is_service then
    if v_uid is null or not exists (
      select 1 from public.profiles p
      where p.id = v_uid and p.tenant_id = p_tenant_id and p.is_active and p.role in ('owner', 'gm')
    ) then
      raise exception 'Bu islem yalniz ofis sahibi veya genel mudur tarafindan yapilabilir.' using errcode = '42501';
    end if;
  end if;

  -- Sira: bagimli -> ana. Her satir yalniz ornek (is_sample = true) ve bu ofis (tenant_id = p_tenant_id).
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

  -- Ofis damgasi: ornek veri yok, gercek kullanima gecildi.
  update public.tenants
     set sample_seeded_at = null,
         sample_pack = null,
         sample_cleared_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   where id = p_tenant_id;

  return pg_catalog.jsonb_build_object(
    'tenant_id', p_tenant_id,
    'cleared_at', pg_catalog.now(),
    'deleted', v_counts
  );
end;
$$;

comment on function public.purge_tenant_sample_data(uuid) is
  'Ofisin tum ornek (is_sample=true) kayitlarini FK sirasiyla tek transaction''da siler; gercek kayitlara dokunmaz. Cagiran owner/gm ya da service_role.';

revoke all on function public.purge_tenant_sample_data(uuid) from public, anon;
grant execute on function public.purge_tenant_sample_data(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- sihirbaz ofis profili sutunlari
alter table public.tenants add column if not exists office_type text;
alter table public.tenants add column if not exists focus_segments text[];
alter table public.tenants add column if not exists work_district_ids uuid[];

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'tenants_office_type_check') then
    alter table public.tenants
      add constraint tenants_office_type_check
      check (office_type is null or office_type in ('bagimsiz', 'franchise', 'kurumsal'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'tenants_focus_segments_check') then
    alter table public.tenants
      add constraint tenants_focus_segments_check
      check (focus_segments is null or focus_segments <@ array['satilik', 'kiralik', 'ticari', 'arsa']::text[]);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'tenants_work_district_ids_check') then
    alter table public.tenants
      add constraint tenants_work_district_ids_check
      check (work_district_ids is null or pg_catalog.cardinality(work_district_ids) <= 30);
  end if;
end $$;

comment on column public.tenants.office_type is
  'Kurulum sihirbazi: ofis turu (bagimsiz | franchise | kurumsal). Yalniz bilgi/segmentasyon; yetki/fiyat etkisi yok.';
comment on column public.tenants.focus_segments is
  'Kurulum sihirbazi: calisma odagi (satilik, kiralik, ticari, arsa). Ornek veri paketi ve tanim sablonu secimi bundan turer.';
comment on column public.tenants.work_district_ids is
  'Kurulum sihirbazi: calisilan ilceler (geo_districts.id, en cok 30). Yalniz bilgi; filtre varsayilani icin.';

notify pgrst, 'reload schema';
