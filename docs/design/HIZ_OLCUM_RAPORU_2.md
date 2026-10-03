# Hız Ölçüm Raporu 2 (canlı, düzeltme sonrası)

Tarih: 2026-10-03. Canlı: https://emlaksoft.vercel.app, commit 5a4e0f9 (font preload kapatma + kök `loading.tsx` kaldırma + /app `AppShell` Suspense).
Yayının canlı olduğu doğrulandı: ana sayfa HTML'inde `as="font"` preload ve `id="B:0"` yedek şablonu yok.
Yöntem ilk rapordaki ile aynı (`perf.mjs`, Playwright, PerformanceObserver). Veri yazılmadı (salt-okunur, "Ofis sahibi" demo girişi). Kod değişmedi.

## Özet

- Public sayfalar belirgin hızlandı. Masaüstü LCP: / 2768 -> 1140, /fiyatlar 1216 -> 568, /giris 1328 -> 600, vitrin 4736 -> 856 ms (önceki 3.5 sn TTFB sıçraması da yoktu). Mobil LCP: / 4532 -> 3344, /fiyatlar 6596 -> 2824, /giris 3352 -> 2900; mobil FCP: /fiyatlar 4848 -> 2212, /giris 3352 -> 2048.
- /app masaüstü: sayfa medyanlarının medyanı LCP 1836 -> 1404 ms, FCP 1080 -> 644 ms. Menü geçişi ilk 269 -> 129 ms, sıcak 265 -> 112 ms.
- /app mobil: FCP 2696 -> 2076 ms ama LCP yalnız 4392 -> 4036 ms (medyanlar) ve gürültülü. FCP kazancının büyük kısmı "yüklenme ekranı" (RouteSplash, "E" logosu) boyandığı için; asıl içerik (LCP) hâlâ HTML akışının sonunu bekliyor (aşağıda kök neden).
- Yeni bulgu (regresyon sinyali): /app ana ekranda CLS 0.000 -> 0.946 (masaüstü) ve 1.633 (mobil). Kaynak: ürün turu (`product-tour.tsx`) spotlight kutusu `transition-[top,left,width,height]` ile animasyonlu; ilk ziyarette (boş tarayıcı, localStorage yok) tur açılıyor ve her animasyon karesi layout-shift girdisi üretiyor. Diğer /app sayfalarında CLS ~0. Düzeltme önerisi aşağıda (öneri 1).
- Davranış değişikliği (hata değil, ama bilin): `/app/brifing` -> `/app`, `/app/eslestirme` -> `/app/talepler` yönlendiriyor (ölçüm bu yüzden o iki sayfada hedef sayfanın değerini verir; tabloda "YONLENDIRME" notu var).
- Yeni "en yavaş" masaüstünde yok: en yüksek /app/asistan (temiz medyan 2020 ms), diğer hepsi <= 1.6 sn.

## Yöntem ve sınırlar (dürüst liste)

- Masaüstü 1440x900 soğuk n=5; mobil 390x844, 4x CPU, Fast 3G, soğuk n=5 (ilk raporda 3'tü). Menü geçişi: masaüstü 3 oturum, mobil 3 oturum (ilk raporda 5 ve kısmi); her oturum yeni girişle. Tablolar medyan.
- Ölçüm sırasında demo oturumu birkaç kez düştü (paralel ajan girişleri). İlk geçişte ~7 sayfada oturum `/giris`'e atılmış tekrarlar çıktı; betik `perf2.mjs` bunları tespit edip yeniden girişle tekrarlayacak şekilde güncellendi, geçersiz tekrarlar tablodan çıkarıldı (ilk masaüstü turu `after2` + yeniden ölçülen 6 sayfa birleştirildi).
- Aykırı değer: TTFB > 1000 ms olan tekrarlar "n (aykırı)" sütununda sayılır; medyan hepsini dâhil eder, "en yavaş" listesinde ayrıca "temiz" (aykırısız) medyan verilir. Ağ sıçramaları (TTFB 2.5-3.3 sn) yine görüldü, mobilde LCP üst sınırı 8-11 sn'ye çıkabiliyor; n=5 ile bile mobil LCP satırları ±1 sn gürültülüdür. Tek sayfa farklarından çok toplu medyan farkına güvenin.
- Mobil "önce" geçiş verisi ilk raporda yalnız ~10 sayfaydı ve çoğu satır boştu; mobil geçiş karşılaştırması bu yüzden eşit değil. Mobil geçişler programatik tık (menü mobilde görünmediği için).
- FCP karşılaştırması adil değil: `AppShell` Suspense yüzünden /app FCP'si artık yüklenme ekranının boyanmasıdır; içerik göstergesi LCP'dir (hero/"Bugün N görev" metni).
- Mobil geçiş süreleri (tıklama -> DOM 400 ms sessiz) 4x CPU'da 0.2-4.8 sn arası geniş dağılıyor (n=3).
- Tek lokasyon/tek ağ; Server-Timing başlığı yok (sunucu süresi ölçülemez). Konsolda: yalnız masaüstü ilk turda geçersiz oturum kaynaklı 403 (yeniden girişle tekrarlanan sayfalar).
- Betikler repoda değil (scratchpad: `perf2.mjs`, `merge.mjs`, `diagapp.mjs`, `nojs.mjs`, `cls.mjs`, `htmlsplit.mjs`, `an3.cjs`).

## Önce / sonra tabloları

"Önce" = HIZ_OLCUM_RAPORU.md'deki canlı rakamlar (düzeltmeden önce). Süreler ms. Geçiş = menü tıklaması -> içerik oturması (ilk / sıcak). n (aykırı) = geçerli tekrar sayısı (TTFB>1000 olanlar).

### Masaustu 1440x900 (soguk, n=5)

| Sayfa | LCP once | LCP sonra | fark | FCP once | FCP sonra | TTFB once | TTFB sonra | CLS once | CLS sonra | Gecis ilk once>sonra | Gecis sicak once>sonra | n (aykiri) | not |
| ---|---|---|---|---|---|---|---|---|---|---|---|---|--- |
| / | 2768 | 1140 | -1628 | 2768 | 1140 | 313 | 203 | 0.000 | 0.002 | - > - | - > - | 5 (1) |  |
| /fiyatlar | 1216 | 568 | -648 | 1216 | 568 | 233 | 200 | 0.000 | 0.007 | - > - | - > - | 5 (2) |  |
| /giris | 1328 | 600 | -728 | 1328 | 600 | 237 | 193 | 0.000 | 0.000 | - > - | - > - | 5 (1) |  |
| /vitrin/demo-ofis | 4736 | 856 | -3880 | 4072 | 552 | 3557 | 191 | 0.000 | 0.000 | - > - | - > - | 5 (1) |  |
| /app | 1848 | 1156 | -692 | 1172 | 600 | 225 | 196 | 0.000 | 0.946 | - > - | - > - | 5 (1) |  |
| /app/brifing | 1572 | 792 | -780 | 924 | 336 | 228 | 66 | 0.000 | 0.025 | 509 > 396 | 204 > - | 5 (0) | YONLENDIRME /app |
| /app/musteriler | 1944 | 1492 | -452 | 1040 | 644 | 240 | 194 | 0.000 | 0.001 | 258 > 252 | 253 > 130 | 5 (1) |  |
| /app/talepler | 1928 | 1284 | -644 | 1080 | 884 | 248 | 199 | 0.000 | 0.001 | 234 > 138 | 428 > 122 | 5 (1) |  |
| /app/eslestirme | 1772 | 1130 | -642 | 1052 | 366 | 220 | 63 | 0.000 | 0.000 | 300 > - | 255 > 127 | 4 (0) | YONLENDIRME /app/talepler |
| /app/portfoyler | 2612 | 1264 | -1348 | 1084 | 564 | 229 | 192 | 0.000 | 0.000 | 196 > 120 | 265 > 215 | 5 (0) |  |
| /app/kiralama | 1716 | 1440 | -276 | 1080 | 644 | 230 | 195 | 0.001 | 0.000 | 209 > 185 | 370 > 70 | 5 (1) |  |
| /app/anlasmalar | 1800 | 1608 | -192 | 968 | 696 | 271 | 202 | 0.000 | 0.000 | 1130 > 79 | 315 > 127 | 5 (1) |  |
| /app/teklifler | 2236 | 1500 | -736 | 1260 | 648 | 234 | 198 | 0.000 | 0.000 | 513 > 176 | 217 > 72 | 5 (0) |  |
| /app/sozlesmeler | 2060 | 1444 | -616 | 1336 | 764 | 224 | 203 | 0.000 | 0.000 | 256 > 89 | 324 > 62 | 5 (1) |  |
| /app/gelen-kutusu | 2044 | 1424 | -620 | 1304 | 628 | 240 | 198 | 0.000 | 0.000 | 322 > 191 | 189 > 140 | 5 (1) |  |
| /app/randevular | 2024 | 1568 | -456 | 1208 | 752 | 228 | 198 | 0.000 | 0.000 | 331 > 230 | 237 > 118 | 5 (1) |  |
| /app/gorevler | 4596 | 1496 | -3100 | 4000 | 744 | 250 | 203 | 0.000 | 0.000 | 267 > 79 | 403 > 106 | 5 (1) |  |
| /app/kampanyalar | 1488 | 1360 | -128 | 956 | 572 | 217 | 200 | 0.000 | 0.000 | 302 > 60 | 244 > 80 | 5 (1) |  |
| /app/komisyon | 1836 | 1336 | -500 | 784 | 708 | 214 | 200 | 0.000 | 0.000 | 226 > 57 | 304 > 120 | 5 (1) |  |
| /app/giderler | 1584 | 1544 | -40 | 932 | 672 | 209 | 201 | 0.000 | 0.000 | 174 > 108 | 231 > 64 | 5 (1) |  |
| /app/raporlar | 1632 | 944 | -688 | 1172 | 548 | 216 | 200 | 0.000 | 0.000 | 138 > 119 | 318 > 121 | 5 (0) |  |
| /app/kayip-kacak | 1580 | 1120 | -460 | 768 | 580 | 222 | 197 | 0.001 | 0.001 | 331 > 239 | 195 > 152 | 5 (1) |  |
| /app/degerleme | 2048 | 1404 | -644 | 928 | 556 | 231 | 200 | 0.000 | 0.000 | 332 > 468 | 265 > 313 | 5 (1) |  |
| /app/ekip | 1544 | 980 | -564 | 1544 | 540 | 226 | 191 | 0.000 | 0.000 | 327 > 56 | 367 > 105 | 5 (1) |  |
| /app/hedefler | 1556 | 1096 | -460 | 1044 | 616 | 229 | 201 | 0.000 | 0.000 | 305 > 107 | 241 > 69 | 5 (1) |  |
| /app/otomasyonlar | 2188 | 956 | -1232 | 1680 | 536 | 278 | 199 | 0.000 | 0.000 | 185 > 140 | 225 > 106 | 5 (1) |  |
| /app/asistan | 1456 | 2728 | +1272 | 836 | 1028 | 231 | 209 | 0.000 | 0.000 | 270 > 187 | 231 > 64 | 5 (2) |  |
| /app/ayarlar | 1820 | 1484 | -336 | 1028 | 644 | 236 | 195 | 0.000 | 0.000 | 229 > 239 | 316 > 322 | 5 (0) |  |
| /app/abonelik | 1764 | 1148 | -616 | 1120 | 644 | 241 | 192 | 0.000 | 0.000 | 331 > 97 | 317 > 78 | 5 (0) |  |

Ozet (sayfa medyanlarinin medyani): public LCP 2048 > 728, FCP 2048 > 584; /app LCP 1836 > 1404, FCP 1080 > 644; /app gecis ilk 269 > 129, sicak 265 > 112

En yavas 8 (LCP medyan, sonra): /app/asistan 2728 (temiz 2020, aykiri 2, maks 8612); /app/anlasmalar 1608 (temiz 1558, aykiri 1, maks 4988); /app/randevular 1568 (temiz 1328, aykiri 1, maks 4824); /app/giderler 1544 (temiz 1432, aykiri 1, maks 5508); /app/teklifler 1500 (temiz 1500, aykiri 0, maks 5936); /app/gorevler 1496 (temiz 1450, aykiri 1, maks 4496); /app/musteriler 1492 (temiz 1468, aykiri 1, maks 3464); /app/ayarlar 1484 (temiz 1484, aykiri 0, maks 5560)

En yavas 8 (menu gecisi ilk): /app/degerleme 468 (n=3); /app/brifing 396 (n=1); /app/musteriler 252 (n=3); /app/ayarlar 239 (n=3); /app/kayip-kacak 239 (n=3); /app/randevular 230 (n=3); /app/gelen-kutusu 191 (n=3); /app/asistan 187 (n=3)

### Mobil 390px 4x CPU Fast 3G (soguk, n=5)

| Sayfa | LCP once | LCP sonra | fark | FCP once | FCP sonra | TTFB once | TTFB sonra | CLS once | CLS sonra | Gecis ilk once>sonra | Gecis sicak once>sonra | n (aykiri) | not |
| ---|---|---|---|---|---|---|---|---|---|---|---|---|--- |
| / | 4532 | 3344 | -1188 | 2784 | 3344 | 217 | 234 | 0.000 | 0.001 | - > - | - > - | 5 (2) |  |
| /fiyatlar | 6596 | 2824 | -3772 | 4848 | 2212 | 243 | 203 | 0.000 | 0.003 | - > - | - > - | 5 (1) |  |
| /giris | 3352 | 2900 | -452 | 3352 | 2048 | 227 | 210 | 0.000 | 0.000 | - > - | - > - | 5 (1) |  |
| /vitrin/demo-ofis | 4056 | 4240 | +184 | 2716 | 2156 | 211 | 220 | 0.000 | 0.002 | - > - | - > - | 5 (1) |  |
| /app | 4980 | 6532 | +1552 | 2640 | 2064 | 216 | 206 | 0.000 | 1.633 | - > - | - > - | 5 (2) |  |
| /app/brifing | 3448 | 2118 | -1330 | 2704 | 600 | 202 | 279 | 0.000 | 0.000 | 3021 > - | - > 272 | 4 (0) | YONLENDIRME /app |
| /app/musteriler | 6008 | 5220 | -788 | 2648 | 2076 | 204 | 196 | 0.000 | 0.003 | 855 > 1126 | - > 813 | 5 (1) |  |
| /app/talepler | 6564 | 3988 | -2576 | 5188 | 2104 | 2443 | 196 | 0.000 | 0.003 | 1115 > 610 | - > 449 | 5 (1) |  |
| /app/eslestirme | 8092 | 1420 | -6672 | 6536 | 674 | 219 | 298 | 0.000 | 0.000 | 355 > - | - > 186 | 4 (0) | YONLENDIRME /app/talepler |
| /app/portfoyler | 3212 | 5980 | +2768 | 2472 | 2096 | 213 | 194 | 0.000 | 0.003 | 629 > 240 | - > 1256 | 5 (1) |  |
| /app/kiralama | 4952 | 4036 | -916 | 2656 | 2180 | 210 | 206 | 0.000 | 0.007 | 2907 > 1261 | - > 771 | 5 (1) |  |
| /app/anlasmalar | 4220 | 5584 | +1364 | 2736 | 2136 | 204 | 212 | 0.000 | 0.003 | - > 1691 | - > 485 | 5 (1) |  |
| /app/teklifler | 6800 | 4612 | -2188 | 6228 | 2040 | 223 | 193 | 0.000 | 0.020 | - > 3859 | - > 398 | 5 (1) |  |
| /app/sozlesmeler | 5836 | 3532 | -2304 | 3216 | 2064 | 225 | 194 | 0.000 | 0.002 | - > 114 | - > 368 | 5 (0) |  |
| /app/gelen-kutusu | 7944 | 3504 | -4440 | 3996 | 1980 | 1379 | 192 | 0.000 | 0.004 | - > 1154 | - > 335 | 5 (1) |  |
| /app/randevular | 10220 | 5728 | -4492 | 6392 | 2604 | 212 | 286 | 0.000 | 0.003 | 66 > 689 | - > 500 | 5 (1) |  |
| /app/gorevler | 6944 | 6268 | -676 | 4572 | 2104 | 2126 | 217 | 0.000 | 0.019 | 49 > 923 | - > 263 | 5 (1) |  |
| /app/kampanyalar | 4372 | 3396 | -976 | 2960 | 2064 | 217 | 200 | 0.000 | 0.005 | - > 214 | - > 223 | 5 (1) |  |
| /app/komisyon | 4412 | 5856 | +1444 | 3580 | 2124 | 224 | 208 | 0.000 | 0.003 | - > 168 | - > 227 | 5 (0) |  |
| /app/giderler | 3924 | 4172 | +248 | 2660 | 2196 | 208 | 234 | 0.000 | 0.134 | - > 4807 | - > 178 | 5 (1) |  |
| /app/raporlar | 6160 | 6524 | +364 | 2592 | 2780 | 268 | 231 | 0.000 | 0.003 | - > 2276 | - > 310 | 5 (1) |  |
| /app/kayip-kacak | 3360 | 3144 | -216 | 2696 | 2188 | 197 | 207 | 0.008 | 0.010 | - > 1302 | - > 362 | 5 (0) |  |
| /app/degerleme | 4392 | 3356 | -1036 | 2788 | 1980 | 205 | 195 | 0.000 | 0.005 | - > 1600 | - > 1852 | 5 (0) |  |
| /app/ekip | 4336 | 4576 | +240 | 2684 | 2580 | 195 | 196 | 0.000 | 0.017 | - > 1472 | - > 299 | 5 (1) |  |
| /app/hedefler | 4220 | 3104 | -1116 | 2684 | 1924 | 202 | 197 | 0.000 | 0.000 | - > 4070 | - > 219 | 5 (1) |  |
| /app/otomasyonlar | 3380 | 2724 | -656 | 2604 | 1984 | 204 | 198 | 0.000 | 0.001 | - > 359 | - > 366 | 5 (1) |  |
| /app/asistan | 3916 | 2356 | -1560 | 2688 | 1776 | 206 | 197 | 0.000 | 0.000 | - > 382 | - > 347 | 5 (1) |  |
| /app/ayarlar | 4244 | 3208 | -1036 | 2644 | 1988 | 215 | 192 | 0.000 | 0.006 | - > 2508 | - > 1115 | 5 (0) |  |
| /app/abonelik | 3976 | 2424 | -1552 | 2716 | 1772 | 200 | 190 | 0.000 | 0.000 | - > 1525 | - > 252 | 5 (1) |  |

Ozet (sayfa medyanlarinin medyani): public LCP 4294 > 3122, FCP 3068 > 2184; /app LCP 4392 > 4036, FCP 2696 > 2076; /app gecis ilk 742 > 1207, sicak - > 364

En yavas 8 (LCP medyan, sonra): /app 6532 (temiz 6532, aykiri 2, maks 8392); /app/raporlar 6524 (temiz 5102, aykiri 1, maks 10172); /app/gorevler 6268 (temiz 5800, aykiri 1, maks 9648); /app/portfoyler 5980 (temiz 5728, aykiri 1, maks 7968); /app/komisyon 5856 (temiz 5856, aykiri 0, maks 6856); /app/randevular 5728 (temiz 5618, aykiri 1, maks 11132); /app/anlasmalar 5584 (temiz 4560, aykiri 1, maks 8276); /app/musteriler 5220 (temiz 5118, aykiri 1, maks 10052)

En yavas 8 (menu gecisi ilk): /app/giderler 4807 (n=3); /app/hedefler 4070 (n=3); /app/teklifler 3859 (n=3); /app/ayarlar 2508 (n=3); /app/raporlar 2276 (n=3); /app/anlasmalar 1691 (n=3); /app/degerleme 1600 (n=3); /app/abonelik 1525 (n=3)

## /app mobil "içerik JS parçaları inene kadar görünmüyor" analizi

Önceki raporun 3. maddesi ("içerik 22 JS parçası inene kadar görünmüyor") ölçümle SINANDI ve kısmen yanlış bulundu. Düzeltilmiş kök neden aşağıda.

### Ölçüm 1: /app ana ekran mobil şelalesi (canlı, 4x CPU Fast 3G, soğuk)

Tipik temiz tekrar (`diagapp.mjs`): TTFB 204, HTML bitişi (responseEnd) 1021, FCP 1792 (= "E" yüklenme ekranı boyandı), domInteractive 1896, **gerçek içerik LCP 2800**, `load` 6282 ms.
- HTML: 422 KB ham / 35 KB brotli. İçinde 237 KB RSC "flight" yükü (15 `__next_f.push`), 178 KB işaretleme, 19 Suspense yedek şablonu (`<template id="B:..">`) ve 15 gizli `S:` bölümü.
- En büyük flight parçası 93 KB: yaklaşık 450 adet SVG `rect` (fill/x/y/width/height/opacity) = dashboard widget'ında sunucuda üretilen ısı/aktivite ızgarası; aynı veri hem HTML'de hem flight'ta iki kez gidiyor. Sonraki: 34 KB (kök layout/meta), 20 KB, 16 KB (randevular widget'ı, yine SVG ağırlıklı).
- 20 `async` script + 3 CSS tek seferde (764-772 ms) başlıyor: 42 KB render-engelleyici CSS 1.6 sn'de, 73 KB ana parça 4.4 sn'de, 35 KB parça 3.9 sn'de biter; 4 font dosyası (169 KB) içerik açılınca 1.7 sn'de başlayıp JS ile bant paylaşıyor; supabase-js parçası (247 KB ham / ~55-66 KB brotli, `realtime-refresh.tsx` dinamik import) en son 6.5 sn'de iniyor ve ardından 10+ `?_rsc=` önyükleme isteği (AppPrefetcher) geliyor. Bu zincir `load` olayını 6.3 sn'ye uzatıyor ama içeriği görünür kılan şey değil.
- Ağ sıçraması olan tekrarlarda (HTML 5.1 sn'de bitti) içerik 5.2-6.3 sn'de, yani HTML bitişinden ~1.1-1.6 sn sonra geliyor.

### Ölçüm 2: deney, JS kapalı (`nojs.mjs`)
Aynı profilde `/_next/static/**/*.js` istekleri iptal edildi (satır içi `$RC` betikleri çalışır):

| mod | FCP | responseEnd | domInteractive | içerik (LCP) |
|---|---|---|---|---|
| normal | 1780 | 1042 | 1905 | 2676 |
| JS parçaları engelli | 1796 | 1024 | 1914 | 2688 |
| normal (2) | 1744 | 1025 | 3000 | 5192 |
| JS engelli (2) | 1980 | 982 | 2256 | 3700 |
| JS engelli (3) | 2148 | 1327 | 2199 | 3532 |
| yalnız büyük parça engelli | 2052 | 981 | 3140 | 2960 |

Sonuç: içerik JS inmediği hâlde aynı anda (2.7-3.7 sn) görünüyor. Yani içeriği geciktiren 22 JS parçası DEĞİL.

### Kök neden (düzeltilmiş)
1. `AppShell` tek bir Suspense sınırı: önce `RouteSplash` boyanıyor (FCP = splash), asıl sayfa HTML akışının SONUNDA, React Fizz'in `$RC` ile yedeği açmasıyla görünüyor. Akış 422 KB (flight dâhil); 4x CPU'da bu HTML'in ayrıştırılması + 178 KB işaretlemenin yerleşimi + 42 KB render-engelleyici CSS içeriği HTML bitişinden ~0.9-1.6 sn sonrasına itiyor (domInteractive'dan ~0.8 sn sonra).
2. JS'in rolü ikincil: 20 async script ana iş parçacığını (4x CPU) meşgul ediyor; hydrate/etkileşim (INP) gecikiyor ama ilk içerik boyası SSR olduğu için JS'e bağlı değil. JS bant genişliğini fontlarla ve önyüklemelerle paylaşarak `load`'u 6+ sn'ye çıkarıyor.
3. Flight yükü tekrarı: 450 SVG elemanlı widget iki kez serileştiriliyor (HTML + flight, 93 KB ham).

### /app ilk-yük JS envanteri (`next build`, `route-bundle-stats.json` + chunk içerik analizi)

`/app`: 23 parça, 774 742 B ham, 213 302 B brotli (supabase-js ve diğer lazy parçalar hariç). Build ortamı: dummy Supabase env (yalnız boyutlar için).

| # | Parça | Ham KB | Brotli KB | İçerik |
|---|---|---|---|---|
| 1 | 2_zz1raqk76q6.js | 228.8 | 61.1 | react-dom (tek modül 196 KB) |
| 2 | 0bn-t38f-wz5i.js | 126.3 | 28.9 | Next istemci yönlendirici/runtime (61 modül) |
| 3 | 17wz9ixcy_549.js | 55.4 | 15.8 | nav-config, son kullanılan/pin deposu, NotificationPrefsPanel, UserMenu, Radix Dialog/Close |
| 4 | 31ty8v1khhv6z.js | 35.1 | 10.1 | AppSidebar (16 KB), NotificationBell (8 KB), CommandSearch, KeyboardShortcuts, RealtimeRefresh |
| 5 | 2tibjj64e5g99.js | 33.9 | 10.0 | Radix: RemoveScroll, DismissableLayer, FocusScope, Presence |
| 6 | 1r1m-oo2kg94o.js | 33.1 | 9.2 | lucide ikonları (ICONS/TAB_ICONS haritası + ~66 ikon modülü) |
| 7 | 26g4tn5b226u5.js | 31.2 | 7.3 | react, scheduler, process polyfill |
| 8 | 3faogi9vh8ytz.js | 27.2 | 7.8 | Radix DropdownMenu (15.7 KB) + Collection + RovingFocus |
| 9 | 1coxc--lgbm7x.js | 26.4 | 7.2 | `cn` (tailwind-merge, tek modül 27 KB) |
| 10 | 3pl_lg74t9sz3.js | 26.3 | 9.3 | Radix Popper/Popover (Anchor, Arrow, Content) |
| 11 | 2-urkx3cuhmdn.js | 26.2 | 7.4 | react-server-dom istemcisi (RSC akışı çözücü, 23 KB) |
| 12 | 3_ciea8vrk06a.js | 20.0 | 6.1 | ProductTour (7 KB), DashboardWidgetProvider, TaskQuickRow, Button, ConfirmDialog |
| 13 | 2za8p-mgjr8wt.js | 19.3 | 6.2 | Dialog (8 KB) + yardımcılar |
| 14 | 33t46atd3n2zd.js | 14.1 | 3.2 | Turbopack/Next ortak |
| 15 | 30ufterrgtej5.js | 13.3 | 4.7 | Next istemci (default export) |

Tahmini dağılım (ham): framework tabanı ~475 KB (react-dom + Next runtime + RSC çözücü + react), uygulama kabuğu ~300 KB (bunun ~165 KB'ı Radix; ~60 KB uygulama kabuğu kodu; ~34 KB lucide; 27 KB tailwind-merge). Uygulama kabuğu kodunun hemen hemen hepsi (Sidebar, Bell, Search, Dialog, Dropdown, Popover) ilk boyaya gerekmeyen ve etkileşimle açılan bileşenlerdir.
Sayfa başına ek: /app/brifing +0, /app/musteriler +2, /app/giderler +3, /app/ayarlar +2 parça (ayarlar toplam 1.10 MB ham ilk yük, en ağırı).
Not: canlıdaki "JS KB 481" Resource Timing değeri supabase-js parçasını (247 KB ham) açılmış boyutla içerir; `curl` ile `Content-Encoding: br` doğrulandı, gerçek tel boyutu ~55-66 KB.

## Öneriler (tahmini kazanç; hiçbiri uygulanmadı)

Sıra, mobil içerik süresine etkiye göredir. Kazançlar tahmindir (4x CPU/Fast 3G ölçümlerinden çıkarım), uygulandıktan sonra aynı betikle doğrulanmalı.

1. Ürün turu spotlight'ını transform/opacity ile animasyonla veya turu ilk boyadan sonraya (idle) ertele; `top/left/width/height` geçişi CLS 0.95-1.63 üretiyor. Tur parçasını `next/dynamic` (ssr:false) yap: -7 KB ham (~-2.5 KB brotli) + -1 parça ve /app CLS ~0'a iner. Çaba: küçük. Bu bir regresyon sinyali (ilk raporda /app CLS 0.000'dı) — öncelik 1.
2. Dashboard'daki 450 `rect`'lik SVG ızgarasını (ve randevular widget'ındaki benzerini) tek `path`/CSS gradyanı veya küçük bir istemci bileşeni + sayı dizisi olarak sun: HTML+flight toplamında ~-100-130 KB ham (HTML 422 -> ~300 KB; brotli ~-8-10 KB). Mobilde ayrıştırma/yerleşim ve `$RC` sonrası boya süresi kısalır; tahmin: LCP -0.3-0.6 sn (4x CPU).
3. Suspense'i böl: `RouteSplash` yerine kalıcı kabuk (üst bar + yan menü iskeleti, sunucuda sabit) ve yalnız veriye bağlı parçalar (rozetler, bildirim, widget'lar) ayrı, küçük sınırlarda akıtılsın; ana içerik (görev/hero metni) ilk akış parçasında gitsin. Böylece FCP gerçek kabuk olur ve LCP, tüm 422 KB'ın inmesini beklemez. Tahmin: sıcak ağda LCP -0.8-1.2 sn, yavaş ağda ağa bağlı olarak -1 sn'ye kadar. Çaba: orta (layout sorgularının sırası ve `requireModulePage` kapıları korunmalı).
4. Etkileşimle açılan kabuk bileşenlerini `next/dynamic` ile ertele (CommandSearch + Dialog, NotificationBell paneli + NotificationPrefsPanel, UserMenu açılır menüsü, Popover): Radix Dialog/Dropdown/Popover + RemoveScroll/FocusScope/DismissableLayer ve ilgili uygulama kodu ~120-135 KB ham (~38-45 KB brotli, ilk yükün ~%20'si) ilk yükten çıkar; 4x CPU'da ayrıştırma ~-0.2-0.3 sn. Çaba: orta (düğme gövdesi hemen render edilip panel dinamik açılır).
5. `realtime-refresh` ve `AppPrefetcher`'ı `requestIdleCallback`/load sonrası 3-5 sn'ye ve mobilde dokunma/hover niyetine bağla: supabase-js (55-66 KB brotli) ve 10+ `_rsc` isteği ilk 6 sn'de fontlar/JS ile yarışmaz; mobil `load` 6.3 sn -> ~4.5 sn tahmini, LCP'ye etkisi dolaylı. Çaba: küçük.
6. `cn` (tailwind-merge, 27 KB ham / 7 KB brotli) yerine istemci kabuğunda `clsx` + sınırlı birleştirme; lucide'ı yalnız kullanılan ikonlarla kısıtla (ICONS/TAB_ICONS haritasını yalnız aktif bölüm ikonlarına böl): toplam ~-12-18 KB brotli. Çaba: küçük-orta, düşük öncelik.
7. /app/ayarlar (1.10 MB ham ilk yük) için sekme içeriklerini sekme bazlı dinamik içe aktar: tahmin ~-250-350 KB ham.
8. Tabana dokunmadan kalan limit: react-dom + Next runtime + RSC çözücü ~130 KB brotli kaçınılmaz; ilk yük brotli tabanı yaklaşık 213 -> ~130-150 KB'a indirilebilir (öneri 1-6 birlikte).
9. İzleme: /app CLS'i (şu an 0.95-1.63) ve mobil LCP medyanını `perf2.mjs` ile deploy sonrası yeniden ölç; ağ sıçramaları için CI'da n>=5 ve aykırı ayıklama kullan.
