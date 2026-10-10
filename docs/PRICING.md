# Fiyatlandırma

Tüm tutarlar KDV hariç, aylıktır. Onaylı katalog (sahip kararı, PANEL_KARAR_1 / HAFIZA §7):

| Paket | Aylık | Dahil kullanıcı | Ek kullanıcı (aylık) | Hedef |
|-------|-------|-----------------|----------------------|-------|
| Danışman | **749 ₺** | 1 | düz **559 ₺** (5 kullanıcıda 749 + 4×559 = 2.985 ₺ > Ofis 2.790 ₺: Ofis 5. kullanıcıdan itibaren ucuz) | Bağımsız danışman |
| Ofis | **2.790 ₺** | 5 | kademeli, onaylı varsayılan **499 / 449 / 399 ₺** | Küçük–orta ofis |
| Profesyonel | **5.490 ₺** | 15 | kademeli, onaylı varsayılan **449 / 399 ₺** | Çok şube / ileri otomasyon |
| Business | **8.990 ₺** (varsayılan **gizli**) | 40 | pakete özel | Çok şubeli büyük ofis; yalnız admin açarsa görünür |
| Kurumsal | **14.900 ₺** | **50** | kademeli **289 / 249 / 199 ₺** | Franchise / proje; "özel teklif" YOK, çevrimiçi satılır |

Ofis kademeleri: ek kullanıcı 1-5 arası 399, 6-15 arası 349, 16 ve sonrası 299 ₺.
Profesyonel kademeleri: ek kullanıcı 1-10 arası 349, 11 ve sonrası 299 ₺.
Kurumsal kademeleri: ek kullanıcı 1-50 arası 249, 51-200 arası 199, 201 ve sonrası 149 ₺.
Her paket için kullanıcı üst sınırı (`maxSeats`) **500**'dür (eski "20/40 kullanıcı üst sınırı" notları geçersiz).
Aylık EmlakFiyatı kontör hakkı (2026-10-08 fiyat kararı, 1 kontör = 1 TL): Danışman 100 · Ofis 700 · Profesyonel 2.100 · Business 3.500 (gizli) · Kurumsal 7.000; ek kullanıcı başı 50. Tarife (kontör YALNIZ değerleme için, 2026-10-10): konut 700 · arsa 850 · ticari 1.050; ilan analizi, PDF ve rapor detayı kontörsüz. Kontör SÜRELİDİR (devretmez): aylık plan hakkı ay sonunda, hoş geldin (100 kontör) 30 gün sonra yanar. Süreli paketler (KDV hariç, aylık 1.000/2.500/5.000 kontör × 1/3/6/12 ay; 3 ay %5, 6 ay %10, 12 ay %15 indirim): örn. 1.000/ay → 1 ay 1.000 · 3 ay 2.850 · 6 ay 5.400 · 12 ay 10.200 ₺; 2.500/ay → 2.500 · 7.125 · 13.500 · 25.500 ₺; 5.000/ay → 5.000 · 14.250 · 27.000 · 51.000 ₺. Canlı kayıt için migration `20261008001000_plan_prices_ef_credit_tariff.sql` (yalnız dokunulmamış seed ayarlarını çeker; `billing.plan_definitions` ve abonelik tutarları değişmez).
Kaynak: `PLANS` (`plans.ts`) ile `RECOMMENDED_CATALOG_OVERRIDES` (`plan-overrides.ts`) AYNI değerleri taşır; kaymayı `plan-default-catalog.test.ts` yakalar.
Kademe değerleri, sınırları ve yuvarlama düzeni admin tanımlıdır; yukarıdaki sayılar yalnız ONAYLI VARSAYILANDIR
(panel kaydı yoksa geçerlidir, kayıt varsa panel kaydı geçerlidir). Hesap marjinaldir: her ek kullanıcı kendi kademesinin
birim fiyatını öder (`src/lib/billing/seat-pricing.ts`).

## İlkeler

- **Yıllık = "10 öde 12 kullan"**: yıllık tutar = aylık x 10, yani 2 ay hediye (yaklaşık %16,7; arayüzde yuvarlanmış %17).
  Eski "%20 yıllık indirim" (`aylık x 12 x 0,8`) KALDIRILDI; ödenen ay sayısı paket başına admin tanımlıdır
  (`yearlyPaidMonths`, varsayılan 10).
- **Deneme süresi tek kaynak**: `getEffectiveTrialDays` (`src/lib/billing/plan-definitions.ts`); `platform_settings.default_trial_days`
  (1-90), ayar yoksa **14 gün** (`20260816010100` SQL varsayılanı da 14). Admin panelden değişir. Kopyada gün sayısı
  elle yazılacaksa 14 yazılır ve tek kaynakla birlikte güncellenir; kart gerekmez.
- **TL hesap kredisi** (referans ödülü, hoş geldin 300 ₺, yönetici yüklemesi) faturada en çok `try_credit.max_invoice_share` (varsayılan %50) kadar kullanılır; nakde çevrilmez.
- **Ücretsiz paket YOK.** Her paketin aylık fiyatı sıfırdan büyüktür (testle korunur).
- **Founders kampanyası admin tanımlıdır**: ad, kota, açık/kapalı, indirimli fiyat (`campaignMonthlyTry`) ve fiyat kilidi
  panelden belirlenir; kodda sabit oran/fiyat yoktur. Kampanya kapalıyken liste fiyatı geçerlidir.
- **Business gizlidir**: varsayılan olarak fiyat/kayıt sayfalarında görünmez; satış için admin açar.
- **Kurumsal artık sabit fiyatlıdır** (14.900 ₺, 50 kullanıcı dahil, kademeli ek kullanıcı); "özel teklif" ve `customPricing` alanı kaldırıldı.
- **Fiyat değişiklikleri yalnız YENİ satışlara uygulanır.** Mevcut abonelik kayıtlı (`subscriptions.amount_try`, fiyat
  kilidi) tutarını korur; katalog değişince eski abonelerin faturası değişmez.
- Mekanizması olmayan vaat yazılmaz (ör. öncelikli destek, özel onboarding, sözleşmeli SLA): paket özellik listelerinde
  yalnız bugün çalışan özellikler yer alır.

## Fiyat kaynağı haritası

| Katman | Dosya | Rol |
|--------|-------|-----|
| **Tek merkez (düzenleme)** | admin `/admin/billing/planlar` | Fiyat, kademe, limit, kampanya, deneme, gizleme; `platform_settings` `billing.plan_definitions` |
| Onaylı katalog | `RECOMMENDED_CATALOG_OVERRIDES` (`plan-overrides.ts`) | Panel kaydı yokken geçerli katalog |
| Kod varsayılanı | `PLANS`, `BUSINESS_PLAN_TEMPLATE` (`plans.ts`) | Ham varsayılan; onaylı katalogla aynı değerler (`plan-default-catalog.test.ts` kaymayı yakalar) |
| Okuyucu | `plan-definitions.ts`, `public-pricing.ts` | Fiyat sayfası, kayıt, ödeme etkin kataloğu buradan okur |
| Koltuk hesabı | `seat-pricing.ts` | Kademeli ek kullanıcı tutarı |
| Veritabanı | `update_tenant_plan_subscription`, `fulfill_billing_payment`, `provision_registration`, `convert_demo_request_to_tenant`, `plan_entitlements` | Sabit tutar yazan SQL; TS ile uyumu `plan-sql-constants-contract.test.ts` denetler, P2 migration'ı ile düzeltilir |

Ödeme sağlayıcısı: iyzico.
