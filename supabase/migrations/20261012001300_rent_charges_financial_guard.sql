-- MIGRATION 20261012001300_rent_charges_financial_guard.sql (GUVENLIK-2: kira tahakkuku finansal sutunlari yalniz RPC ile degisir)
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261012001300_rent_charges_financial_guard.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261012001300_rent_charges_financial_guard.rollback.sql
--
-- NEDEN: 20261008001100 ile tahsilat YALNIZ record_rent_payment / void_rent_payment RPC'leriyle yazilmasi amaclandi (makbuz,
--   yontem, denetim izi, ucret kopyasi). Ancak rent_charges uzerinde eski `workflow_rent_charges_update` (rentals:edit) ve
--   `..._delete` (rentals:delete) politikalari duruyor ve `grant all ... to authenticated` hala gecerli: rentals:edit yetkili
--   bir kullanici (orn. sube muduru) PostgREST ile dogrudan
--     PATCH rent_charges {paid_amount: 10000, status: 'paid'}      -> makbuzsuz, izsiz "tahsil edildi"
--     PATCH rent_charges {amount: 1}                               -> tahakkuk tutarini dusurur
--     DELETE rent_charges                                          -> odemeli tahakkuku (ve cascade ile rent_payments'i) siler
--   yapabilir; tahsilat defteri ile tahakkuk durumu ayrisir, mulk sahibi hakedisi bozulur.
--
-- ENVANTER (kod; `grep -rn "rent_charges" src scripts`), yazan yollar:
--   * INSERT : src/app/actions/rentals.ts createRentCharge (RLS'li kullanici) ve cron/kira-tahakkuk (admin) -> tetikleyiciden etkilenmez
--              (yalniz UPDATE/DELETE izlenir); sample-data seed'leri ve scripts/seed-demo.ts service_role.
--   * UPDATE : (1) src/app/actions/rentals.ts toggleChargePaid (ESKI yol: rent_payments tablosu varsa action zaten reddeder;
--              bu migration rent_payments'a bagli oldugundan o yol artik olu) -> status/paid_at yazar, ENGELLENIR (istenen);
--              (2) cron/kira-tahakkuk status='overdue' (admin = service_role) -> etkilenmez;
--              (3) scripts/seed-demo.ts amount (service_role) -> etkilenmez;
--              (4) pm_recompute_charge (SECURITY DEFINER; record/void RPC'lerinin ortak yazari) paid_amount/status/paid_at -> GECER.
--   * DELETE : uygulama kodunda kullanici DELETE'i YOK. purge_tenant_sample_data (DEFINER, owner/gm tetikler) ornek kira
--              tahakkuklarini siler -> ornek kira (rentals.is_sample) muaf tutulur. Kiralama silinirse FK cascade de bu tetikleyiciye uyar.
--   * Salt okuma: kiralama sayfalari, rapor merkezi, malik raporu, portal (admin) -> etkilenmez.
--   Uygulamanin meşru guncelledigi finansal OLMAYAN bir rent_charges sutunu yoktur (tablo: id, tenant_id, rental_id, period,
--   amount, status, paid_at, created_at, paid_amount).
--
-- NE YAPAR:
--   1. BEFORE UPDATE guard_rent_charge_update(): auth.role()='authenticated' VE dogrudan istemci rolu (current_user='authenticated')
--      iken id, tenant_id, rental_id, period, amount, paid_amount, status, paid_at degisirse 42501
--      (period spec listesine eklendi: donem kaydirmak da defteri bozar; hicbir kod yolu period guncellemez). created_at serbest.
--   2. BEFORE DELETE guard_rent_charge_delete(): auth.role()='authenticated' iken tahakkukun herhangi bir rent_payments satiri
--      varsa (iptal edilmis dahil: makbuz numarasi ve iz kaybolmasin) 42501. Ornek kira muaf.
--
-- TASARIM KARARI (RPC gecisi): spec transaction-local bayrak (set_config('app.rent_charge_rpc','1',true)) ve record/void
--   RPC govdelerinin yeniden yazilmasini onerdi. Daha sade ve sahteciligi imkansiz bir yol secildi: UPDATE tetikleyicisi
--   SECURITY INVOKER yazildi ve `current_user` ile ayrim yapar. PostgREST istegi `SET LOCAL ROLE authenticated` ile calisir;
--   dogrudan PATCH'te current_user='authenticated'dir. record/void RPC'leri SECURITY DEFINER (sahibi postgres) oldugundan
--   pm_recompute_charge icindeki UPDATE'te current_user='postgres'tir -> otomatik gecer. Avantajlar: (a) bayrak gibi
--   unutulabilen/sahtelenebilen bir ara durum yok; ileride eklenecek baska bir DEFINER yazici da kendiliginden gecer,
--   (b) 20261008001100 govdeleri (md5/sozlesme testleri) DEGISMEZ, geri alma tetikleyicileri dusurmekten ibarettir.
--   service_role/cron/migration oturumlarinda current_user authenticated degildir -> etkilenmez.
-- ETKI: ek (iki tetikleyici). Satir/veri degismez. Uygulamanin kullandigi yollar (RPC, cron, seed) etkilenmez.
-- RISK: dusuk. Eski toggleChargePaid yolu (rent_payments yokken) artik zaten kullanilamaz. Ornek veri temizleme korunur.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.rent_charges') is null
     or pg_catalog.to_regclass('public.rent_payments') is null
     or pg_catalog.to_regclass('public.rentals') is null
     or pg_catalog.to_regprocedure('public.pm_recompute_charge(uuid)') is null
     or pg_catalog.to_regprocedure('public.record_rent_payment(uuid,numeric,date,text,text)') is null
     or pg_catalog.to_regprocedure('public.void_rent_payment(uuid,text)') is null then
    raise exception '20261012001300: rent_charges/rent_payments/pm_recompute_charge veya record/void RPC''leri yok; once 20261008001100 uygulanmali.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rent_charges' and column_name = 'paid_amount'
  ) then
    raise exception '20261012001300: rent_charges.paid_amount yok; once 20261008001100 uygulanmali.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rentals' and column_name = 'is_sample'
  ) then
    raise exception '20261012001300: rentals.is_sample yok; once 20260816001600 uygulanmali.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) UPDATE: finansal sutunlar yalniz DEFINER RPC'lerle
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER bilerek: current_user cagiran rolu gosterir (DEFINER RPC icinde postgres, dogrudan PATCH'te authenticated).
create or replace function public.guard_rent_charge_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' or current_user <> 'authenticated' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.rental_id is distinct from old.rental_id
     or new.period is distinct from old.period
     or new.amount is distinct from old.amount
     or new.paid_amount is distinct from old.paid_amount
     or new.status is distinct from old.status
     or new.paid_at is distinct from old.paid_at then
    raise exception 'Kira tahakkukunun tutar/durum/odeme alanlari dogrudan degistirilemez; tahsilat kaydi (Odeme al / iptal) kullanilir.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_rent_charge_update() is
  'rent_charges BEFORE UPDATE: authenticated istemci id/tenant/rental/period/amount/paid_amount/status/paid_at degistiremez (42501). record/void RPC (DEFINER), service_role ve cron etkilenmez.';
revoke all on function public.guard_rent_charge_update() from public, anon, authenticated;

drop trigger if exists trg_rent_charges_financial_guard on public.rent_charges;
create trigger trg_rent_charges_financial_guard
  before update on public.rent_charges
  for each row execute function public.guard_rent_charge_update();

-- ---------------------------------------------------------------------------
-- 2) DELETE: tahsilat kaydi olan tahakkuk silinemez
-- ---------------------------------------------------------------------------
create or replace function public.guard_rent_charge_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return old;
  end if;

  -- Ornek (demo) kira: purge_tenant_sample_data ornek tahakkuklari siler.
  if exists (select 1 from public.rentals r where r.id = old.rental_id and r.tenant_id = old.tenant_id and r.is_sample = true) then
    return old;
  end if;

  -- Iptal edilmis tahsilat da iz tasir (makbuz no, neden); tahakkuk silinirse FK cascade ile kaybolurdu.
  if exists (select 1 from public.rent_payments p where p.charge_id = old.id) then
    raise exception 'Tahsilat kaydi olan kira tahakkuku silinemez.' using errcode = '42501';
  end if;

  return old;
end;
$$;

comment on function public.guard_rent_charge_delete() is
  'rent_charges BEFORE DELETE: authenticated icin rent_payments satiri (iptal dahil) olan tahakkuk silinemez (42501); ornek kira muaf.';
revoke all on function public.guard_rent_charge_delete() from public, anon, authenticated;

drop trigger if exists trg_rent_charges_delete_guard on public.rent_charges;
create trigger trg_rent_charges_delete_guard
  before delete on public.rent_charges
  for each row execute function public.guard_rent_charge_delete();

notify pgrst, 'reload schema';

-- DOGRULAMA (salt-okunur, uygulamadan SONRA):
-- select tgname from pg_trigger where tgrelid = 'public.rent_charges'::regclass and not tgisinternal;
-- BEKLENEN: trg_rent_charges_financial_guard, trg_rent_charges_delete_guard (+ varsa onceki tetikleyiciler).
