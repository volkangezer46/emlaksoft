-- MIGRATION 20261012002220_detail_read_rpcs.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261012002220_detail_read_rpcs.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261012002220_detail_read_rpcs.rollback.sql
-- BAGIMLILIK: public.deals, public.offers, public.appointments, public.properties, public.region_stats_history,
--   public.current_tenant_id().
--
-- AMAC (HIZ-3): detay sayfalarinda ana satira ZINCIRLENEN / ona bagli okumalar ana sorguyla AYNI turda calissin.
--   deal_side_reads(p_deal_id):   anlasmanin portfoy+musteri ikilisinin teklifleri (son 10) + iptal olmayan randevu sayisi.
--     Sayfa once deals satirini okur, sonra teklif ve randevu sayimini ayri iki sorguyla ceker; RPC deal_id'den kendisi cozer,
--     deals okumasiyla birlikte baslatilir (2 PostgREST istegi azalir, zincir kalkar).
--   property_region_days(p_property_id): portfoyun ilcesi + islem turu icin region_stats_history en guncel avg_days_listed.
--     Sayfa once properties satirini okuyup (district_id, transaction_type) ardindan ayri sorgu atiyordu (zincir);
--     RPC property_id'den kendisi cozer, yalniz yayinda/aktif portfoy icin (isDiagnosable ile ayni kural) deger doner.
-- GUVENLIK: SECURITY INVOKER (RLS cagiranin yetkisiyle: gorunmeyen satir NULL/bos doner). Ek olarak tenant kontrolu.
-- ETKI: yalniz 2 yeni fonksiyon (ek). Tablo/politika/veri degismez.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.deals') is null or pg_catalog.to_regclass('public.offers') is null
     or pg_catalog.to_regclass('public.appointments') is null or pg_catalog.to_regclass('public.properties') is null
     or pg_catalog.to_regclass('public.region_stats_history') is null then
    raise exception 'deals/offers/appointments/properties/region_stats_history tablolarindan biri yok.';
  end if;
  if pg_catalog.to_regprocedure('public.current_tenant_id()') is null then
    raise exception 'current_tenant_id() yok.';
  end if;
end $$;

create or replace function public.deal_side_reads(p_deal_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case when auth.uid() is null or public.current_tenant_id() is null then null else (
    select jsonb_build_object(
      'offers', case when d.property_id is null or d.customer_id is null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', o.id, 'amount', o.amount, 'status', o.status, 'valid_until', o.valid_until, 'created_at', o.created_at
        ) order by o.created_at desc)
        from (
          select o1.* from public.offers o1
          where o1.tenant_id = d.tenant_id and o1.property_id = d.property_id and o1.customer_id = d.customer_id
          order by o1.created_at desc limit 10
        ) o
      ), '[]'::jsonb) end,
      'appointment_count', case when d.property_id is null or d.customer_id is null then 0 else (
        select count(*) from public.appointments a
        where a.tenant_id = d.tenant_id and a.property_id = d.property_id and a.customer_id = d.customer_id and a.status <> 'cancelled'
      ) end
    )
    from public.deals d
    where d.id = p_deal_id and d.tenant_id = public.current_tenant_id()
  ) end;
$$;

create or replace function public.property_region_days(p_property_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case when auth.uid() is null or public.current_tenant_id() is null then null else coalesce((
    select jsonb_build_object('avg_days_listed', (
      select r.avg_days_listed
      from public.region_stats_history r
      where r.tenant_id = p.tenant_id
        and r.district_id = p.district_id
        and r.tx_type = case
          when coalesce(p.transaction_type, '') ~* 'kira' then 'Kiralık'
          when coalesce(p.transaction_type, '') ~* 'sat' then 'Satılık'
          else 'Tümü' end
      order by r.period desc
      limit 1
    ))
    from public.properties p
    where p.id = p_property_id
      and p.tenant_id = public.current_tenant_id()
      and p.deleted_at is null
      and p.district_id is not null
      and p.status in ('live', 'active')
  ), jsonb_build_object('avg_days_listed', null)) end;
$$;

notify pgrst, 'reload schema';
