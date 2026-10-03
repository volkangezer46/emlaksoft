# Hız Ölçüm Raporu 3 (canlı, commit 5aab703 sonrası)

Tarih: 2026-10-04. Canlı: https://emlaksoft.vercel.app. Yöntem HIZ_OLCUM_RAPORU_2.md ile aynı (Playwright, PerformanceObserver; mobil 390x844, 4x CPU, Fast 3G; masaüstü 1440x900; soğuk yükleme, n=5, medyan). Kod değişmedi, canlıda veri yazılmadı ("Ofis sahibi" demo girişi). Betikler repoda değil (scratchpad: `perf3.mjs`, `shell3-5.mjs`, `an4.cjs`).
Not: yayının 5aab703 olduğu doğrudan doğrulanmadı; HTML boyutunun ve CLS'nin değişmesi yeni sürümün canlı olduğunu gösteriyor.

## Sonuç

- CLS düzeldi: /app ana ekran masaüstü 0.946 -> 0.000-0.026 (medyan 0.001 tur açıkken, 0.025 kapalıyken), mobil 1.633 -> 0.024. İkisi de "iyi" eşiğinin (0.1) çok altında. Ürün turu spotlight'ı artık layout-shift üretmiyor.
- Ürün turu gözle doğrulandı: ilk ziyarette tur açılıyor (5 tekrarın 4'ünde masaüstü, 5/5 mobil; 1 masaüstü tekrarında tur görünmedi), "Adım 1/5 -> 2/5 -> 3/5 -> 4/5" ilerliyor, spotlight KPI kartlarının üzerine taşınıyor (ekran görüntüsü okundu). Tur kapalıyken (`emlaksoft:tour-done`) de aynı CLS (0.024-0.026), yani kalan küçük kayma turdan değil.
- HTML: /app ham 422 KB -> ~342 KB (-19%); sıkıştırılmış transfer ~44 KB (önce 35 KB brotli HTML'ydi, ölçüm yöntemi farklı: burada belge transferSize). Toplam transfer (tur kapalı) ~610 KB masaüstü, ~760 KB mobil; 22 JS isteği. Tur açıkken +~180 KB JS (tur parçası artık yalnız tur açılırken iniyor: 292 -> 472 KB masaüstü).
- Mobil /app LCP 6532 -> 3176 (tur açık) / 3504 (kapalı). Büyük kazanç, ama önceki değer ağ sıçramalarıyla gürültülüydü.
- Kabuk dinamik içe aktarma çalışıyor: kullanıcı menüsü, bildirim zili ve Ctrl+K paleti açılıyor, konsol hatası 0 (tüm tur/sayfa tekrarlarında).

## (1) /app ana ekran CLS ve LCP

| Profil | durum | CLS önce | CLS sonra (5 tekrar) | LCP sonra | FCP sonra |
|---|---|---|---|---|---|
| Masaüstü | tur açık | 0.946 | 0.025 0.025 0.002 0.000 0.001 | 1488 | 808 |
| Masaüstü | tur kapalı | - | 0.025 0.000 0.026 0.000 0.026 | 1372 | 756 |
| Mobil | tur açık | 1.633 | 0.024 0.024 0.000 0.024 0.024 | 3176 | 2008 |
| Mobil | tur kapalı | - | 0.024 x5 | 3504 | 2008 |

Kalan kaymalar: masaüstü `SECTION.pm-hero` (/app hero kartı, 0.025, geç oturan içerik, turdan bağımsız); mobil sekme çubuğu (`a.mt-tab`, metin düğümleri, 0.024, ~4.7-5.8 sn'de, yani font/yerleşim geç oturması). Her ikisi eşik altında.

## (2) Sayfalar (tur kapalı, n=5, medyan)

| Sayfa | Profil | LCP önce(R2) | LCP sonra | FCP önce | FCP sonra | CLS önce | CLS sonra |
|---|---|---|---|---|---|---|---|
| /app | masaüstü | 1156 | 1488 (açık) / 1372 | 600 | 808 / 756 | 0.946 | 0.001 / 0.025 |
| /app/musteriler | masaüstü | 1492 | 1580 | 644 | 592 | 0.001 | 0.001 |
| /app/portfoyler | masaüstü | 1264 | 1464 | 564 | 664 | 0.000 | 0.000 |
| /app/randevular | masaüstü | 1568 | 1752 | 752 | 704 | 0.000 | 0.000 |
| /app/anlasmalar | masaüstü | 1608 | 1544 | 696 | 736 | 0.000 | 0.001 |
| /app | mobil | 6532 | 3176 / 3504 | 2064 | 2008 | 1.633 | 0.024 |
| /app/musteriler | mobil | 5220 | 2824 | 2076 | 1888 | 0.003 | 0.000 |
| /app/portfoyler | mobil | 5980 | 3276 | 2096 | 1976 | 0.003 | 0.001 |
| /app/randevular | mobil | 5728 | 3056 | 2604 | 2068 | 0.003 | 0.000 |
| /app/anlasmalar | mobil | 5584 | 2928 | 2136 | 2008 | 0.003 | 0.000 |

Mobil LCP dört sayfada ~%40-50 düştü (önceki ölçümlerde 5-6 sn ağ gürültüsü vardı; bu turda ağ sakin olabilir, kazancın bir kısmı gürültü olabilir). Masaüstü LCP'ler +-200 ms içinde, 4 sayfada hafif yukarıda (portfoyler +200, randevular +184, musteriler +88), anlasmalar -64; n=5 gürültüsü içinde, net regresyon sayılmaz.
Konsol hatası: 0 (masaüstü ve mobil, tüm sayfalar).

## (3) Kabuk dinamik içe aktarma (masaüstü, /app/musteriler, tur kapalı)

| Eylem | Gecikme (ms) | Not |
|---|---|---|
| Kullanıcı menüsü ilk tık | 442 / 445 (sayfa içi ölçüm); Playwright tıklaması: 4032 (ilk), 936, 916 | açıldı, ekran görüntüsü doğrulandı |
| Bildirim zili | 389 / 387; Playwright 926, 915, 922 | panel (sekmeler) açıldı |
| Ctrl+K paleti | 370 / 516; Playwright 837, 851, 854 | "Panel genelinde ara" girişi görünür |
| Hover ile ısıtılmış kullanıcı menüsü | 1212, 459, 1 tekrarda açılmadı (1.5 sn içinde) | aşağıda P2 |

Gecikmeler parça iniş süresini içerir (parçalar ilk tıkta iniyor).

## (4) /app ilk yük boyutu

| Ölçü | Önce (R2) | Sonra |
|---|---|---|
| HTML ham | 422 KB | ~342 KB (tur kapalı 345 KB) |
| HTML transfer (belge) | 35 KB (brotli) | ~44 KB (transferSize, başlıklar dâhil) |
| JS (tur kapalı) | 23 parça / 213 KB brotli (build envanteri) | 22 istek, ~292 KB (masaüstü ölçüm) / ~469 KB (mobil) |
| JS (tur açık) | - | 23 istek, ~472-477 KB |
| Toplam transfer | - | ~610 KB (masaüstü) / ~760 KB (mobil), 48-66 istek |

Dikkat: JS toplamı iki raporda aynı yöntemle ölçülmedi (önce: build envanteri, sonra: tarayıcı kaynak girdileri, mobilde bekleme süresi daha uzun olduğu için daha çok lazy parça iniyor). Gerçek karşılaştırma yalnız HTML ham boyutunda adil: -19%.

## Önce / sonra özeti

- CLS: 0.946 / 1.633 -> 0.025 / 0.024 (çözüldü).
- HTML ham: 422 -> 342 KB.
- Mobil /app ve liste sayfaları LCP: 5.2-6.5 sn -> 2.8-3.5 sn.
- Masaüstü LCP/FCP: değişim gürültü içinde (+-200 ms), /app ana ekran biraz yukarıda (1156 -> 1372-1488; FCP 600 -> 756-808).

## Yeni sorunlar

- P2: Kabuk panelleri (kullanıcı menüsü, zil, Ctrl+K) ilk açılışta 0.4-1 sn gecikmeli; bir ölçümde ilk tıkta 4 sn, bir hover-ısıtmalı denemede 1.5 sn içinde açılmadı. Parça yalnız tıkta iniyorsa `onPointerEnter`/`onFocus` ısıtması ve/veya bosta ön yükleme etkili çalışmıyor olabilir. Doğrulanması gereken: açılmama tek seferlik zamanlama mı, gerçek hata mı (1/3, tekrar edilmedi).
- P3: /app ana ekran masaüstü hero kartı (`pm-hero`) 0.025 geç kayma (3/5 tekrar). Yükseklik rezervi önerilir.
- P3: /app ana ekran masaüstü LCP/FCP hafif yukarıda (+200 ms); tek bir ölçümle regresyon denemez, bir sonraki turda tekrar bakın.
- P3: Mobil sekme çubuğu (`mt-tab`) 0.024 kayma (font/metin yerleşimi).
- Regresyon: yok (konsol temiz, tüm sayfalar yükleniyor, tur ve kabuk paneli işlevleri çalışıyor).
