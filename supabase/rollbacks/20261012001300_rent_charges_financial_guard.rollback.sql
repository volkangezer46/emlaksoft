-- Rollback: 20261012001300_rent_charges_financial_guard
-- Iki tetikleyici ve fonksiyonlari duser. record_rent_payment / void_rent_payment / pm_recompute_charge govdelerine
-- bu migration dokunmadigindan geri yuklenecek eski govde YOKTUR (20261008001100 aynen kalir).
-- DIKKAT: geri alinca rentals:edit yetkili kullanici rent_charges tutar/durumunu dogrudan degistirebilir, odemeli tahakkuk silinebilir.

set local lock_timeout = '5s';

drop trigger if exists trg_rent_charges_financial_guard on public.rent_charges;
drop trigger if exists trg_rent_charges_delete_guard on public.rent_charges;
drop function if exists public.guard_rent_charge_update();
drop function if exists public.guard_rent_charge_delete();

notify pgrst, 'reload schema';
