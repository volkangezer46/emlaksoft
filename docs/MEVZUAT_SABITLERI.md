# Mevzuat Sabitleri Envanteri

Bu belge hukuki danışmanlık DEĞİLDİR. Kodda gömülü mevzuat/vergi/harç sabitlerinin YERİNİ, kaynağını ve doğrulama
durumunu listeler. **Kod davranışı bu belgeyle değişmez**; yalnız envanterdir. Resmi kaynaktan doğrulama bu çalışmada
YAPILAMADI: "Doğrulama tarihi" sütunları bilerek boştur. Doğrulayan kişi (mali müşavir / ofis sahibi) tarihi ve kaynağı doldurur.

Durum kodları: `DOĞRULANAMADI` = resmi metne erişilip teyit edilmedi; `ÜRÜN KARARI` = mevzuat değil, ürün eşiği;
`KULLANICI GİRDİSİ` = kod varsayılanı yalnız başlangıç değeridir, kullanıcı/yönetici değiştirir.

## GÜNCEL DURUM (2026-10-06): TEK KAYNAK KODDA

Aşağıdaki tablolardaki "Yer" sütunu tarihseldir. Yasal sabitlerin TAMAMI artık `src/lib/legal-constants/index.ts` içindedir
(değer + kaynak + `status` + `verifiedAt`); `purchase-costs.ts`, `commission-cap.ts`, `commission.ts` ve satıcı net hesaplayıcı
(`src/lib/seller-proceeds.ts`, `/app/hesaplayici?sekme=satici`) değerlerini oradan okur. Doğrulama: ilgili satırın `status: "verified"` ve
`verifiedAt: "YYYY-MM-DD"` alanı birlikte girilir; ikisinden biri eksikse arayüz "Doğrulanmadı" rozeti basar (`LegalStatusBadge`).
Şu an hepsi `unverified`. Eklenenler: gelir vergisi dilimleri (tahmin), değer artış istisnası 150.000 TL, 5 yıl (60 ay), Yİ-ÜFE endeksleme
eşiği %10, DKV eşik/dilimler, ikamet izni 200.000 USD, vatandaşlık 400.000 USD / 3 yıl, yabancı kotası. Döner sermaye (6.000 TL)
çelişkisi tek yerde ve notla duruyor. GÖS metinleri: `src/lib/gos-info.ts`. Testler: `legal-constants.test.ts`, `seller-proceeds.test.ts`, `gos-info.test.ts`.

## Komisyon (hizmet bedeli)

| Sabit | Değer | Yer | Kaynak (iddia) | Durum | Doğrulama tarihi / kaynak |
|---|---|---|---|---|---|
| Satış hizmet bedeli tavanı | %4 (KDV hariç, taraflar toplamı) | `src/lib/commission-cap.ts` `DEFAULT_SALE_CAP_RATE`; `src/lib/purchase-costs.ts` `commissionPct` yorumu | Taşınmaz Ticareti Hakkında Yönetmelik (m.20 olarak anılıyor) | DOĞRULANAMADI | |
| Kira hizmet bedeli tavanı | 1 aylık kira (KDV hariç) | `commission-cap.ts` `DEFAULT_RENT_CAP_MONTHS`; `purchase-costs.ts` `rentCommissionMonths` | Aynı yönetmelik | DOĞRULANAMADI | |
| Tavan KDV'si | %20 | `commission-cap.ts` `DEFAULT_CAP_VAT_RATE` | KDV Kanunu genel oran | DOĞRULANAMADI (aşağıdaki KDV satırıyla aynı değer olmalı) | |
| Tavana yaklaşma eşiği | %90 | `commission-cap.ts` `NEAR_CAP_RATIO` | — | ÜRÜN KARARI | — |
| Varsayılan komisyon oranı | %3 | `src/lib/commission.ts` `DEFAULT_COMMISSION_RATE` | Piyasa uygulaması | KULLANICI GİRDİSİ | — |
| Danışman/ofis varsayılan paylaşımı | %50 / %50 | `commission.ts` `buildSplits`, `advisorShare` | — | KULLANICI GİRDİSİ | — |
| Alıcı/satıcı bölüşüm önerisi | %50 / %50 | `commission-cap.ts` `suggestCommissionSplit` | Yönetmelikte aksi kararlaştırılmadıkça yarı yarıya olduğu iddia ediliyor | DOĞRULANAMADI | |
| Alıcı tarafı komisyon varsayılanı | %2 | `purchase-costs.ts` `DEFAULT_RATES.commissionPct` | Yukarıdaki %4 tavanın yarısı | KULLANICI GİRDİSİ | — |

## KDV

| Sabit | Değer | Yer | Kaynak (iddia) | Durum | Doğrulama tarihi / kaynak |
|---|---|---|---|---|---|
| Genel KDV oranı | %20 | `commission.ts` `DEFAULT_VAT_RATE`; `commission-cap.ts` `DEFAULT_CAP_VAT_RATE`; `purchase-costs.ts` `vatPct` | KDV Kanunu / Cumhurbaşkanı kararı (07/2023'ten beri) | DOĞRULANAMADI. ÜÇ ayrı yerde aynı değer: değişirse üçü birlikte güncellenmeli | |
| Yeni bina KDV (<=150 m² konut) | %1 | `purchase-costs.ts` `newBuildVatResidentialSmallPct` | KDV Kanunu geçici hükümleri/tarife | DOĞRULANAMADI | |
| Yeni bina KDV (>150 m² konut / işyeri) | %20 | `purchase-costs.ts` `newBuildVatLargePct` | Aynı | DOĞRULANAMADI | |
| Stopaj (komisyonda) | 0 (girdi) | `commission.ts` `withholdingRate` | Danışmanın vergi statüsüne bağlı | KULLANICI GİRDİSİ | — |
| İşyeri kirası stopajı | %20 | `purchase-costs.ts` `rentWithholdingPct` | GVK m.94 | DOĞRULANAMADI | |

## Harç ve masraflar (alım)

| Sabit | Değer | Yer | Kaynak (iddia) | Durum | Doğrulama tarihi / kaynak |
|---|---|---|---|---|---|
| Tapu harcı toplam oranı | %4 (alıcı %2 + satıcı %2 varsayımı) | `purchase-costs.ts` `DEFAULT_RATES.deedFeeTotalPct` | 492 s. Harçlar Kanunu, (4) sayılı tarife I/20-a (kodda anılıyor) | DOĞRULANAMADI. Not: `TURKIYE_UYUM_NOTLARI.md` eskiden "varsayılan yok" diyordu; kodla çelişiyordu, düzeltildi | |
| Tapu döner sermaye (TKGM hizmet bedeli) | 6.000 TL | `purchase-costs.ts` `landRegistryServiceFeeTry` | TKGM yıllık tarifesi | DOĞRULANAMADI (her yıl değişir) | |
| DASK m² katsayısı / min / max / yedek | 25 / 900 / 6.000 / 2.500 TL | `purchase-costs.ts` `dask*` | DASK tarifesi (yaklaşık) | DOĞRULANAMADI; tahmin | |
| Konut sigortası m² / min / yedek | 20 / 800 / 2.000 TL | `purchase-costs.ts` `homeInsurance*` | Serbest tarife, piyasa tahmini | KULLANICI GİRDİSİ | — |
| Ekspertiz ücreti | 9.000 TL | `purchase-costs.ts` `appraisalFeeTry` | SPK lisanslı değerleme tarifeleri | DOĞRULANAMADI; tahmin | |
| Kredi tahsis ücreti tavanı | %0,5 (binde 5) | `purchase-costs.ts` `loanAllocationFeePct` | BDDK ücret usul ve esasları | DOĞRULANAMADI | |
| İpotek tesis döner sermaye | 3.500 TL | `purchase-costs.ts` `mortgageRegistrationFeeTry` | TKGM | DOĞRULANAMADI; tahmin | |
| Konut kredisi azami vade / LTV | 120 ay / %90 | `purchase-costs.ts` `MAX_LOAN_MONTHS`, `MAX_LOAN_TO_VALUE_PCT` | BDDK | DOĞRULANAMADI | |
| Konut kredisinde KKDF/BSMV | %0 / istisna | `purchase-costs.ts` `TAX_FREE_HOUSING_LOAN_NOTE` | 6802 s. Gider Vergileri Kanunu m.29/y | DOĞRULANAMADI | |
| Hesaplayıcı başlangıç faizi / vade / peşinat | %2,79 aylık / 120 / %25 | `purchase-costs.ts` `DEFAULT_MONTHLY_RATE_PCT` vb. | — | KULLANICI GİRDİSİ | — |

## Kira artışı (TÜFE)

| Sabit | Değer | Yer | Kaynak (iddia) | Durum | Doğrulama tarihi / kaynak |
|---|---|---|---|---|---|
| 12 aylık ortalama TÜFE tablosu | 2024-01..2025-12 gömülü | `src/lib/tufe.ts` `TUFE_12M_AVG` | TÜİK TÜFE bülteni; TBK m.344 | DOĞRULANAMADI (2025 değerleri tutarsız görünüyor; 2026-08+ yok). Hiçbir gömülü satır "resmi" sayılmaz (`official=false`) | |
| Resmi tablo (yönetici girer) | — | `platform_settings` anahtarı `tufe.table`; ekran `/admin/ayarlar/tufe` | TÜİK | Doğrulama tarihi ve kaynak ekrandan zorunlu girilir (tabloda saklanır) | Tabloda `verifiedAt` / `source` |

## Diğer eşikler

| Sabit | Değer | Yer | Durum |
|---|---|---|---|
| Düşük beyan uyarı eşiği | %90 | `DEFAULT_UNDERDECLARATION_THRESHOLD_PCT` (eski uyum notlarında anılıyor; bu çalışmada src içinde bulunamadı) | DOĞRULANAMADI; yalnız iç uyarı, yaptırım hesabı yok |

## Yetki belgesi ve ilan bilgileri

| Konu | Yer | Kaynak (iddia) | Durum |
|---|---|---|---|
| İlan/reklamda yetki belgesi no + işletme unvanı + iletişim | `src/components/public/license-notice.tsx`; alanlar `tenants.license_no`, `license_title`, `license_valid_until` (migration `20260826001800`) | Taşınmaz Ticareti Hakkında Yönetmelik m.14/2-i (kullanıcı raporundan; madde no resmi metinden doğrulanamadı) | Sorumluluk ofis/şirket sahibinde |
| Belge süresi uyarısı | `src/lib/license.ts` 60/30/7 gün | Ürün kararı (yeni cron yok; uygulama içi kart + ayar rozeti) | ÜRÜN KARARI |
| Yetki belgesi no biçimi | `license.ts` `normalizeLicenseNo` (esnek: harf/rakam/boşluk/.-/_) | Resmi biçim doğrulanamadı | DOĞRULANAMADI |

## Adlandırma

- TTBS = Taşınmaz Ticareti Bilgi Sistemi (Ticaret Bakanlığı).
- EİDS = Elektronik İlan Doğrulama Sistemi (ilan yetki doğrulaması). Ayrı bir sistemdir; uygulama ikisine de bağlı değildir.
- Her iki adlandırma kullanıcı raporundan alındı; resmi kaynaktan teyit edilmedi.

## Doğrulama süreci (öneri)

1. Her satır için resmi metin/tarife bağlantısı ve yayım tarihi "Doğrulama tarihi / kaynak" sütununa yazılır.
2. Değer değişirse YALNIZ ilgili dosyadaki sabit güncellenir; KDV oranı üç yerde birlikte (bkz. KDV tablosu).
3. TÜFE değerleri koda değil `/admin/ayarlar/tufe` ekranına girilir.
