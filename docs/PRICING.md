# Fiyatlandırma

Tüm tutarlar KDV hariç, aylıktır. Onaylı katalog (sahip kararı, PANEL_KARAR_1 / HAFIZA §7):

| Paket | Aylık | Dahil kullanıcı | Ek kullanıcı (aylık) | Hedef |
|-------|-------|-----------------|----------------------|-------|
| Danışman | **749 ₺** | 1 | satılmaz | Bağımsız danışman |
| Ofis | **2.490 ₺** | 5 | kademeli, onaylı varsayılan **399 / 349 / 299 ₺** | Küçük–orta ofis |
| Profesyonel | **4.990 ₺** | 15 | kademeli, onaylı varsayılan **349 / 299 ₺** | Çok şube / ileri otomasyon |
| Business | **8.990 ₺** (varsayılan **gizli**) | 40 | pakete özel | Çok şubeli büyük ofis; yalnız admin açarsa görünür |
| Kurumsal | **özel teklif** | pazarlıkla | pazarlıkla | Franchise / proje; çevrimiçi ödeme yok, "Bize ulaşın" |

Ofis kademeleri: ek kullanıcı 1-5 arası 399, 6-15 arası 349, 16 ve sonrası 299 ₺ (toplam üst sınır 20 kullanıcı).
Profesyonel kademeleri: ek kullanıcı 1-10 arası 349, 11 ve sonrası 299 ₺ (toplam üst sınır 40 kullanıcı).
Kademe değerleri, sınırları ve yuvarlama düzeni admin tanımlıdır; yukarıdaki sayılar yalnız ONAYLI VARSAYILANDIR
(panel kaydı yoksa geçerlidir, kayıt varsa panel kaydı geçerlidir). Hesap marjinaldir: her ek kullanıcı kendi kademesinin
birim fiyatını öder (`src/lib/billing/seat-pricing.ts`).

## İlkeler

- **Yıllık = "10 öde 12 kullan"**: yıllık tutar = aylık x 10, yani 2 ay hediye (yaklaşık %16,7; arayüzde yuvarlanmış %17).
  Eski "%20 yıllık indirim" (`aylık x 12 x 0,8`) KALDIRILDI; ödenen ay sayısı paket başına admin tanımlıdır
  (`yearlyPaidMonths`, varsayılan 10).
- **Deneme süresi tek kaynak**: `getEffectiveTrialDays` (`src/lib/billing/plan-definitions.ts`); `20260816010100`
  migration'ı uygulandıktan sonra varsayılan 30 gün, admin panelden değişir. Belgelerde/metinlerde gün sayısı
  elle yazılmaz; kart gerekmez.
- **Ücretsiz paket YOK.** Her paketin aylık fiyatı sıfırdan büyüktür (testle korunur).
- **Founders kampanyası admin tanımlıdır**: ad, kota, açık/kapalı, indirimli fiyat (`campaignMonthlyTry`) ve fiyat kilidi
  panelden belirlenir; kodda sabit oran/fiyat yoktur. Kampanya kapalıyken liste fiyatı geçerlidir.
- **Business gizlidir**: varsayılan olarak fiyat/kayıt sayfalarında görünmez; satış için admin açar.
- **Kurumsal özeldir**: fiyat yerine "Özel teklif" gösterilir, çevrimiçi ödeme açılmaz.
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
