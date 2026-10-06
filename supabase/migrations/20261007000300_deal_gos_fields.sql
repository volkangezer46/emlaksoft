-- Anlasma: Guvenli Odeme Sistemi (GOS) referans no + tapu randevu tarihi.
--
-- AMAC: 1 Aralik 2026'dan itibaren nakit/havale/EFT ile odenen tasinmaz satislarinda bedel tescille es zamanli GOS
-- uzerinden aktarilir (src/lib/gos-info.ts tek kaynak). Ofis, anlasma kaydinda bankanin/sistemin verdigi GOS islem
-- referansini ve tapu randevu tarihini tutar; kapanis listesindeki GOS adimlari bu iki alanla takip edilir.
-- Para EmlakSoft'tan GECMEZ: bu kolonlar yalniz bilgi kaydidir (tutar, IBAN, hesap bilgisi TUTULMAZ).
--
-- DEGISIKLIK: public.deals'a iki nullable kolon (+ uzunluk/bicim CHECK). Mevcut satirlara dokunulmaz.
-- RLS: deals'in mevcut politikalari gecerli (yeni politika yok). Yazma: src/app/actions/deal-gos.ts
--   (requirePermission("commissions","edit") + tenant esitligi).
-- BAGIMLILIK: public.deals (init). GERI ALMA: rollbacks/20261007000300_deal_gos_fields.rollback.sql (girilen degerler silinir).
-- RISK: dusuk (yalniz ekleme). Kod kolonlar yokken bolumu "etkin degil" diye gosterir, kaydi bozmaz.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.deals') is null then
    raise exception 'public.deals yok; once temel migrationlar uygulanmali.';
  end if;
end $$;

alter table public.deals
  add column if not exists gos_reference_no text,
  add column if not exists title_deed_appointment_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deals_gos_reference_no_format' and conrelid = 'public.deals'::regclass) then
    alter table public.deals
      add constraint deals_gos_reference_no_format
      check (gos_reference_no is null or gos_reference_no ~ '^[A-Za-z0-9./ _-]{3,64}$');
  end if;
end $$;

create index if not exists idx_deals_tenant_title_deed_at
  on public.deals (tenant_id, title_deed_appointment_at)
  where title_deed_appointment_at is not null;

comment on column public.deals.gos_reference_no is
  'Guvenli Odeme Sistemi islem referansi (bilgi kaydi; para urunden gecmez). Harf/rakam/./ _- 3-64 karakter.';
comment on column public.deals.title_deed_appointment_at is
  'Tapu randevu tarihi/saati (GOS: bloke onayindan sonra alinir).';

notify pgrst, 'reload schema';
