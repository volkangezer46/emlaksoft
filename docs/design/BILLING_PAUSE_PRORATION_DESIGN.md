# Abonelik duraklatma, oransal yukseltme, Business ve ek kullanici (TASLAK)

Durum: tasarim notu. Migration taslagi `supabase/proposed/20260820000100_billing_pause_proration_business_seats.sql`
(uygulanmadi, forward-only kurala uygun olarak tasinirken yeni zaman damgasi alir).

## Mevcut durumun tespitleri
- `update_tenant_plan_subscription` (20260802000300) plan degisince `amount_try`'yi SABIT liste fiyatina yazar
  (990/2490/5990/12900); panelden degisen fiyatlari bilmez ve kayitli tutari ezer.
- `fulfill_billing_payment` (20260809000000) ve `provision_registration` (20260731000140) plan listesi
  `('advisor','office','professional','enterprise')`; `business` bu yuzden satilamaz. CHECK kisitlari ve
  `plan_entitlements('business')` 20260817000210 ile zaten var.
- `fulfill_billing_payment` yedek yillik tutari `aylik*12*0.8`; uygulama artik 10 ay (`aylik*10`). Yalniz fatura tutari
  bos kaldiginda kullanilir, ama tutarsizdir.
- Kupon ve kampanya (Founders) fiyati ODEMEYE yansimiyor: `startPlanCheckout` liste fiyatindan fatura keser,
  `price_lock_try` hicbir yerde yazilmiyor. Bu yuzden abonelik ekrani `quotePlan` kampanya fiyatini gostermez
  (gosterip tahsil etmemek sahte vaat olurdu). Kampanya fiyati icin fulfillment `price_lock_*` yazmali.

## Duraklatma
- Yalniz `active` ve donemi suren abonelik; en fazla 60 gun; ayni donemde bir kez.
- `pause_subscription`: `status='paused'`, `paused_at`, `pause_resume_at`, `pause_remaining = period_end - now()`.
  Ofis askiya alinmaz (veri erisimi surer); yalniz faturalama durur.
- `resume_subscription`: `period_end = now() + pause_remaining`, alanlar temizlenir. Otomatik devam icin yeni cron
  (CRON_SECRET + recordHeartbeat, vercel.json, `check:cron`).
- Degisecek kod: `actions/billing.ts` (iki yeni action, `requirePermission('billing','edit')`), abonelik ekraninda sayfa ici
  panel, `getPlanSupport()` icin `pause` probe'u (sema yoksa gizli), reconciliation'in `paused` durumunu yenileme disi birakmasi.
- Not: `subscriptions.status='paused'` bugun platform askisinda da kullaniliyor (`update_tenant_plan_subscription`);
  `paused_at` bos paused satirlari "platform askisi" sayilir ve kullanici tarafindan devam ettirilemez.

## Oransal yukseltme
Formul (KDV haric): `oran = kalan_sure / donem_suresi`; `kredi = amount_try * oran`; `yeni = yeni_donem_tutari * oran`;
`odenecek = max(0, yeni - kredi)`. `amount_try` kayitli fatura tutaridir ve DEGISMEZ; yukseltme icin ayri fatura
(`meta.kind = 'upgrade_proration'`) kesilir. Yeni donem tutari katalogdan (platform_settings JSON) uygulamada
hesaplanir (`planAmountOf`), DB `quote_upgrade_proration` yalniz zaman oranini ve ozet hesabi dogrular.
Asagi gecis (downgrade) bir sonraki yenilemede uygulanir; kredi/iade yok.
- Degisecek: `fulfill_billing_payment` fatura meta'sindaki `kind`i taniyip plani HEMEN degistirmeli, `period_end`'i
  DEGISTIRMEMELI (mevcut yenileme `fulfill_billing_payment_v2` donemi uzatiyor; upgrade_proration icin atlanmali).
  `assertBillingPlanPreflight` (kapasite) yukseltmede de calisir. Kupon yalniz yenileme/ilk satis tutarina uygulanir.
- Bu hesap yuklenmeden ekranda "oransal" vaadi verilmez.

## Business plani
Taslak D bolumu, canli fonksiyon govdesini `pg_get_functiondef` ile okuyup plan listesini/fiyat CASE'ini degistirir
(K1'in 20260816010100 deseni; boylece K1'in `make_interval(days => platform_default_trial_days())` govdesi kaybolmaz).
Desen bulunamazsa migration durur. Kod tarafi: `billing.ts` `PLAN_IDS` bugun `PLANS` ile sinirli (business yok);
migration uygulanip `getPlanSupport().businessPlan` true olunca `getPlanDefinition(plan)` ile gizli olmayan her plan
kabul edilmeli (business `hidden` iken satilmaz, panelden acilinca satilir). `update_tenant_plan_subscription` icin
`platform.ts` `PLANS` listesi de genisletilmeli (admin plan atamasi).

## Ek kullanici
`subscriptions.extra_seats` + `effective_seat_limit(tenant)` = plan koltuk limiti + extra_seats. Fiyat
`PlanDef.extraSeatMonthlyTry` (yoksa satilmaz). Satis: ayri fatura (`meta.kind='extra_seats'`, adet), ayni oransal formul
ile donem sonuna kadar; sonraki yenilemede `aylik + adet*ek_koltuk_fiyati` tahsil edilir. Degisecek: `team.ts` koltuk
kontrolu (`limits.seats + extra_seats`), `plan_entitlements` koltuk tetikleyicileri (`effective_seat_limit`), abonelik ekrani
kullanim gostergesi limiti. Tetikleyici govdeleri okunmadan taslakta degistirilmedi (TODO).

## Uygulama sirasi onerisi
1. Backup/PITR dogrula, `check:migrations -- --database`, dry-run. 2. Migration (once A, B, C; sonra D; E tetikleyici
   adimi ayri). 3. `getPlanSupport` probe'lari. 4. Action + ekran (sema yoksa gizli). 5. Cron + sozlesme testleri.
