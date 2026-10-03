# Hız Ölçüm Raporu (gerçek ölçüm)

Tarih: 2026-10-03. Canlı site: https://emlaksoft.vercel.app (Vercel, fra1). Ölçüm: Playwright (Chromium) + PerformanceObserver.
Önceki hız turu yalnızca kod analiziydi; bu rapor gerçek ölçüme dayanır. Veri yazılmadı (salt-okunur; "Ofis sahibi" demo girişi).

## Özet

- Masaüstünde sistem zaten hızlı: soğuk açılışta TTFB ~210-250 ms, LCP medyanı 1.4-2.6 sn, CLS ~0, menü geçişi ilk ziyarette ~140-500 ms (bir istisna: Anlaşmalar 1130 ms), sıcak geçiş ~190-430 ms.
- Asıl yavaşlık mobil/yavaş ağda: FCP tabanı ~2.6-2.8 sn, LCP 3.3-10 sn.
- Ölçümün gösterdiği iki kök neden bulundu ve düzeltildi (aşağıda): (1) kritik olmayan 4 font dosyasının (169 KB) CSS/JS ile aynı anda preload edilmesi, (2) kök `loading.tsx`'in statik sayfaları "önce yedek, sonra gizli bölüm + $RC" biçimine çevirmesi (içerik tüm HTML inene kadar görünmüyordu).

## Yöntem

- Profiller: masaüstü (1440x900, kısıtlama yok) ve mobil (390x844, 4x CPU yavaşlatma, "Fast 3G": 1.6 Mbps aşağı, 750 Kbps yukarı, 562.5 ms gecikme, CDP).
- Sayfalar: / , /fiyatlar , /giris , /vitrin/demo-ofis + 25 /app sayfası.
- Soğuk yükleme: her tekrarda yeni tarayıcı bağlamı (boş önbellek), `load` + 2-3.5 sn bekleme; LCP/FCP/CLS PerformanceObserver (buffered), TTFB navigation timing, kaynaklar resource timing.
- Sayfa geçişi: sol menü linkine gerçek tıklama (görünmüyorsa programatik tık / router.push); süre = tıklama olay zamanı -> URL değişimi + DOM 400 ms sessizleşene kadar son değişiklik. "ilk" = oturumun ilk geçişi, "sıcak" = aynı oturumda ikinci tur (staleTimes/prefetch önbelleği).
- INP*: geçiş tıklamalarının `event` girdilerinin (interactionId) en büyüğü; tam INP değil, tıklama gecikmesi yaklaşığı. Menü tıklaması INP'si masaüstünde 32-200 ms (iyi sınır 200 ms).
- Tekrar: masaüstü 5, mobil 3 (mobil geçiş oturumu 2 ve kısmi). Tablolar medyan.
- Betikler (repoda değil): scratchpad `perf.mjs`, `analyze.mjs`, `diag.mjs`.

## Sınırlar (dürüst liste)

- Tek lokasyon (Türkiye'deki bu makine -> fra1), tek ağ; ağ/VPN değişkenliği büyük. ARA SIRA 3.5-7.5 sn TTFB sıçramaları görüldü (statik ana sayfada bile; `curl` ile 12 denemede x-vercel-cache: HIT iken 1 tanesi 4.4 sn sürdü). Bu uygulama kodundan değil kenar/ağ kaynaklı görünüyor; medyan bunu büyük ölçüde emer ama n=3 mobilde tek sıçrama medyanı bozabilir (mobil en yavaş listesi bu yüzden gürültülüdür).
- Server-Timing başlığı yok; sunucu sorgu süresi canlı ölçümden çıkarılamadı (TTFB ~210-250 ms taban).
- Mobil sayfa geçişi verisi kısmi (ilk ~10 sayfa); tam değil. Mobilde menü görünmediği için geçişler programatik tık.
- Canlı "sonra" ölçümü YAPILAMADI (push yok, deploy yok). "Sonra" rakamları yerel `next build && next start` + aynı kısıtlama ile yalnız public sayfalarda (/ , /fiyatlar , /giris) ölçüldü; /app sayfaları yerelde oturum/DB gerektirdiği için ölçülemedi. Deploy sonrası aynı betikle yeniden ölçülmeli.
- `jsKB` bazı sayfalarda şişik görünür: Resource Timing önbellekten gelen parçaları açılmış boyutla verir (supabase-js parçası 247 KB görünür, brotli 66 KB). Sayfalar arası 300 vs 480 KB farkı bu artefakttır.
- Demo oturumu ~30 dk sonra / eşzamanlı ikinci girişte geçersiz oluyor; ölçüm bu yüzden sıralı ve sayfa başına yeniden giriş ile yapıldı. Konsol: yalnız mobilde 1 kez `InvalidStateError: Transition was aborted because of invalid state` (View Transition iptali, /app/kampanyalar); işlevsel etkisi görülmedi.

## Kök neden analizi (ölçümle desteklenen)

1. Font preload rekabeti. Mobil şelale (diag): 4 woff2 dosyası (Manrope latin 83 KB + latin-ext 15 KB, Inter latin 47 KB + latin-ext 24 KB = 169 KB) `rel=preload` ile CSS (42 KB, render-blocking) ve 20 JS parçasıyla aynı anda başlıyor; 180 KB/sn bantta CSS 2.3 sn'de, JS 4.0-4.7 sn'de bitiyor. `display: swap` zaten olduğu için fontlar kritik değildi; yalnızca bant genişliği çalıyordu.
2. Kök `loading.tsx` -> statik sayfalarda gecikmiş görünürlük. Ana sayfa HTML'i (517 KB ham) `<template id="B:0">` (yedek: "E" yükleme ekranı) + gizli `<div id="S:0">` + `$RC` içeriyor: React Fizz 12.8 KB'tan büyük tamamlanmış sınırı "dışarı çıkarıp" sonradan açıyor. LCP öğesi (hero metni) domInteractive anında (3.1 sn) görünüyor, oysa HTML 0.96 sn'de inmişti. Aynı durum /fiyatlar ve yasal sayfalar için de geçerli (hepsi kök sınırın altında).
3. (Ölçüldü, düzeltilmedi) Mobilde /app: HTML ~1.3 sn'de iniyor ama sayfa içeriği JS parçaları (22 parça, 73+35 KB ana) inene kadar (4.5-6 sn) görünmüyor; ayrıca ilk 3G el sıkışması tabanı. Ek düzeltme için canlı deploy sonrası yeniden ölçüm gerekir.
4. Etkisiz bulunanlar: layout sorguları paralel/spekülatif zaten; proxy yalnız /app,/admin,/giris,/kayit; staleTimes 30 sn çalışıyor (sıcak geçiş soğuk geçişten belirgin hızlı değil ama RSC yükü küçük: 0-30 KB); recharts zaten lazy; supabase-js zaten dinamik import.

## Yapılan düzeltmeler (küçük, geri alınabilir)

1. `src/app/layout.tsx`: Manrope ve Inter `preload: false` (display swap kalır; next/font metrik uyumlu yedek ile CLS 0.000-0.003).
2. Kök `src/app/loading.tsx` kaldırıldı; içerik `src/components/route-splash.tsx` oldu. `/app` ve `/admin` layout'ları kabuğu kendi `<Suspense fallback={<RouteSplash/>}>` içine alıyor (davranış aynı: kabuk hazır olana dek aynı yükleme ekranı; yetki/oturum mantığına dokunulmadı, yalnızca `AppShell`/`AdminShell` olarak yeniden adlandırıldı). Dinamik public segmentlere (giris, kayit, vitrin, danisman, degerleme-raporu, imza, lead, malik-portali, musteri-portali, odeme-link, paylas, randevu-teyit, sunum, acik-ev-kayit) tek satırlık `loading.tsx` (re-export) eklendi. Statik sayfalar (/, /fiyatlar, /demo, yasal sayfalar, şifre sayfaları) artık Suspense dışında.
3. `src/lib/ux-accessibility-contract.test.ts`: yükleme ekranı sözleşmesi yeni dosyayı okuyor.
Geri alma: commit'i geri al (tek commit).

## Önce / sonra (yerel, mobil 390px 4x CPU Fast 3G, n=5, medyan, LCP ms)

| Sayfa | Önce (yerel taban) | Yalnız font preload kapalı | Yalnız kök loading kaldırılmış | İkisi birlikte (son) | Fark |
|---|---|---|---|---|---|
| / (ana sayfa) | 4492 (FCP 2584) | 4048 (FCP 1944) | 2476 (FCP 1980) | 2084 (FCP 1856) | -2408 ms (%54) |
| /fiyatlar | 3640 (FCP 2568) | 2852 (FCP 1928) | 2608 (FCP 2032) | 2068 (FCP 1856) | -1572 ms (%43) |
| /giris | 2852 (FCP 2532) | 2000 (FCP 1688) | 1992 (FCP 1856) | 2148 (FCP 1880) | -704 ms (%25) |

Yerel taban, canlı ölçümle tutarlı (canlı mobil: / LCP 4532, /fiyatlar 6596 (gürültülü), /giris 3352). /app sayfalarında font düzeltmesinin FCP'yi benzer (~0.6-0.8 sn) düşürmesi beklenir ama ölçülmedi.

EOF
## Tablo: masaüstü, canlı, soğuk n=5, medyan (ms; Geçiş = menü tıklaması -> içerik; INP* = en büyük tıklama gecikmesi; RSC KB = geçişte inen RSC yükü)


| Sayfa | TTFB | FCP | LCP | CLS | JS KB (n) | Toplam KB | Gecis ilk | Gecis sicak | INP* | RSC KB |
|---|---|---|---|---|---|---|---|---|---|---|
| / | 313 | 2768 | 2768 | 0.000 | 196 (16) | 521 | - | - | 0 | - |
| /fiyatlar | 233 | 1216 | 1216 | 0.000 | 233 (16) | 510 | - | - | 0 | - |
| /giris | 237 | 1328 | 1328 | 0.000 | 193 (16) | 457 | - | - | 0 | - |
| /vitrin/demo-ofis | 3557 | 4072 | 4736 | 0.000 | 193 (15) | 429 | - | - | 0 | - |
| /app | 225 | 1172 | 1848 | 0.000 | 481 (23) | 729 | - | - | 0 | - |
| /app/brifing | 228 | 924 | 1572 | 0.000 | 297 (22) | 543 | 509 | 204 | 0 | 8.4 |
| /app/musteriler | 240 | 1040 | 1944 | 0.000 | 496 (24) | 751 | 258 | 253 | 192 | 24.2 |
| /app/talepler | 248 | 1080 | 1928 | 0.000 | 309 (23) | 589 | 234 | 428 | 64 | 0.0 |
| /app/eslestirme | 220 | 1052 | 1772 | 0.000 | 475 (23) | 728 | 300 | 255 | 80 | 0.0 |
| /app/portfoyler | 229 | 1084 | 2612 | 0.000 | 324 (24) | 587 | 196 | 265 | 88 | 1.2 |
| /app/kiralama | 230 | 1080 | 1716 | 0.001 | 312 (24) | 562 | 209 | 370 | 56 | 18.9 |
| /app/anlasmalar | 271 | 968 | 1800 | 0.000 | 322 (24) | 613 | 1130 | 315 | 64 | 15.2 |
| /app/teklifler | 234 | 1260 | 2236 | 0.000 | 486 (23) | 743 | 513 | 217 | 0 | 2.8 |
| /app/sozlesmeler | 224 | 1336 | 2060 | 0.000 | 309 (23) | 601 | 256 | 324 | 64 | 0.0 |
| /app/gelen-kutusu | 240 | 1304 | 2044 | 0.000 | 309 (23) | 570 | 322 | 189 | 88 | 8.6 |
| /app/randevular | 228 | 1208 | 2024 | 0.000 | 327 (25) | 605 | 331 | 237 | 88 | 6.8 |
| /app/gorevler | 250 | 4000 | 4596 | 0.000 | 314 (23) | 580 | 267 | 403 | 48 | 2.4 |
| /app/kampanyalar | 217 | 956 | 1488 | 0.000 | 307 (24) | 590 | 302 | 244 | 56 | 0.0 |
| /app/komisyon | 214 | 784 | 1836 | 0.000 | 492 (24) | 751 | 226 | 304 | 0 | 0.0 |
| /app/giderler | 209 | 932 | 1584 | 0.000 | 421 (27) | 704 | 174 | 231 | 56 | 0.0 |
| /app/raporlar | 216 | 1172 | 1632 | 0.000 | 300 (23) | 586 | 138 | 318 | 32 | 0.2 |
| /app/kayip-kacak | 222 | 768 | 1580 | 0.001 | 477 (23) | 727 | 331 | 195 | 80 | 8.6 |
| /app/degerleme | 231 | 928 | 2048 | 0.000 | 480 (23) | 732 | 332 | 265 | 88 | 7.0 |
| /app/ekip | 226 | 1544 | 1544 | 0.000 | 308 (23) | 569 | 327 | 367 | 200 | 19.0 |
| /app/hedefler | 229 | 1044 | 1556 | 0.000 | 304 (23) | 577 | 305 | 241 | 80 | 19.9 |
| /app/otomasyonlar | 278 | 1680 | 2188 | 0.000 | 300 (23) | 578 | 185 | 225 | 40 | 7.4 |
| /app/asistan | 231 | 836 | 1456 | 0.000 | 307 (23) | 584 | 270 | 231 | 96 | 0.0 |
| /app/ayarlar | 236 | 1028 | 1820 | 0.000 | 560 (25) | 822 | 229 | 316 | 112 | 2.2 |
| /app/abonelik | 241 | 1120 | 1764 | 0.000 | 298 (23) | 582 | 331 | 317 | 128 | 0.0 |

En yavas 8 (LCP): /vitrin/demo-ofis 4736, /app/gorevler 4596, / 2768, /app/portfoyler 2612, /app/teklifler 2236, /app/otomasyonlar 2188, /app/sozlesmeler 2060, /app/degerleme 2048
En yavas 8 (gecis ilk): /app/anlasmalar 1130, /app/teklifler 513, /app/brifing 509, /app/degerleme 332, /app/kayip-kacak 331, /app/randevular 331, /app/abonelik 331, /app/ekip 327
Konsol hatalari: []
Server-Timing ornek: []
En buyuk kaynaklar: /_next/static/immutable/chunks/172xlm58_yl7p.js 241KB; /_next/static/immutable/chunks/39027wy-j6nsu.js 98KB; /_next/static/immutable/media/1bffadaabf893a1e.p.0szrwpqb9mkwe.woff2 84KB; /_next/static/immutable/chunks/10fvnfgpy5jkv.js 73KB; /_next/static/immutable/chunks/02fbm2lkgv8-6.js 67KB; /_next/static/immutable/media/a24d9e981578d580.3i5xonuquvnt4.woff2 50KB; /_next/static/immutable/media/83afe278b6a6bb3c.p.45535valc9rzk.woff2 48KB; /_next/static/immutable/chunks/1bhx2yk-npjqp.css 40KB; /_next/static/immutable/chunks/3fa_rg-qetabj.js 35KB; /?_rsc=8nTjltbQWvg6NcbE 29KB


## Tablo: mobil 390px, 4x CPU, Fast 3G, canlı, soğuk n=3, medyan


| Sayfa | TTFB | FCP | LCP | CLS | JS KB (n) | Toplam KB | Gecis ilk | Gecis sicak | INP* | RSC KB |
|---|---|---|---|---|---|---|---|---|---|---|
| / | 217 | 2784 | 4532 | 0.000 | 219 (14) | 482 | - | - | 0 | - |
| /fiyatlar | 243 | 4848 | 6596 | 0.000 | 260 (16) | 526 | - | - | 0 | - |
| /giris | 227 | 3352 | 3352 | 0.000 | 234 (16) | 521 | - | - | 0 | - |
| /vitrin/demo-ofis | 211 | 2716 | 4056 | 0.000 | 193 (15) | 419 | - | - | 0 | - |
| /app | 216 | 2640 | 4980 | 0.000 | 481 (23) | 709 | - | - | 0 | - |
| /app/brifing | 202 | 2704 | 3448 | 0.000 | 474 (22) | 712 | 3021 | - | -Infinity | 21.3 |
| /app/musteriler | 204 | 2648 | 6008 | 0.000 | 496 (24) | 725 | 855 | - | -Infinity | 12.3 |
| /app/talepler | 2443 | 5188 | 6564 | 0.000 | 486 (23) | 711 | 1115 | - | -Infinity | 15.3 |
| /app/eslestirme | 219 | 6536 | 8092 | 0.000 | 475 (23) | 698 | 355 | - | -Infinity | 1.0 |
| /app/portfoyler | 213 | 2472 | 3212 | 0.000 | 501 (24) | 738 | 629 | - | -Infinity | 0.0 |
| /app/kiralama | 210 | 2656 | 4952 | 0.000 | 489 (24) | 720 | 2907 | - | -Infinity | 32.3 |
| /app/anlasmalar | 204 | 2736 | 4220 | 0.000 | 499 (24) | 727 | - | - | 0 | - |
| /app/teklifler | 223 | 6228 | 6800 | 0.000 | 486 (23) | 731 | - | - | 0 | - |
| /app/sozlesmeler | 225 | 3216 | 5836 | 0.000 | 486 (23) | 714 | - | - | 0 | - |
| /app/gelen-kutusu | 1379 | 3996 | 7944 | 0.000 | 486 (23) | 714 | - | - | 0 | - |
| /app/randevular | 212 | 6392 | 10220 | 0.000 | 503 (25) | 753 | 66 | - | -Infinity | 0.0 |
| /app/gorevler | 2126 | 4572 | 6944 | 0.000 | 491 (23) | 717 | 49 | - | -Infinity | 0.0 |
| /app/kampanyalar | 217 | 2960 | 4372 | 0.000 | 484 (24) | 710 | - | - | 0 | - |
| /app/komisyon | 224 | 3580 | 4412 | 0.000 | 492 (24) | 715 | - | - | 0 | - |
| /app/giderler | 208 | 2660 | 3924 | 0.000 | 597 (27) | 822 | - | - | 0 | - |
| /app/raporlar | 268 | 2592 | 6160 | 0.000 | 477 (23) | 707 | - | - | 0 | - |
| /app/kayip-kacak | 197 | 2696 | 3360 | 0.008 | 477 (23) | 706 | - | - | 0 | - |
| /app/degerleme | 205 | 2788 | 4392 | 0.000 | 480 (23) | 717 | - | - | 0 | - |
| /app/ekip | 195 | 2684 | 4336 | 0.000 | 308 (23) | 537 | - | - | 0 | - |
| /app/hedefler | 202 | 2684 | 4220 | 0.000 | 481 (23) | 707 | - | - | 0 | - |
| /app/otomasyonlar | 204 | 2604 | 3380 | 0.000 | 477 (23) | 718 | - | - | 0 | - |
| /app/asistan | 206 | 2688 | 3916 | 0.000 | 484 (23) | 719 | - | - | 0 | - |
| /app/ayarlar | 215 | 2644 | 4244 | 0.000 | 560 (24) | 784 | - | - | 0 | - |
| /app/abonelik | 200 | 2716 | 3976 | 0.000 | 475 (23) | 711 | - | - | 0 | - |

En yavas 8 (LCP): /app/randevular 10220, /app/eslestirme 8092, /app/gelen-kutusu 7944, /app/gorevler 6944, /app/teklifler 6800, /fiyatlar 6596, /app/talepler 6564, /app/raporlar 6160
En yavas 8 (gecis ilk): /app/brifing 3021, /app/kiralama 2907, /app/talepler 1115, /app/musteriler 855, /app/portfoyler 629, /app/eslestirme 355, /app/randevular 66, /app/gorevler 49
Konsol hatalari: [["/app/kampanyalar",["PAGEERROR InvalidStateError: Transition was aborted because of invalid state"]]]
Server-Timing ornek: []
En buyuk kaynaklar: /_next/static/immutable/chunks/172xlm58_yl7p.js 241KB; /_next/static/immutable/chunks/39027wy-j6nsu.js 98KB; /_next/static/immutable/media/1bffadaabf893a1e.p.0szrwpqb9mkwe.woff2 84KB; /_next/static/immutable/chunks/10fvnfgpy5jkv.js 73KB; /_next/static/immutable/chunks/02fbm2lkgv8-6.js 67KB; /_next/static/immutable/media/83afe278b6a6bb3c.p.45535valc9rzk.woff2 48KB; /_next/static/immutable/chunks/1bhx2yk-npjqp.css 40KB; /_next/static/immutable/chunks/3fa_rg-qetabj.js 35KB; /_next/static/immutable/chunks/3lncucumbzw23.js 31KB; /_next/static/immutable/chunks/0mfozg645hddt.js 29KB

