-- MIGRATION 20260826000800_default_program_settings.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20260826000800_default_program_settings.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20260826000800_default_program_settings.rollback.sql
-- BAGIMLILIK: 20260826000600 (growth_referral_settings + monthly_multiple) ve plan_entitlements (20260802000320).
--   On-kosul blogu eksikse HICBIR sey yazmadan durur.
--
-- AMAC: canli ayarlari panelden elle girmek yerine TEK, IDEMPOTENT seed. SEMA DEGISMEZ (yalniz veri).
-- GENEL ILKE: yonetici paneli bir degeri DEGISTIRDIYSE ona dokunulmaz. "Dokunulmamis" tanimi her kalemde yazilidir
-- (satir yok / bos deger / migration varsayilani). Ikinci calistirma hicbir satiri degistirmez.
--
-- KALEMLER VE GEREKCELER
--  1. growth_reward_rules: davetci kurali (kind 'referral') YOKSA tek satir eklenir:
--       reward_type 'monthly_multiple', reward_value 1  -> davet edilen ofisin ILK gercek odemesindeki 1 aylik paket bedeli (nakit net,
--       KDV haric; yillik fatura /12) kadar TL hesap kredisi. Gerekce: odul paket fiyatiyla olceklenir (Danisman'da ~749, Ofis'te ~2.490 TL);
--       sabit tutar ucuz pakette fazla, pahali pakette az kalirdi; nakde cevrilmeyen kredi oldugu icin EmlakSoft'a maliyeti 1 aylik gelirin altindadir.
--       hold_days 30  -> iade/iptal/chargeback penceresi (kredi ancak 30 gun sonra, abonelikler aktifse).
--       credit_expires_days 365 -> kredi 1 yil gecerli (davetci sonraki faturalarinda kullanir; sonsuz yukumluluk birikmez).
--       duration_months NULL -> davetci odulu TEK SEFERLIDIR; duration_months yalniz ORTAK komisyonunun yinelenme suresi icindir (ayarlarda 12).
--       monthly_cap_try NULL -> TL tavani yok; kotuye kullanimi yillik tavan (12 aylik bedel) ve hiz siniri sinirlar. is_active true.
--     Zaten bir referral kurali varsa (admin ekledi/degistirdi) EKLENMEZ.
--  2. growth_referral_settings (tek satir): YALNIZ hic duzenlenmemisse (updated_by IS NULL ve welcome_credit_try = 0, yani 000600 varsayilani)
--     REFERANS_PROGRAMI.md tasarim degerleriyle yazilir:
--       tier1: 3. basarili referansta +0,5 aylik bedel, rozet 'Gumus Elci'; tier2: 10.'da +2 ay, 'Altin Elci';
--       annual_cap_months 12 (davetci basina son 365 gunde en cok 12 aylik bedel, bonus dahil); velocity_max_per_day 5;
--       min_cash_ratio 0.50 (faturanin en az yarisi nakit degilse inceleme); manual_review_first_n 3 (ilk 3 talep/hos geldin kullanan cift manuel onay).
--     welcome_credit_try = 300 TL, welcome_expires_days 45. Gerekce: en ucuz paket Danisman 749 TL net (KDV'li ~898,8); kredi payi sinirli
--       try_credit.max_invoice_share 0.5 => faturanin en cok ~449 TL'si kredidir; 300 TL bu sinirin ALTINDA oldugundan tamami ilk
--       faturada kullanilabilir (Danisman'da ~%33, Ofis'te ~%10 indirim gibi davranir). 45 gun = 14 gun deneme + ilk odeme tamponu.
--       Ortak (partner_*) degerleri 000600 varsayilaninda birakilir (faz 2 KAPALI).
--  3. Bayraklar (platform_settings; satir YOKSA ya da bossa yazilir, mevcut on/off DEGISMEZ):
--       growth_referral_enabled = on (kullanici karari: musteri-getir-musteri aktif);
--       growth_partner_enabled = off, growth_cash_payout_enabled = off (vergi/stopaj + sozlesme teyidi yok);
--       try_credit.max_invoice_share = 0.5; billing.auto_renew_enabled = false (iyzico sandbox dogrulanmadi).
--       platform.mfa_enforced'a DOKUNULMAZ.
--  4. Paket katalogu: 'billing.plan_definitions' YOKSA/bossa kodun RECOMMENDED_CATALOG_OVERRIDES degerleriyle birebir
--     (serializePlanCatalogSettings biciminde: {v:2, plans, campaign}) yazilir; kampanya KAPALI (DEFAULT_CAMPAIGN).
--     Gerekce: kod varsayilaniyla ayni oldugu icin davranis degismez, ama panel/denetim "tek kayit" gorur. Kayit VARSA degeri korunur;
--     yalniz eski 'customPricing' anahtarlari (kodda artik yok, sanitize zaten yok sayar) plans.* altindan temizlenir.
--     UYARI: kod degeri sonradan degisirse bu kayit onu GOLGELER; katalog degisikligi panelden yapilir (plan-catalog-v4 onbellegi <=300 sn).
--     plan_entitlements: Profesyonel koltuk siniri migration varsayilani 20 ise katalogdaki 15'e cekilir (panel kaydi ayni senkronu yapar);
--     degistirilmisse dokunulmaz. Diger paketlerin siniri katalogla zaten ayni (1/5/50, business 40).
--  5. EmlakFiyati: ef.tariff YOKSA/bossa kod varsayilani (arsa 5, konut 5, ilk PDF 2, detay 0 kontor); ef.packs YOKSA/bos ('' ya da '[]')
--     ise 4 paket (kontor basi net fiyat azalir, efPackWarnings uyarisi uretmez; fiyatlar SAHIP ONERISI, panelden degisir):
--       25 kontor 299 TL (11,96) - 100 kontor 990 TL (9,90, populer) - 300 kontor 2.490 TL (8,30) - 1000 kontor 6.900 TL (6,90).
--     Dolu ise dokunulmaz.

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0. On-kosul
-- ---------------------------------------------------------------------------
do $$
begin
  if pg_catalog.to_regclass('public.growth_reward_rules') is null
     or pg_catalog.to_regclass('public.growth_referral_settings') is null
     or pg_catalog.to_regclass('public.platform_settings') is null
     or pg_catalog.to_regclass('public.plan_entitlements') is null then
    raise exception 'Once 20260826000600_growth_referral_engine.sql (ve plan_entitlements) uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.growth_claims_process(integer)') is null then
    raise exception 'Referans motoru RPC''leri yok: 20260826000600 uygulanmali.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Davetci odul kurali (yoksa)
-- ---------------------------------------------------------------------------
insert into public.growth_reward_rules
  (kind, name, reward_type, reward_value, duration_months, hold_days, monthly_cap_try, credit_expires_days, is_active)
select 'referral', 'Davet odulu: 1 aylik paket bedeli', 'monthly_multiple', 1, null, 30, null, 365, true
where not exists (select 1 from public.growth_reward_rules where kind = 'referral');

-- ---------------------------------------------------------------------------
-- 2. Program ayarlari (yalniz hic duzenlenmemisse)
-- ---------------------------------------------------------------------------
update public.growth_referral_settings set
  welcome_credit_try = 300,
  welcome_expires_days = 45,
  tier1_at = 3, tier1_bonus_months = 0.50, tier1_badge = 'Gümüş Elçi',
  tier2_at = 10, tier2_bonus_months = 2.00, tier2_badge = 'Altın Elçi',
  annual_cap_months = 12.00,
  velocity_max_per_day = 5,
  min_cash_ratio = 0.50,
  manual_review_first_n = 3,
  updated_at = now()
where singleton and updated_by is null and welcome_credit_try = 0;

-- ---------------------------------------------------------------------------
-- 3. Bayraklar ve esikler (satir yok ya da bos ise yaz; dolu degeri koru)
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value) values
  ('growth_referral_enabled', 'on'),
  ('growth_partner_enabled', 'off'),
  ('growth_cash_payout_enabled', 'off'),
  ('try_credit.max_invoice_share', '0.5'),
  ('billing.auto_renew_enabled', 'false')
on conflict (key) do update set value = excluded.value, updated_at = now()
where nullif(btrim(coalesce(public.platform_settings.value, '')), '') is null;

-- ---------------------------------------------------------------------------
-- 4. Paket katalogu: RECOMMENDED_CATALOG_OVERRIDES (src/lib/billing/plan-overrides.ts) ile birebir
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value) values ('billing.plan_definitions', $json$
{"v":2,"plans":{
"advisor":{"monthlyTry":749,"efCreditsMonthly":10,"extraSeatMonthlyTry":499,"maxSeats":500,"seatRounding":"x9"},
"office":{"efCreditsMonthly":40,"extraSeatMonthlyTry":399,"extraSeatTiers":[{"fromSeat":1,"toSeat":5,"monthlyTry":399},{"fromSeat":6,"toSeat":15,"monthlyTry":349},{"fromSeat":16,"toSeat":null,"monthlyTry":299}],"maxSeats":500,"seatRounding":"x9"},
"professional":{"monthlyTry":4990,"extraSeatMonthlyTry":349,"extraSeatTiers":[{"fromSeat":1,"toSeat":10,"monthlyTry":349},{"fromSeat":11,"toSeat":null,"monthlyTry":299}],"maxSeats":500,"seatRounding":"x9","efCreditsMonthly":120,"limits":{"seats":15},"features":["15 kullanıcıya kadar · 10 şube","Kayıp-kaçak komisyon motoru","Danışman KPI, lig ve hedefler","Otomasyon, iş akışı ve onay akışları","KVKK uyum ve ofisler arası ağ"]},
"business":{"monthlyTry":8990,"limits":{"seats":40},"efCreditsMonthly":300},
"enterprise":{"monthlyTry":12900,"efCreditsMonthly":400,"efCreditsPerExtraSeat":6,"extraSeatMonthlyTry":249,"extraSeatTiers":[{"fromSeat":1,"toSeat":50,"monthlyTry":249},{"fromSeat":51,"toSeat":200,"monthlyTry":199},{"fromSeat":201,"toSeat":null,"monthlyTry":149}],"maxSeats":500,"seatRounding":"x9"}
},"campaign":{"name":"Founders","quota":1000,"active":false,"lockPrice":true}}
$json$)
on conflict (key) do update set value = excluded.value, updated_at = now()
where nullif(btrim(coalesce(public.platform_settings.value, '')), '') is null;

-- Mevcut kayitta eski 'customPricing' anahtarlarini temizle (gecersiz JSON ise dokunma).
do $$
declare
  v text;
  j jsonb;
  k text;
  cleaned jsonb;
begin
  select value into v from public.platform_settings where key = 'billing.plan_definitions';
  if v is null then
    return;
  end if;
  begin
    j := v::jsonb;
  exception when others then
    return;
  end;
  if jsonb_typeof(j -> 'plans') is distinct from 'object' then
    return;
  end if;
  cleaned := j -> 'plans';
  for k in select jsonb_object_keys(j -> 'plans') loop
    if jsonb_typeof(cleaned -> k) = 'object' then
      cleaned := jsonb_set(cleaned, array[k], (cleaned -> k) - 'customPricing');
    end if;
  end loop;
  if cleaned is distinct from (j -> 'plans') then
    update public.platform_settings
       set value = jsonb_set(j, '{plans}', cleaned)::text, updated_at = now()
     where key = 'billing.plan_definitions';
  end if;
end $$;

-- Profesyonel koltuk siniri: migration varsayilani (20) -> katalog (15); degistirilmisse dokunma.
update public.plan_entitlements set seat_limit = 15, updated_at = now()
where plan = 'professional' and seat_limit = 20;

-- ---------------------------------------------------------------------------
-- 5. EmlakFiyati tarifesi ve kontor paketleri
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value) values
  ('ef.tariff', '{"valuationArsa":5,"valuationKonut":5,"pdfFirst":2,"reportDetail":0}')
on conflict (key) do update set value = excluded.value, updated_at = now()
where nullif(btrim(coalesce(public.platform_settings.value, '')), '') is null;

insert into public.platform_settings (key, value) values ('ef.packs', $json$
[{"id":"ef-25","name":"25 Kontör","units":25,"priceNetTry":299,"active":true,"order":10},
{"id":"ef-100","name":"100 Kontör","units":100,"priceNetTry":990,"active":true,"popular":true,"order":20},
{"id":"ef-300","name":"300 Kontör","units":300,"priceNetTry":2490,"active":true,"order":30},
{"id":"ef-1000","name":"1000 Kontör","units":1000,"priceNetTry":6900,"active":true,"order":40}]
$json$)
on conflict (key) do update set value = excluded.value, updated_at = now()
where nullif(btrim(coalesce(public.platform_settings.value, '')), '') is null
   or btrim(public.platform_settings.value) = '[]';
