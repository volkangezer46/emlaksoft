-- MIGRATION 20261011000200_home_snapshot_rpc.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261011000200_home_snapshot_rpc.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261011000200_home_snapshot_rpc.rollback.sql
-- BAGIMLILIK: public.appointments, public.deals, public.targets, public.customers, public.properties, public.tenant_settings,
--   public.current_tenant_id(); is_sample sutunlari (appointments/deals/customers/properties).
--
-- AMAC (ana ekran hizi, "Ofis geneli / Benim islerim" gecisi): ilk ekran (Bugun / Dikkat / Program) icin hala ayri PostgREST
--   turu atan kucuk okumalari TEK tura indirir: bugunun randevulari (+ toplam), riskli (hareketsiz) anlasma sayisi
--   (esik ofis ayarindan SQL'de cozulur: tenant_settings 'office.alert.deal_stale_days', yoksa p_stale_days_default),
--   bu ayin ofis + kisisel hedefi, bos-ofis ayrimi sayaclari. Kapsam p_scope = 'ben' | 'ofis'.
--   Kod RPC yoksa/hata verirse mevcut sorgulara duser (rpc-probe deseni); sahte sifir uretilmez.
--
-- GUVENLIK: SECURITY INVOKER (RLS cagiranin yetkisiyle: yetkisiz tablo satir vermez). Cagiran oturumu yoksa ya da ofis
--   yoksa NULL. 'ben' kapsami yalniz auth.uid()'e atanmis kayitlari doner; baska kullanici icin parametre ALINMAZ.
-- ORNEK VERI KURALI: get_metrics_snapshot ile ayni (gercek musteri VE portfoy < 5 ise demo dahil); karar sample_included olarak doner.
-- ZAMAN: gun/ay sinirlari Europe/Istanbul (src/lib/clock.ts ile ayni).
-- ETKI: yalniz 1 yeni fonksiyon (ek). Tablo/politika/veri degismez.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.appointments') is null or pg_catalog.to_regclass('public.deals') is null
     or pg_catalog.to_regclass('public.targets') is null or pg_catalog.to_regclass('public.customers') is null
     or pg_catalog.to_regclass('public.properties') is null then
    raise exception 'ana ekran tablolarindan biri yok (appointments/deals/targets/customers/properties).';
  end if;
  if pg_catalog.to_regprocedure('public.current_tenant_id()') is null then
    raise exception 'current_tenant_id() yok.';
  end if;
end $$;

create or replace function public.home_snapshot(p_scope text, p_stale_days_default integer default 14)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_mine boolean := (p_scope = 'ben');
  v_now timestamptz := now();
  v_tr_now timestamp := now() at time zone 'Europe/Istanbul';
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_month_key date;
  v_real_customers bigint;
  v_real_properties bigint;
  v_include boolean;
  v_stale_days integer;
  v_setting jsonb;
  v_appt jsonb;
  v_appt_total bigint;
  v_stale bigint;
  v_office_target jsonb;
  v_my_target jsonb;
begin
  if v_uid is null or v_tenant is null or p_scope is null or p_scope not in ('ben', 'ofis') then
    return null;
  end if;

  v_day_start := date_trunc('day', v_tr_now) at time zone 'Europe/Istanbul';
  v_day_end := v_day_start + interval '1 day';
  v_month_key := date_trunc('month', v_tr_now)::date;

  select count(*) into v_real_customers from public.customers c where c.tenant_id = v_tenant and c.is_sample = false and c.deleted_at is null;
  select count(*) into v_real_properties from public.properties p where p.tenant_id = v_tenant and p.is_sample = false and p.deleted_at is null;
  v_include := (v_real_customers < 5 and v_real_properties < 5);

  -- Esik: ofis ayari (genel ofis satiri once), 3..180 tam sayi degilse varsayilan (settings registry ile ayni sinirlar).
  select t.value into v_setting
  from public.tenant_settings t
  where t.tenant_id = v_tenant and t.key = 'office.alert.deal_stale_days'
  order by (t.scope_id is null) desc, t.updated_at desc
  limit 1;
  v_stale_days := p_stale_days_default;
  if v_setting is not null then
    if jsonb_typeof(v_setting) = 'number' and (v_setting #>> '{}') ~ '^[0-9]+$' then
      v_stale_days := (v_setting #>> '{}')::integer;
    elsif jsonb_typeof(v_setting) = 'string' and (v_setting #>> '{}') ~ '^[0-9]+$' then
      v_stale_days := (v_setting #>> '{}')::integer;
    end if;
    if v_stale_days < 3 or v_stale_days > 180 then
      v_stale_days := p_stale_days_default;
    end if;
  end if;

  -- Bugunun randevulari (loadTodayAppointments): ilk 8 + gercek toplam
  select count(*) into v_appt_total
  from public.appointments a
  where a.tenant_id = v_tenant and a.scheduled_at >= v_day_start and a.scheduled_at < v_day_end
    and (v_include or a.is_sample = false) and (not v_mine or a.assigned_to = v_uid);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.scheduled_at asc), '[]'::jsonb) into v_appt
  from (
    select a.id, a.appointment_type, a.scheduled_at, a.status, a.duration_min, a.location,
           case when c.id is null then null else jsonb_build_object('full_name', c.full_name, 'phone', c.phone) end as customer,
           case when p.id is null then null else jsonb_build_object('lat', p.lat, 'lng', p.lng) end as property
    from public.appointments a
    left join public.customers c on c.id = a.customer_id
    left join public.properties p on p.id = a.property_id
    where a.tenant_id = v_tenant and a.scheduled_at >= v_day_start and a.scheduled_at < v_day_end
      and (v_include or a.is_sample = false) and (not v_mine or a.assigned_to = v_uid)
    order by a.scheduled_at asc
    limit 8
  ) x;

  -- Riskli (hareketsiz) acik anlasma sayisi (loadStaleDeals; /app/anlasmalar?bayat=1 ile ayni kosul)
  select count(*) into v_stale
  from public.deals d
  where d.tenant_id = v_tenant and d.stage not in ('won', 'lost')
    and d.updated_at < v_now - make_interval(days => v_stale_days)
    and (v_include or d.is_sample = false) and (not v_mine or d.assigned_to = v_uid);

  -- Bu ayin hedefleri (loadOfficeTarget / loadMyTarget)
  select jsonb_build_object('target_deals', t.target_deals, 'target_revenue', t.target_revenue) into v_office_target
  from public.targets t
  where t.tenant_id = v_tenant and t.period = 'monthly' and t.period_start = v_month_key and t.profile_id is null
  order by t.updated_at desc nulls last
  limit 1;

  select jsonb_build_object('target_deals', t.target_deals, 'target_revenue', t.target_revenue) into v_my_target
  from public.targets t
  where t.tenant_id = v_tenant and t.period = 'monthly' and t.period_start = v_month_key and t.profile_id = v_uid
  order by t.updated_at desc nulls last
  limit 1;

  return jsonb_build_object(
    'version', 1,
    'computed_at', v_now,
    'scope', p_scope,
    'sample_included', v_include,
    'appointments', jsonb_build_object('total', v_appt_total, 'rows', v_appt),
    'stale_deals', jsonb_build_object('days', v_stale_days, 'count', v_stale),
    'office_target', v_office_target,
    'my_target', v_my_target,
    -- Bos-ofis ayrimi (loadEmptyProbe): silinmemis musteri/portfoy, demo dahil
    'probe', jsonb_build_object(
      'customers', (select count(*) from public.customers c where c.tenant_id = v_tenant and c.deleted_at is null),
      'properties', (select count(*) from public.properties p where p.tenant_id = v_tenant and p.deleted_at is null)
    )
  );
end;
$$;

comment on function public.home_snapshot(text, integer) is
  'Ana ekran ilk ekran okumalari tek JSON: bugunun randevulari, hareketsiz anlasma sayisi (ofis esigi), bu ayin hedefleri, bos-ofis sayaclari. SECURITY INVOKER; p_scope ben|ofis.';

revoke all on function public.home_snapshot(text, integer) from public, anon;
grant execute on function public.home_snapshot(text, integer) to authenticated, service_role;
