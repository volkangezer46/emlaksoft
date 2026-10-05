# Fiyatlandırma

Tüm tutarlar KDV hariç, aylıktır. Onaylı katalog (sahip kararı, PANEL_KARAR_1 / HAFIZA §7):

| Paket | Aylık | Dahil kullanıcı | Ek kullanıcı (aylık) | Hedef |
|-------|-------|-----------------|----------------------|-------|
| Danışman | **749 ₺** | 1 | düz **499 ₺** (5 kullanıcıda 749 + 4×499 = 2.745 ₺ > Ofis 2.490 ₺: Ofis 5. kullanıcıdan itibaren ucuz) | Bağımsız danışman |
| Ofis | **2.490 ₺** | 5 | kademeli, onaylı varsayılan **399 / 349 / 299 ₺** | Küçük–orta ofis |
| Profesyonel | **4.990 ₺** | 15 | kademeli, onaylı varsayılan **349 / 299 ₺** | Çok şube / ileri otomasyon |
| Business | **8.990 ₺** (varsayılan **gizli**) | 40 | pakete özel | Çok şubeli büyük ofis; yalnız admin açarsa görünür |
| Kurumsal | **12.900 ₺** | **50** | kademeli **249 / 199 / 149 ₺** | Franchise / proje; "özel teklif" YOK, çevrimiçi satılır |

Ofis kademeleri: ek kullanıcı 1-5 arası 399, 6-15 arası 349, 16 ve sonrası 299 ₺.
Profesyonel kademeleri: ek kullanıcı 1-10 arası 349, 11 ve sonrası 299 ₺.
Kurumsal kademeleri: ek kullanıcı 1-50 arası 249, 51-200 arası 199, 201 ve sonrası 149 ₺.
Her paket için kullanıcı üst sınırı (`maxSeats`) **500**'dür (eski "20/40 kullanıcı üst sınırı" notları geçersiz).
Aylık EmlakFiyatı kontör hakkı (WP3, sahip kararı): Danışman 10 · Ofis 40 · Profesyonel 120 · Business 240 (gizli) · Kurumsal 400; ek kullanıcı başı (`efCreditsPerExtraSeat`): Danışman 5 · Ofis 6 · Profesyonel 6 · Kurumsal 6 (Business tanımsız). Tarife (arsa 5, konut 5, ilk PDF 2, detay 0) ve kontör paketleri (299/990/2490/6900 ₺) değişmedi. Plan kontörü paket birim fiyatıyla (11,96 → 6,90 ₺) değerlenince paket fiyatının %11–%22'si düzeyindedir. Canlı kayıt için migration `20260826001100_ef_plan_credit_values.sql` (yalnız dokunulmamış değerleri çeker).
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
- **Kurumsal artık sabit fiyatlıdır** (12.900 ₺, 50 kullanıcı dahil, kademeli ek kullanıcı); "özel teklif" ve `customPricing` alanı kaldırıldı.
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
