-- MIGRATION 20261019040003_rental_withholding_handover.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: sutunlar yokken kira formu kullanim/stopaj alanlarini yazmaz
--   ("etkin degil" uyarisi), tahakkuklar eskisi gibi brut olusur, kira sureci kartinda elle isaretlenen adimlar kaydedilmez.
-- Geri alma: supabase/rollbacks/20261019040003_rental_withholding_handover.rollback.sql
-- BAGIMLILIK: public.rentals, public.rent_charges (20261008001100 paid_amount + 20261012001300 finansal koruma).
--
-- NE:
--  SP9 isyeri kirasi stopaji (defter tasarimi DEGISMEZ; mevcut tahakkuk yapisi kullanilir):
--   rentals.usage ('konut' | 'isyeri'), rentals.withholding_rate (0-50, %; kiraci stopaj kesmiyorsa 0).
--   rent_charges.withholding_amount: tahakkuk aninda kiracinin kesecegi stopaj. BEFORE INSERT tetigi, oran > 0 ise
--   gelen brut tutari NET'e cevirir (amount = brut - stopaj) ve stopaji ayri sutunda tutar. Boylece "eksik odeme" ve
--   gecikme bedeli net uzerinden hesaplanir; brut = amount + withholding_amount (malik ekstresi bu satiri gosterir).
--   Tetik yalniz INSERT'te ve yalniz withholding_amount = 0 gelirse calisir (cron, elle tahakkuk, ice aktarma hepsi kapsanir).
--   Oran degisikligi yalniz SONRAKI tahakkuklari etkiler; olusmus tahakkuk degismez.
--  SP4 kiralik islem sureci: rentals.handover_steps (jsonb nesne, {adim_anahtari: "YYYY-MM-DD"}) elle isaretlenen adimlar.
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.rentals') is null or pg_catalog.to_regclass('public.rent_charges') is null then
    raise exception 'rentals/rent_charges yok; once temel migrationlar uygulanmali.';
  end if;
end $$;

alter table public.rentals add column if not exists usage text not null default 'konut';
alter table public.rentals add column if not exists withholding_rate numeric(5,2) not null default 0;
alter table public.rentals add column if not exists handover_steps jsonb not null default '{}'::jsonb;
alter table public.rent_charges add column if not exists withholding_amount numeric(14,2) not null default 0;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'rentals_usage_check') then
    alter table public.rentals add constraint rentals_usage_check check (usage in ('konut', 'isyeri'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'rentals_withholding_rate_check') then
    alter table public.rentals add constraint rentals_withholding_rate_check
      check (withholding_rate >= 0 and withholding_rate <= 50);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'rentals_handover_steps_check') then
    alter table public.rentals add constraint rentals_handover_steps_check
      check (jsonb_typeof(handover_steps) = 'object' and pg_catalog.length(handover_steps::text) <= 2000);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'rent_charges_withholding_amount_check') then
    alter table public.rent_charges add constraint rent_charges_withholding_amount_check check (withholding_amount >= 0);
  end if;
end $$;

comment on column public.rentals.usage is 'SP9: kullanim konut | isyeri';
comment on column public.rentals.withholding_rate is 'SP9: kiracinin kestigi stopaj orani (%); 0 = stopaj yok. Yalniz sonraki tahakkuklari etkiler.';
comment on column public.rentals.handover_steps is 'SP4: elle isaretlenen kiralik surec adimlari {anahtar: tarih}';
comment on column public.rent_charges.withholding_amount is 'SP9: kiracinin kestigi stopaj; amount NET tahsil edilecek tutardir, brut = amount + withholding_amount';

create or replace function public.apply_rent_charge_withholding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate numeric;
  v_withholding numeric(14,2);
begin
  if coalesce(new.withholding_amount, 0) > 0 or new.amount is null or new.amount <= 0 then
    return new;
  end if;
  select r.withholding_rate
    into v_rate
  from public.rentals r
  where r.id = new.rental_id
    and r.tenant_id = new.tenant_id;
  if v_rate is null or v_rate <= 0 then
    return new;
  end if;
  v_withholding := round(new.amount * v_rate / 100, 2);
  if v_withholding <= 0 or v_withholding >= new.amount then
    return new;
  end if;
  new.withholding_amount := v_withholding;
  new.amount := new.amount - v_withholding;
  return new;
end;
$$;

revoke all on function public.apply_rent_charge_withholding() from public, anon, authenticated;

drop trigger if exists trg_rent_charges_apply_withholding on public.rent_charges;
create trigger trg_rent_charges_apply_withholding
  before insert on public.rent_charges
  for each row execute function public.apply_rent_charge_withholding();
