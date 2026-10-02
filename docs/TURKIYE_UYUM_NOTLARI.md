# Türkiye Uyum Notları (A4, A6)

Bu doküman hukuki danışmanlık DEĞİLDİR. Aşağıdaki modüller yalnız aritmetik yapar;
mevzuat sabitleri gömülü değildir, parametre olarak alınır. Yayına almadan önce
hukukçu / mali müşavir / resmî kaynakla doğrulanmalıdır.

## Modüller

| Dosya | Amaç |
|---|---|
| `src/lib/commission-cap.ts` | Komisyon üst sınırı kontrolü, aşan kısım, alıcı/satıcı bölüşüm önerisi |
| `src/components/app/commission-cap-notice.tsx` | Tavan aşılınca `Alert tone="warning"`; aşılmazsa görünmez |
| `src/lib/rent-increase.ts` | Verilen TÜFE ortalamasıyla en yüksek yeni kira, bir sonraki artış tarihi |
| `src/lib/tapu-cost.ts` | Parametrik tapu harcı (alıcı + satıcı), düşük beyan uyarısı |

## Parametre / doğrulama tablosu

| Sabit | Konum | Durum |
|---|---|---|
| Satış hizmet bedeli tavanı %4 (+KDV) | `DEFAULT_SALE_CAP_RATE` | DOĞRULANMALI (Gayrimenkul Ticareti Hakkında Yönetmelik / Ticaret Bakanlığı). Parametre: `saleCapRate` |
| Kira hizmet bedeli tavanı 1 aylık kira (+KDV) | `DEFAULT_RENT_CAP_MONTHS` | DOĞRULANMALI. Parametre: `rentCapMonths` |
| KDV oranı %20 | `DEFAULT_CAP_VAT_RATE` (`commission.ts` ile aynı) | DOĞRULANMALI; her çağrıda `vatRate` ile geçilebilir |
| Alıcı/satıcı %50-%50 bölüşüm | `suggestCommissionSplit` | Yalnız öneri; taraflar anlaşır. `buyerSharePct` |
| Tavanı yaklaşma eşiği %90 | `NEAR_CAP_RATIO` | Ürün kararı, mevzuat değil |
| 12 aylık TÜFE ortalaması | `cpiAverage12m` | GÖMÜLÜ DEĞİL. TÜİK'ten alınıp DB/ayar olarak tutulmalı; ay ay güncellenmeli. Konut/işyeri ayrımı ve artış üst sınırı rejimi hukukçuyla doğrulanmalı |
| Tapu harcı oranları | `buyerRatePct`, `sellerRatePct` | VARSAYILAN YOK; zorunlu parametre. Resmî kaynaktan (Harçlar Kanunu / GİB-TKGM) alınmalı |
| Düşük beyan eşiği %90 | `DEFAULT_UNDERDECLARATION_THRESHOLD_PCT` | DOĞRULANMALI; yalnız iç uyarı, yaptırım hesabı yapılmaz |

## Davranış notları

- Tavan KDV HARİÇ toplam bedel (taraflar toplamı) üzerinden değerlendirilir; bu yorum doğrulanmalıdır.
- Tüm tutarlar kuruşa yuvarlanır; NaN/negatif/sıfır girdide `valid: false` ve Türkçe `reason` döner.
- `rent-increase.ts` saftır; "bugün" `src/lib/clock.ts` ile çağıran tarafından verilir (`YYYY-MM-DD`).
- Artış tarihi, başlangıçtan itibaren 12 aylık yıldönümlerinin bugüne eşit/sonraki ilkidir (29 Şubat ay sonuna çekilir).

## Entegrasyon önerisi

1. **Komisyon formu / portföy:** komisyon oranı veya tutarı değiştikçe
   `<CommissionCapNotice kind amount commissionRate|commissionAmount vatIncluded />`
   gösterilsin. Aşıyorsa kaydı engelleme, yalnız uyar (karar kullanıcıda). İsteğe bağlı
   "tavana indir" düğmesi `computeCapNet` ile; "alıcı/satıcı böl" önerisi `suggestCommissionSplit`.
2. **Anlaşma kapanışı:** kapanış diyaloğunda aynı bileşen + `checkCommissionCap` sonucu
   audit log'a (`exceeds`, `excessNet`) yazılsın. Tapu masrafı kartı: `computeTapuCost`
   (oranlar ayarlardan; rayiç için değerleme/emsal motoru çıktısı).
3. **Kira artışı sayfası (`/app/kira-artis`):** TÜFE ortalaması ofis ayarı/tablo olarak
   girilsin; `computeRentIncrease` ile tavan, `nextIncreaseDate` / `daysUntilIncrease` ile
   hatırlatma. Mevcut `rent-calculator.tsx` bu fonksiyonlara geçirilebilir.
4. Ayar ekranında "oranları doğrula" notu ve son doğrulama tarihi tutulması önerilir.
