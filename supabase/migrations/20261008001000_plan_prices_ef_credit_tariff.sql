-- MIGRATION 20261008001000_plan_prices_ef_credit_tariff.sql (P1 fiyatlandirma, 2026-10-08; kontor modeli 2026-10-10'da guncellendi: yalniz degerleme + sureli paket)
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261008001000_plan_prices_ef_credit_tariff.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261008001000_plan_prices_ef_credit_tariff.rollback.sql
-- BAGIMLILIK: 20260825000300 (plan_catalog_document / plan_monthly_amount) ve platform_settings. On-kosul eksikse HICBIR sey yazmadan durur.
--
-- KARAR (sahip, 2026-10-08): EmlakSoft rakiplerin %25-30 altinda; ek kullanici dahil tum ozellikler her pakette.
--   Danisman 749 (degismez) · Ofis 2.490 -> 2.790 · Profesyonel 4.990 -> 5.490 · Kurumsal 12.900 -> 14.900 · Business (gizli) 8.990 (degismez).
--   Ek kullanici (TS plans.ts / RECOMMENDED_CATALOG_OVERRIDES): Danisman 559; Ofis 499/449/399; Profesyonel 449/399; Kurumsal 289/249/199.
--   Bu dosyanin SQL'e dokundugu tek fiyat noktasi plan_monthly_amount()'un YEDEK tablosudur (ayar yok / bu plan icin gecerli fiyat yok).
--   Ek kullanici kademeleri ve kontor haklari TS tarafindadir (SQL'de kopyasi yok; plan_entitlements dahil kullanici sayilarini tutar, degismez).
--
-- BU DOSYA NE YAPMAZ:
--   * 'billing.plan_definitions' (admin override'i) DEGISTIRILMEZ — admin karari. Kayit varsa onun plan basina monthlyTry degeri
--     gecerlidir (kayitta olmayan plan alani plans.ts yeni tabanina duser); panel "onerilen katalogu uygula" ile guncellenir.
--   * subscriptions / invoices satirlarina DOKUNMAZ: mevcut abonelik tutarlari (amount_try) ve price_lock_* aynen kalir.
--
-- EmlakFiyati KONTOR AYARLARI (1 kontor = 1 TL; SAHIP KARARI 2026-10-10): kontor YALNIZ DEGERLEME icin harcanir (ilan analizi, PDF,
--   rapor detayi kontorsuz) ve kontorler SURELIDIR (paketler 1/3/6/12 aylik; kullanilmayan kontor sure sonunda yanar).
--   Yalniz "DOKUNULMAMIS" kayitlar yeni varsayilana cekilir; tanim = degeri 20260826000800 / 20260826001200 seed'iyle BIREBIR
--   AYNI olan kayit (jsonb esitligi). Admin degistirdiyse ya da satir yoksa dokunulmaz (satir yoksa kod varsayilani zaten yenidir).
--   Mevcut kontor BAKIYELERI ve hareket defteri BU dosyada degismez (suresiz bakiyeler 20261010000300 ile 12 aylik partiye doner).
--     ef.tariff   : {"valuationArsa":5,"valuationKonut":5,"pdfFirst":2,"reportDetail":0}
--                   -> {"valuationArsa":850,"valuationKonut":700,"valuationTicari":1050}   (yalniz degerleme kalemleri)
--     ef.packs    : 25/299 - 100/990 - 300/2490 - 1000/6900 seti (suresiz) -> SURELI katalog: aylik 1.000/2.500/5.000 kontor x
--                   1/3/6/12 ay = 12 paket; 3 ay %5, 6 ay %10, 12 ay %15 indirim (KDV haric). Paket {units = TOPLAM kontor, months}.
--                   Admin /admin/ef-kontor'dan fiyat/sure/aktiflik duzenler. Katalog TS kaynagi: config.ts buildDefaultEfPacks()
--                   (sozlesme testi bu dosyadaki JSON'u TS ile birebir karsilastirir).
--     ef.welcome_units : '10' -> '100' (hos geldin kontoru 30 gun sonra yanar; 20261010000300 ef_credit_grant bonus dali)
-- SIRA: bu dosya 20261010000300'dan ONCE uygulanir (dosya adi sirasi). Paket SATISI zaten ef_credit_lots_ready() true olmadan
--   acilmaz; yani katalog seed'i lot sistemi gelmeden de zararsizdir.
-- Ikinci calistirma hicbir satiri degistirmez (idempotent). Transaction icinde calisir (CONCURRENTLY yok).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.platform_settings') is null then
    raise exception '20261008001000: platform_settings yok; once temel migrationlar uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.plan_catalog_document()') is null
     or pg_catalog.to_regprocedure('public.plan_monthly_amount(text)') is null then
    raise exception '20261008001000: plan_catalog_document / plan_monthly_amount yok; once 20260825000300 uygulanmali.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. plan_monthly_amount: yedek tablo yeni liste fiyatlari (gövde 20260825000300 ile ayni, yalniz sabitler)
-- ---------------------------------------------------------------------------
create or replace function public.plan_monthly_amount(p_plan text)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan text := lower(btrim(coalesce(p_plan, '')));
  v_doc jsonb;
  v_val jsonb;
  v_num numeric;
begin
  if v_plan not in ('advisor', 'office', 'professional', 'business', 'enterprise') then
    return null;
  end if;

  v_doc := public.plan_catalog_document();

  if v_doc is null then
    -- Ayar yok: sahibin onayladigi katalog (plans.ts + RECOMMENDED_CATALOG_OVERRIDES, 2026-10-08).
    return case v_plan
      when 'advisor' then 749
      when 'office' then 2790
      when 'professional' then 5490
      when 'business' then 8990
      when 'enterprise' then 14900
    end;
  end if;

  v_val := v_doc -> 'plans' -> v_plan -> 'monthlyTry';
  if jsonb_typeof(v_val) = 'number' then
    v_num := (v_val #>> '{}')::numeric;
    if v_num = trunc(v_num) and v_num between 1 and 1000000 then
      return v_num;
    end if;
  end if;

  -- Ayar var ama bu plan icin gecerli fiyat yok: plans.ts tabani (PLANS + BUSINESS_PLAN_TEMPLATE).
  -- TS resolveCatalogSettings ayni davranir; burada farkli bir deger TS ile SQL'i ayristirir.
  return case v_plan
    when 'advisor' then 749
    when 'office' then 2790
    when 'professional' then 5490
    when 'business' then 8990
    when 'enterprise' then 14900
  end;
end;
$$;

revoke all privileges on function public.plan_monthly_amount(text) from public, anon, authenticated;
grant execute on function public.plan_monthly_amount(text) to service_role;

comment on function public.plan_monthly_amount(text) is
  'Aylik liste fiyati (KDV haric). TS resolveCatalogSettings ile ayni kural; ayar yoksa onayli katalog 749/2790/5490/8990/14900.';

-- ---------------------------------------------------------------------------
-- 2. EmlakFiyati kontor ayarlari: yalniz dokunulmamis seed kayitlari
-- ---------------------------------------------------------------------------
do $$
declare
  v text;
  j jsonb;
begin
  -- ef.tariff
  select s.value into v from public.platform_settings s where s.key = 'ef.tariff';
  if v is not null and nullif(btrim(v), '') is not null then
    begin
      j := v::jsonb;
    exception when others then
      j := null;
    end;
    if j = '{"valuationArsa":5,"valuationKonut":5,"pdfFirst":2,"reportDetail":0}'::jsonb then
      update public.platform_settings
         set value = '{"valuationArsa":850,"valuationKonut":700,"valuationTicari":1050}',
             updated_at = now()
       where key = 'ef.tariff';
    end if;
  end if;

  -- ef.packs
  select s.value into v from public.platform_settings s where s.key = 'ef.packs';
  if v is not null and nullif(btrim(v), '') is not null then
    begin
      j := v::jsonb;
    exception when others then
      j := null;
    end;
    if j = $json$[{"id":"ef-25","name":"25 Kontör","units":25,"priceNetTry":299,"active":true,"order":10},
{"id":"ef-100","name":"100 Kontör","units":100,"priceNetTry":990,"active":true,"popular":true,"order":20},
{"id":"ef-300","name":"300 Kontör","units":300,"priceNetTry":2490,"active":true,"order":30},
{"id":"ef-1000","name":"1000 Kontör","units":1000,"priceNetTry":6900,"active":true,"order":40}]$json$::jsonb then
      update public.platform_settings
         set value = $json$[{"id":"ef-1000-1a","name":"1 aylık · aylık 1.000 kontör","units":1000,"months":1,"priceNetTry":1000,"active":true,"order":10},
{"id":"ef-1000-3a","name":"3 aylık · aylık 1.000 kontör","units":3000,"months":3,"priceNetTry":2850,"active":true,"order":20},
{"id":"ef-1000-6a","name":"6 aylık · aylık 1.000 kontör","units":6000,"months":6,"priceNetTry":5400,"active":true,"order":30},
{"id":"ef-1000-12a","name":"12 aylık · aylık 1.000 kontör","units":12000,"months":12,"priceNetTry":10200,"active":true,"order":40},
{"id":"ef-2500-1a","name":"1 aylık · aylık 2.500 kontör","units":2500,"months":1,"priceNetTry":2500,"active":true,"order":50},
{"id":"ef-2500-3a","name":"3 aylık · aylık 2.500 kontör","units":7500,"months":3,"priceNetTry":7125,"active":true,"order":60},
{"id":"ef-2500-6a","name":"6 aylık · aylık 2.500 kontör","units":15000,"months":6,"priceNetTry":13500,"active":true,"popular":true,"order":70},
{"id":"ef-2500-12a","name":"12 aylık · aylık 2.500 kontör","units":30000,"months":12,"priceNetTry":25500,"active":true,"order":80},
{"id":"ef-5000-1a","name":"1 aylık · aylık 5.000 kontör","units":5000,"months":1,"priceNetTry":5000,"active":true,"order":90},
{"id":"ef-5000-3a","name":"3 aylık · aylık 5.000 kontör","units":15000,"months":3,"priceNetTry":14250,"active":true,"order":100},
{"id":"ef-5000-6a","name":"6 aylık · aylık 5.000 kontör","units":30000,"months":6,"priceNetTry":27000,"active":true,"order":110},
{"id":"ef-5000-12a","name":"12 aylık · aylık 5.000 kontör","units":60000,"months":12,"priceNetTry":51000,"active":true,"order":120}]$json$,
             updated_at = now()
       where key = 'ef.packs';
    end if;
  end if;

  -- ef.welcome_units
  update public.platform_settings
     set value = '100', updated_at = now()
   where key = 'ef.welcome_units' and btrim(value) = '10';
end
$$;

notify pgrst, 'reload schema';

-- DOGRULAMA (salt-okunur, uygulamadan SONRA):
-- select public.plan_monthly_amount(p) from unnest(array['advisor','office','professional','business','enterprise']) p;  -- ayar yoksa 749/2790/5490/8990/14900
-- select key, value from public.platform_settings where key in ('billing.plan_definitions','ef.tariff','ef.packs','ef.welcome_units');
