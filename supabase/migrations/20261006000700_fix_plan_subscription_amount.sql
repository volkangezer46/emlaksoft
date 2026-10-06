-- MIGRATION 20261006000700_fix_plan_subscription_amount.sql (PB45)
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261006000700_fix_plan_subscription_amount.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261006000700_fix_plan_subscription_amount.rollback.sql
--
-- BAGLAM (2026-10-06 denetimi; HAFIZA §3 "Fiyat karari" maddesi BAYATTI):
--   update_tenant_plan_subscription'in "plan degisince tutari 990/2490/5990/12900'e yazar, kayitli/kilitli fiyati ezer,
--   price_lock_* yazmaz" hatasi 20260825000300_billing_plan_amount_integrity.sql ile ZATEN duzeltildi (CANLIDA):
--   plan degismiyorsa kayitli amount_try + price_lock_* KORUNUR; plan degisirse tutar plan_monthly_amount()'tan,
--   Founders kilidi (price_lock_campaign) yeni planin kampanya fiyatina yeniden yazilir. Fonksiyonun son tanimi odur;
--   bu dosya onu YENIDEN YAZMAZ (ayni govdeyi tekrar yazmak yalniz sapma riski dogurur).
--
-- KALAN TEK ESKI-SABIT YOLU (bu dosyanin isi):
--   20260731000138'den kalan 9 argumanli public.fulfill_billing_payment(text,text,text,text,text,uuid,text,text,numeric)
--   overload'u hala 990/5990 sabitleri + "yillik = aylik x 12 x 0.8" kuralini tasir ve 'business' planini tanimaz.
--   Kod onu cagirmaz (fulfill_billing_payment_v2 10 argumanla cagirir; TS yalniz _v2'yi cagirir) ama service_role
--   EXECUTE yetkisiyle canlida durur; 9 ya da daha az adlandirilmis argumanla yapilan bir cagri iki overload arasinda
--   belirsizdir. Overload DUSURULUR: 9 argumanli bir cagri bundan sonra 10 argumanli dogru tanima (son parametre
--   p_expected_currency default null) cozulur. Sozlesme testi: src/lib/billing/plan-sql-constants-contract.test.ts.
--
-- ON KOSUL (eksikse HICBIR sey yazmadan durur):
--   * 10 argumanli fulfill_billing_payment mevcut (20260809000000 / 20260826000300).
--   * update_tenant_plan_subscription canli govdesi plan_monthly_amount() kullaniyor ve eski 990/5990/12900 sabitini
--     tasimiyor (= 20260825000300 uygulanmis). Degilse once 000300 uygulanmali.
-- Tablo/veri degisikligi YOK; mevcut abonelik tutarlari DEGISMEZ. Transaction icinde calisir (CONCURRENTLY yok).

set local lock_timeout = '5s';

do $$
declare
  v_body text;
begin
  if to_regprocedure('public.fulfill_billing_payment(text, text, text, text, text, uuid, text, text, numeric, text)') is null then
    raise exception '20261006000700: 10 argumanli fulfill_billing_payment yok; once 20260809000000 / 20260826000300 uygulanmali.';
  end if;
  select p.prosrc into v_body
  from pg_catalog.pg_proc p
  where p.oid = to_regprocedure('public.update_tenant_plan_subscription(uuid, uuid, text, text)');
  if v_body is null then
    raise exception '20261006000700: update_tenant_plan_subscription yok.';
  end if;
  if position('public.plan_monthly_amount(' in v_body) = 0
     or position('when ''advisor'' then 990' in v_body) > 0
     or position('when ''enterprise'' then 12900' in v_body) > 0 then
    raise exception '20261006000700: update_tenant_plan_subscription eski sabitli govdede; once 20260825000300_billing_plan_amount_integrity uygulanmali.';
  end if;
end
$$;

drop function if exists public.fulfill_billing_payment(text, text, text, text, text, uuid, text, text, numeric);

notify pgrst, 'reload schema';

-- DOGRULAMA (salt-okunur, uygulamadan SONRA):
-- select pg_get_function_identity_arguments(p.oid) as args
-- from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'fulfill_billing_payment';
-- BEKLENEN: tek satir, 10 argumanli imza (... numeric, p_expected_currency text).
