-- 20261019040003 geri alma: stopaj tetigi ve sutunlari, kiralik surec adimlari duser. DIKKAT: olusmus tahakkuklarin
--   amount degeri NET kalir (stopaj ayri sutunla birlikte silinir); gerekiyorsa geri almadan once brut tutar
--   amount + withholding_amount olarak raporlanmalidir. Yeni tahakkuklar yeniden brut olusur.
set local lock_timeout = '5s';

drop trigger if exists trg_rent_charges_apply_withholding on public.rent_charges;
drop function if exists public.apply_rent_charge_withholding();
alter table public.rent_charges drop constraint if exists rent_charges_withholding_amount_check;
alter table public.rent_charges drop column if exists withholding_amount;
alter table public.rentals drop constraint if exists rentals_usage_check;
alter table public.rentals drop constraint if exists rentals_withholding_rate_check;
alter table public.rentals drop constraint if exists rentals_handover_steps_check;
alter table public.rentals drop column if exists usage;
alter table public.rentals drop column if exists withholding_rate;
alter table public.rentals drop column if exists handover_steps;
