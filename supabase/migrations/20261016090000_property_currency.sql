-- MIGRATION 20261016090000_property_currency.sql
-- SK9 (2026-10-16): portföy fiyatının para birimi kolonu (B094).
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI `npm run db:migrate` ile uygular.
-- Geri alma: supabase/rollbacks/20261016090000_property_currency.rollback.sql (ONCE 20261016090100 geri alinir).
-- BAGIMLILIK: public.properties (features jsonb, price_health).
--
-- AMAC: para birimi yalniz portal ek alani olarak features.currency'de ('TL' | 'USD' | 'EUR') duruyordu; liste, detay,
--   doviz satiri, fiyat sagligi ve komisyon bunu hic okumuyordu ("$850.000" villa "₺850.000 ≈ $17.209", "Riskli %97,8").
--   Tek kaynak: properties.currency text not null default 'TRY' check (TRY | USD | EUR).
--   Paketler arasi sozlesme (f): uygulama hem bu kolona hem features.currency'ye yazar; herkese acik yuzeyler (SK8)
--   features.currency okumaya devam eder.
-- VERI:
--   * Backfill: features.currency USD/EUR olan kayitlarin kolonu ayni degere cekilir (diger kayitlar varsayilan TRY).
--   * Turetilmis onbellek: doviz fiyatli kayitlarin price_health degeri HAM doviz tutariyla (₺ sanilarak) hesaplanmisti
--     (sahte "Riskli"). Doviz kayitlarinda price_health bosaltilir; kayit/duzenleme ve gece tazelemesi (portal-teyit)
--     artik ₺ karsiligiyla (TCMB satis kuru) yeniden yazar; kur yoksa bos kalir ("doviz: degerlendirilemedi").
-- ETKI: davranis (yeni kolon + CHECK; 1 satir backfill + doviz kayitlarinda turetilmis price_health temizligi).
--   NOT NULL + sabit varsayilan PG11+ ile tablo yeniden yazmaz (yalniz katalog). CHECK NOT VALID + VALIDATE (kisa kilit).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.properties') is null then
    raise exception 'public.properties yok.';
  end if;
end $$;

alter table public.properties add column if not exists currency text not null default 'TRY';

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'properties_currency_check' and conrelid = 'public.properties'::regclass
  ) then
    alter table public.properties
      add constraint properties_currency_check check (currency in ('TRY', 'USD', 'EUR')) not valid;
  end if;
end $$;

alter table public.properties validate constraint properties_currency_check;

comment on column public.properties.currency is
  'Liste fiyatinin para birimi (TRY | USD | EUR). Uygulama features.currency (TL | USD | EUR) ile birlikte yazar (SK9 sozlesme f).';

-- Backfill: yalniz features.currency USD/EUR olup kolonu hala varsayilan TRY olan kayitlar (idempotent).
update public.properties p
set currency = upper(btrim(p.features ->> 'currency'))
where p.currency = 'TRY'
  and upper(btrim(coalesce(p.features ->> 'currency', ''))) in ('USD', 'EUR');

-- Turetilmis price_health temizligi (yukaridaki aciklama). Migration koda (SK9) ONCE uygulandigi icin o anda var olan
-- doviz kayitlarinin bandi eski (ham doviz tutarli) hesaptir. Yeniden kosulmasi zararsizdir: yalniz turetilmis onbellek
-- bosalir, kayit/duzenleme ve gece tazelemesi ₺ karsiligiyla yeniden yazar.
update public.properties p
set price_health = null
where p.currency <> 'TRY'
  and p.price_health is not null;
