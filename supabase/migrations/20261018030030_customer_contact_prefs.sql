-- MIGRATION 20261018030030_customer_contact_prefs.sql
-- CRM-G11 (2026-10-18): musteri iletisim tercihi — tercih edilen kanal, uygun zaman dilimi, dil.
-- Geri alma: supabase/rollbacks/20261018030030_customer_contact_prefs.rollback.sql (girilen tercihler KAYBOLUR;
--   kod sutunlar yokken tercih kartini "kurulum bekliyor" gosterir, sonraki en iyi eylem tercihsiz calisir).
-- BAGIMLILIK: 20260721000000_init.sql (customers).
--
-- NE: customers.preferred_channel text NULL (call | whatsapp | sms | email)
--     customers.contact_window text[] NOT NULL default '{}' (sabah | ogle | ogleden_sonra | aksam | hafta_sonu)
--     customers.preferred_language text NULL (ISO 639-1, iki kucuk harf)
-- NEDEN: "Arama, WhatsApp'tan yazin", "aksam 18'den sonra" gibi istekler kayda gecsin; Musteri 360 rozeti ve sonraki
--   en iyi eylem birincil dugmeyi ve uygun saat uyarisini buradan alir.
-- GUVENLIK: customers RLS'i ve yetkileri degismez; yeni sutunlar ayni politikayla korunur. Yazma yalniz
--   customers:edit kapili server action ile (src/app/actions/customer-contact-prefs.ts), tenant filtresiyle.
-- ETKI: yalniz ek (nullable/defaultlu sutun + CHECK). Mevcut satir/politika/davranis degismez. Idempotent.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.customers') is null then
    raise exception 'customers yok: once 20260721000000_init.sql uygulanmali.';
  end if;
end $$;

alter table public.customers
  add column if not exists preferred_channel text,
  add column if not exists contact_window text[] not null default '{}'::text[],
  add column if not exists preferred_language text;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'customers_preferred_channel_check' and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
      add constraint customers_preferred_channel_check
      check (preferred_channel is null or preferred_channel in ('call', 'whatsapp', 'sms', 'email'));
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'customers_contact_window_check' and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
      add constraint customers_contact_window_check
      check (contact_window <@ array['sabah', 'ogle', 'ogleden_sonra', 'aksam', 'hafta_sonu']::text[]);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'customers_preferred_language_check' and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
      add constraint customers_preferred_language_check
      check (preferred_language is null or preferred_language ~ '^[a-z]{2}$');
  end if;
end $$;

comment on column public.customers.preferred_channel is
  'Tercih edilen iletisim kanali (call | whatsapp | sms | email); bos = tercih yok. Musteri 360 ve sonraki en iyi eylem okur.';
comment on column public.customers.contact_window is
  'Uygun iletisim zaman dilimleri (sabah | ogle | ogleden_sonra | aksam | hafta_sonu; Istanbul saati). Bos = kisit yok.';
comment on column public.customers.preferred_language is
  'Tercih edilen iletisim dili (ISO 639-1, ornek tr, en, ru); bos = Turkce varsayilir.';
