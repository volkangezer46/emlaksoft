-- MIGRATION 20261017010300_finance_parties_backfill.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- Tasarim: docs/design/FINANS_ENTEGRASYON_2026-10.md, WP2 "cari + geri doldurma".
-- Geri alma: supabase/rollbacks/20261017010300_finance_parties_backfill.rollback.sql (yalniz fonksiyon duser; acilan cariler,
--   tahakkuk kalemleri ve hareket baglari YERINDE KALIR: silme yok, nakit yazilmadigi icin kasa bakiyesi degismez).
-- BAGIMLILIK: 20261017010200_finance_accrual_triggers (esitleyiciler + finance_accrual_party + offbook_amount).
--
-- NE (IDEMPOTENT: iki kez calismasi hicbir sey degistirmez; kaynak satirlar esitleyicinin "istenen durum" karsilastirmasindan gecer):
--  1) Cariler (ON CONFLICT DO NOTHING; ayni ad baska kayda bagliysa kisa ek):
--       danisman  -> pay (commission_splits.profile_id) ya da hakedis (commission_payouts.profile_id) sahibi profiller, user_id bagli
--       musteri   -> komisyonu olan anlasmalarin musterisi (customer_id bagli)
--       kiraci    -> kiralamalarin kiracisi; bina aidati odeyen kiraci
--       malik     -> kiralanan / aidati tahakkuk eden portfoyun maliki; bina aidati odeyen daire sahibi
--     Ornek (is_sample) satirlar atlanir.
--  2) Tahakkuk kalemleri posting_key ile: her komisyon (+ paylari), her hakedis, her bina aidati esitleyiciden gecer.
--     Kilitli aya dusen kalem ilk acik aya tarihlenir ve notla isaretlenir (finance_post_internal).
--  3) Eski yol tahsilat hareketleri source_id ile kaleme baglanir (yalniz open_item_id; kilitli ayda da serbest).
--  4) Kasa disi: odenmis hakedis / komisyon / aidat icin hareket UYDURULMAZ; kalem offbook_amount ile kapanir, notuna
--     'kasa dışı' duser ve mutabakat kuyrugunda gorunur.
-- GUVENLIK: fonksiyon SECURITY DEFINER + search_path=''; yalniz service_role (istemciye kapali).
-- ETKI: veri (yeni cari + acik kalem satirlari; mevcut hareketlerde yalniz open_item_id dolar).
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.finance_commission_accrual_sync(uuid)') is null
     or pg_catalog.to_regprocedure('public.finance_payout_accrual_sync(uuid)') is null
     or pg_catalog.to_regprocedure('public.finance_building_accrual_sync(uuid)') is null
     or pg_catalog.to_regprocedure('public.finance_accrual_party(uuid,text,text,uuid,uuid)') is null
     or pg_catalog.to_regclass('public.rentals') is null
     or pg_catalog.to_regclass('public.properties') is null
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.finance_open_items'::regclass and attname = 'offbook_amount' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.rentals'::regclass and attname = 'is_sample' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.profiles'::regclass and attname = 'is_sample' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.properties'::regclass and attname = 'owner_customer_id' and not attisdropped) then
    raise exception '20261017010300: once 20261017010200 (tahakkuk tetikleyicileri) ve 20260825000100 (properties.owner_customer_id) uygulanmali.';
  end if;
end $$;

create or replace function public.finance_accrual_backfill()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_parties_before bigint;
  v_items_before bigint;
  v_links_before bigint;
  v_commissions integer := 0;
  v_payouts integer := 0;
  v_charges integer := 0;
begin
  select count(*) into v_parties_before from public.finance_parties;
  select count(*) into v_items_before from public.finance_open_items;
  select count(*) into v_links_before from public.cash_entries where open_item_id is not null;

  -- 1) Cariler
  for r in
    select distinct x.tenant_id, x.profile_id, pf.full_name
      from (select s.tenant_id, s.profile_id from public.commission_splits s
              join public.commissions c on c.id = s.commission_id and c.tenant_id = s.tenant_id
             where s.profile_id is not null and c.is_sample = false
            union
            select cp.tenant_id, cp.profile_id from public.commission_payouts cp where cp.profile_id is not null) x
      join public.profiles pf on pf.id = x.profile_id and pf.tenant_id = x.tenant_id and pf.is_sample = false
     order by x.tenant_id, x.profile_id
  loop
    perform public.finance_accrual_party(r.tenant_id, 'danisman', r.full_name, null, r.profile_id);
  end loop;

  for r in
    select distinct d.tenant_id, d.customer_id, cu.full_name
      from public.commissions c
      join public.deals d on d.id = c.deal_id and d.tenant_id = c.tenant_id
      join public.customers cu on cu.id = d.customer_id and cu.tenant_id = d.tenant_id
     where c.is_sample = false and d.customer_id is not null
     order by d.tenant_id, d.customer_id
  loop
    perform public.finance_accrual_party(r.tenant_id, 'musteri', r.full_name, r.customer_id, null);
  end loop;

  for r in
    select distinct x.tenant_id, x.customer_id, x.kind, cu.full_name
      from (select rt.tenant_id, rt.renter_customer_id as customer_id, 'kiraci'::text as kind
              from public.rentals rt where rt.is_sample = false and rt.renter_customer_id is not null
            union
            select rt.tenant_id, pr.owner_customer_id, 'malik'
              from public.rentals rt
              join public.properties pr on pr.id = rt.property_id and pr.tenant_id = rt.tenant_id
             where rt.is_sample = false and pr.owner_customer_id is not null
            union
            select bc.tenant_id, bc.payer_customer_id, case when bc.payer_role = 'tenant' then 'kiraci' else 'malik' end
              from public.building_charges bc where bc.payer_customer_id is not null) x
      join public.customers cu on cu.id = x.customer_id and cu.tenant_id = x.tenant_id
     order by x.tenant_id, x.customer_id, x.kind
  loop
    perform public.finance_accrual_party(r.tenant_id, r.kind, r.full_name, r.customer_id, null);
  end loop;

  -- 2-4) Tahakkuk kalemleri + eski yol hareket bagi + kasa disi taban (esitleyiciler idempotent)
  for r in select c.id from public.commissions c where c.is_sample = false order by c.tenant_id, c.created_at, c.id loop
    perform public.finance_commission_accrual_sync(r.id);
    v_commissions := v_commissions + 1;
  end loop;
  for r in select cp.id from public.commission_payouts cp order by cp.tenant_id, cp.created_at, cp.id loop
    perform public.finance_payout_accrual_sync(r.id);
    v_payouts := v_payouts + 1;
  end loop;
  for r in select bc.id from public.building_charges bc order by bc.tenant_id, bc.created_at, bc.id loop
    perform public.finance_building_accrual_sync(r.id);
    v_charges := v_charges + 1;
  end loop;

  return jsonb_build_object(
    'commissions', v_commissions, 'payouts', v_payouts, 'building_charges', v_charges,
    'new_parties', (select count(*) from public.finance_parties) - v_parties_before,
    'new_items', (select count(*) from public.finance_open_items) - v_items_before,
    'new_cash_links', (select count(*) from public.cash_entries where open_item_id is not null) - v_links_before);
end;
$$;

revoke all on function public.finance_accrual_backfill() from public, anon, authenticated;
grant execute on function public.finance_accrual_backfill() to service_role;
comment on function public.finance_accrual_backfill() is
  'WP2 geri doldurma (idempotent): danisman/musteri/kiraci/malik carileri + komisyon/pay/hakedis/bina aidati tahakkuk kalemleri (posting_key) + eski yol tahsilat bagi + kasa disi taban. Nakit yazmaz.';

do $$
declare
  v jsonb;
begin
  v := public.finance_accrual_backfill();
  raise notice '20261017010300: geri doldurma %', v;
end $$;
