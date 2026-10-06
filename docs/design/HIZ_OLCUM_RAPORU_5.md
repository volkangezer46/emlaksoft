# Hız Ölçüm Raporu 5 (hız turu 3: Cache Components değerlendirmesi, istemci paketi, kabuk panelleri)

Tarih: 2026-10-07. Kapsam: `docs/HAFIZA.md` §27. Taban: `main` @ `905122e0`. Dal: bu turun commit'leri (`76d8750e`, `5ccce8c8`, `0b14b2e0`).
Canlıya (Vercel) dokunulmadı; tüm süreler YEREL `next start` ile ölçüldü. Uydurma sayı yok: ölçülmeyen her şey "ölçülmedi" ya da VARSAYIM diye işaretli.

## 1. Cache Components (`cacheComponents` / `use cache` / `partialPrefetching`): DEĞERLENDİRİLDİ, AÇILMADI

Okunan belgeler (Next 16.3.8, `node_modules/next/dist/docs`): `cacheComponents.md`, `partialPrefetching.md`, `migrating-to-cache-components.md`,
`authentication-with-cache-components.md`, `instant-navigation.md`, `01-directives/use-cache*.md`.

| Kanıt | Sonuç |
|---|---|
| Bayrak açık deneme build'i (`cacheComponents: true`, başka değişiklik yok) | `BUILD_EXIT=1`: 75 uyumsuz segment ayarı — `dynamic` 58, `revalidate` 9, `runtime` 7, `dynamicParams` 1 ("Please remove it"). İlk 75 hata yalnız bunlar; prerender hataları bunlar kalkmadan görünmüyor. |
| Bu 58 `force-dynamic`'in kaldırılması | Token'lı portallar (`/imza`, `/evrak`, `/odeme-link`, `/malik-portali`...), dosya indirme, webhook ve cron route'larında savunma katmanı. Toplu kaldırma denemesi izin sınıflandırıcısınca **güvenlik zayıflatma** olarak reddedildi → SAHİP KARARI. |
| Public sayfalar bugün | Build çıktısı: `/`, `/fiyatlar`, yasal sayfalar, `/araclar/*` zaten **statik ISR** (`○`/`●`, yenileme 1 dk, son kullanma 1 yıl). İçerik/menü/plan/SEO/marka yazımları zaten `updateTag(...)` çağırıyor (`site-content.ts`, `site-menu.ts`, `platform-billing-plans.ts`, `seo-admin.ts`, `platform-brand.ts`). `"use cache"` burada ek kazanç getirmez. |
| `unstable_cache` → `"use cache"` taşıma | Belge (`use-cache.md` "Runtime caching considerations", `use-cache-remote.md`): serverless'ta varsayılan `"use cache"` bellek içidir, girdiler istekler/örnekler arasında **kalıcı değildir**; `unstable_cache` örnekler ve dağıtımlar arası kalıcıdır. 23 dosyanın taşınması Vercel'de isabet oranını düşürür (daha çok DB turu = regresyon). `"use cache: remote"` platform ücreti + ağ turu ister. Taşınmadı; anahtarlar aynen duruyor. |
| Gezinmede `<Activity>` ile durum koruma | Bayrak açılınca TÜM gezintilerde önceki rota gizlenir, unmount edilmez (form değerleri, açık diyaloglar, `useActionState` sonuçları geri dönüşte kalır). Oturumlu E2E izole DB olmadan doğrulanamaz. |
| `partialPrefetching` / anında iskelet | `cacheComponents` olmadan config doğrulaması hata verir. /app'te bugün: her segmentte `loading.tsx` + çerçeve veriyi beklemez (§20) → tıkta iskelet zaten anında. Ek kazanç yalnız Vercel'de statik kabuğun CDN'den gelmesi (VARSAYIM, yerelde ölçülemez). |

**Güvenli geçiş planı (sahip onayıyla, ayrı dal, adım adım):**
1. Route handler'lar (`/api/**`, `/p/[code]`, `/r/[code]`, `robots.ts`, OG görselleri): `force-dynamic` yerine handler başında `await connection()`
   (aynı "her istekte çalış" garantisi, Cache Components uyumlu); `runtime = "nodejs"` satırları silinir (varsayılan zaten Node). Sözleşme testi:
   "her `/api` handler'ı `connection()` ya da istek verisi okur" (yeni sözleşme; bugünkü `force-dynamic` testlerinin yerine).
2. Token'lı portal sayfaları: `force-dynamic` yerine `params`/`searchParams` okuması `<Suspense>` içinde (zaten istek verisi → dinamik); `revalidate = 60`
   olan vitrin/danışman sayfaları `"use cache"` + `cacheLife("minutes")` + `cacheTag("vitrin:<tenantId>")` (anahtar tenant içerir; is_sample süzgeci korunur).
3. `araclar/[slug]` `dynamicParams = false` → bilinmeyen slug'da `notFound()`.
4. `/app` ve `/admin`: kabuk zaten Suspense'li; sayfa segmentlerinde `loading.tsx` sınır sayılır. Senkron `now()` kullanan sunucu bileşenleri prerender'da
   hata verir → `connection()` ya da istek verisinden SONRA çağrı. Başlangıçta `export const instant = false` (belgedeki artımlı yol) ile build yeşile alınır.
5. `<Activity>` davranışı: açılır menü/diyalog/form sıfırlama denetimi (belge `preserving-ui-state.md`), oturumlu E2E izole DB'de.
6. En son `partialPrefetching: true`; `unstable_cache` taşınmaz (kalıcılık), yalnız yeni önbellekler `"use cache"` ile yazılır.
7. Kabul ölçütü: Vercel önizlemesinde aynı Playwright betiğiyle TTFB/LCP önce/sonra; regresyon varsa geri al (tek bayrak).

**Tenant izolasyonu (bayraktan bağımsız, bugün yürürlükte):** `src/lib/cache-isolation-contract.test.ts` — `"use cache"`/`"use cache: remote"`
direktifli dosyada oturum/istek okuması (createClient, cookies, headers, getRequestUser, requireModulePage...) yasak; 23 `unstable_cache` dosyası
kayıtta `platform` (çağrı metninde oturum/tenant okuması yok) ya da `tenant` (anahtarda/argümanda `tenantId`/`tenant.id`) olarak sınıflı, yeni kullanım
kayda girmeden test kırılır. Denetimde sızıntı BULUNMADI: tenant verisi taşıyan 5 önbellek (vitrin listesi, EF rozeti, tanımlar, ofis skoru, rapor toplamları)
anahtarında ofis kimliği var; rapor toplamı RPC'si ofis geneli sonuç verir (kullanıcıya göre değişmez; sayfa kapısı `reports:view`).

## 2. Ölçüm yöntemi

- Build: `npm run build` (Next 16.3.8, Turbopack). Paket ölçümü sahte env ile (görev kapısındaki env), süre ölçümü ayrı build ile: `NEXT_PUBLIC_*` ana deponun
  `.env.local`'ından (yerel makine → Supabase projesi), `EMLAKSOFT_ENV=preview`, `ENABLE_DEMO_LOGIN=0`, `EMLAKSOFT_SERVER_TIMING=1`, `next start -p 3100`.
- Oturum: demo ofis "Ofis sahibi" (`sahip@demo.emlaksoft.test`), normal giriş formuyla (parola demo türetimiyle yerelde hesaplandı; demo hazırlama action'ı
  ÇAĞRILMADI, yani kullanıcı/profil yazımı yok; tek yazım normal oturum açma).
- Playwright (Chromium): masaüstü 1440x900 kısıtsız; mobil 390x844 DPR3, 4x CPU, ağ 150 ms / 1.6 Mbps / 750 Kbps. Her ölçüm yeni bağlam (soğuk önbellek,
  `Network.setCacheDisabled`), 1 ısınma + n=5, medyan. TTFB = `responseStart - startTime`, LCP/CLS PerformanceObserver.
- Sınır: localhost'ta CDP ağ gecikmesi belge TTFB'sine yansımadı (mobil TTFB değerleri ağ kısıtını içermez); FCP/LCP CPU kısıtını içerir.
- Betikler repoda değil (scratchpad `hiz5/`: `perf.mjs`, `probe-panels.mjs`, `probe-ayarlar.mjs`, `measure.cjs`, `allroutes.cjs`).

## 3. First Load JS (rota girişleri + kök çalışma zamanı; brotli q11 / ham)

Sahte env'li iki build (taban kod / dal kodu), aynı yöntem: `*_client-reference-manifest.js` `entryJSFiles` + `build-manifest.json` `rootMainFiles`.

| Rota | Brotli önce | Brotli sonra | Fark | Ham önce | Ham sonra |
|---|---|---|---|---|---|
| `/` | 155.575 | 155.575 | 0 | 580.078 | 580.078 |
| `/fiyatlar` | 159.304 | 159.304 | 0 | 590.143 | 590.143 |
| `/giris` | 145.277 | 145.277 | 0 | 546.593 | 546.593 |
| `/app` | 220.371 | 220.531 | +160 | 803.087 | 803.564 |
| `/app/musteriler` | 239.001 | 239.161 | +160 | 857.505 | 857.982 |
| **`/app/ayarlar`** | **285.343** | **230.056** | **−55.287 (−19,4%)** | **1.126.424** | **836.691 (−25,7%)** |
| `/admin` | 230.325 | 230.395 | +70 | 833.144 | 833.404 |

- Tüm 334 rota karşılaştırıldı: 18 rota ~289 KB ham düştü (zod parçası 283.465 B ham / 52.273 B brotli artık inmiyor): `/app/ayarlar` ve 17 form sayfası
  (`/app/{destek,ekip,kampanyalar,projeler,acik-ev,anlasmalar,gorevler,kiralama,onaylar,randevular,sozlesmeler,teklifler}/yeni`, `/app/portfoyler/sunumlar/yeni`,
  `/admin/{personel/yeni,tenants/yeni,duyuru,tickets/yeni}`). 1 KB'tan fazla büyüyen rota YOK; 193 rotada ±1 KB altı değişim (`/app` kabuğu +477 B ham: `lazyPanel`
  + iki bileşende boşta ön yükleme).
- Zod hâlâ 11 rotada (müşteri/talep/portföy formları talep şemasını gerçekten istemcide kullanıyor; admin şema editörleri) — bkz. §6.
- `.next/static/chunks` toplamı 340 → 343 dosya, +241.936 B: parça gruplaması yeniden dağıldı (32 parça çıktı, 35 girdi); hiçbir rotanın ilk yükü büyümedi.

## 4. Sayfa süreleri (yerel, n=5 medyan, ms)

| Sayfa | Profil | TTFB önce/sonra | FCP önce/sonra | LCP önce/sonra | CLS önce/sonra | JS aktarım (gzip) önce/sonra |
|---|---|---|---|---|---|---|
| `/` | masaüstü | 39 / 37 | 464 / 448 | 464 / 448 | 0,014 / 0,014 | 186.504 / 186.504 |
| `/fiyatlar` | masaüstü | 27 / 17 | 432 / 288 | 432 / 288 | 0,045 / 0,045 | 194.356 / 194.356 |
| `/giris` | masaüstü | 24 / 25 | 272 / 284 | 272 / 284 | 0,000 / 0,000 | 172.330 / 172.330 |
| `/app` | masaüstü | 190 / 207 | 812 / 824 | 1720 / 1664 | 0,064 / 0,062 | 256.621 / 256.798 |
| `/app/musteriler` | masaüstü | 187 / 191 | 536 / 536 | 1560 / 2144 | 0,037 / 0,036 | 277.321 / 277.498 |
| `/app/ayarlar` | masaüstü | 186 / 183 | 520 / 736 | 1452 / 1548 | 0,036 / 0,038 | **336.014 / 267.588** |
| `/` | mobil | 36 / 37 | 1440 / 1432 | 2132 / 1980 | 0,017 / 0,019 | 186.504 / 186.504 |
| `/fiyatlar` | mobil | 25 / 33 | 1188 / 1056 | 1892 / 1616 | 0,003 / 0,002 | 194.356 / 194.356 |
| `/giris` | mobil | 27 / 12 | 1140 / 1064 | 1460 / 1424 | 0,000 / 0,000 | 172.330 / 172.330 |
| `/app` | mobil | 194 / 230 | 1892 / 2340 | 3956 / 3884 | 0,072 / 0,032 | 256.621 / 256.798 |
| `/app/musteriler` | mobil | 299 / 366 | 1688 / 1440 | 5676 / 5492 | 0,033 / 0,033 | 277.321 / 277.498 |
| `/app/ayarlar` | mobil | 186 / 197 | 1828 / 1988 | 4124 / 4992 | 0,024 / 0,024 | **336.014 / 267.588** |

Okuma: kodu DEĞİŞMEYEN public sayfalarda da FCP/LCP ±150 ms (masaüstü) ve ±300 ms (mobil) oynuyor; uzak DB'li /app sayfalarında tekil turlar
masaüstü 1,4-2,5 sn, mobil 3,0-5,5 sn arası dağılıyor. n=5 ile LCP farkları **anlamlı değil**; bu tabloda tek anlamlı değişim JS aktarımı
(/app/ayarlar −68.426 B, −%20). /app TTFB tabanı ~190 ms = kabuk verisi (aşağıda) + render; bu turda değişmedi.

## 5. Hedefli ölçümler (değişikliğin kendisi)

**Kabuk paneli ilk tık** (masaüstü, /app/musteriler, sayfa yüklendikten 3 sn sonra; parça boşta zaten inmiş):

| Ölçüm | Kullanıcı menüsü önce → sonra | Bildirim zili önce → sonra |
|---|---|---|
| Sayfa içi (tık → `[role=menu]` / `[role=dialog]` DOM'da görünür), 3 tur | 483 / 541 / 498 → **52 / 50 / 75** | 445 / 551 / 464 → **30 / 15 / 13** |
| Playwright tık → görünür (araç yükü dahil), 3 tur | 1051 / 952 / 1052 → 449 / 309 / 310 | 1027 / 921 / 945 → 156 / 173 / 296 |

Kök neden: parça önceden inse de `React.lazy` ilk render'da bir kez askıya alınıyor; React 19 askıdan dönen içeriği ~300 ms'lik pencereye göre gösteriyor.
Komut paleti (Ctrl+K) ölçülemedi (betik `role=dialog` aradı, palet `listbox`); palete ve hızlı oluştur menüsüne bu turda boşta ön yükleme eklendi, sayısı yok.

**/app/ayarlar içerik süresi** (gezinme başlangıcı → `#marka-kimlik` DOM'da; masaüstü kısıtsız; 1 ısınma + n=10; yalnız sunucu kodu farklı iki build):

| | min | medyan | maks |
|---|---|---|---|
| Önce (il listesi, lisans, örnek veri, kurulum durumu sırayla) | 1158 | 1258,5 | 1526 |
| Sonra (tek `Promise.all`, lisans istek-içi tek okuma) | 828 | **908** | 1025 |

−350 ms (−%28); aralıklar çakışmıyor. İki ölçüm ~15 dk arayla alındı (aynı DB, aynı makine).

**Sunucu süre dağılımı** (`EMLAKSOFT_SERVER_TIMING=1`, yerel makine → Supabase; ms):

| Ölçü | n (önce/sonra) | p50 önce/sonra | p90 önce/sonra | maks önce/sonra |
|---|---|---|---|---|
| `app-shell` (kabuk modeli, tümü) | 44 / 56 | 201 / 210 | 326 / 292 | 514 / 467 |
| `app-shell-rpc` (`app_shell_bootstrap`) | 44 / 56 | 113 / 120 | 179 / 193 | 402 / 379 |
| `home-gate` | 14 / 15 | 204 / 213 | 331 / 310 | 512 / 343 |
| `home-ctx` | 14 / 15 | 134 / 162 | 259 / 278 | 325 / 312 |
| `home-snapshot` (3 RPC) | 14 / 15 | 219 / 212 | 399 / 333 | 438 / 528 |

Kabuk kodu bu turda değişmedi; dağılımlar aynı bant. `app-shell` p50'nin ~113 ms'i RPC, kalan ~90 ms ağırlıkla `auth.getUser()` ağ turu (bkz. §6 P2).
Canlı (Vercel bölgesi → Supabase) süreleri bu sayılardan FARKLIDIR; ölçülmedi.

## 6. Kararlar ve açık maddeler

| Madde | Kanıt | Karar |
|---|---|---|
| Cache Components + partialPrefetching | §1 | ERTELE — SAHİP KARARI (58 `force-dynamic` kaldırma onayı + oturumlu E2E) |
| 23 `unstable_cache` → `"use cache"` | §1 belge alıntısı (serverless kalıcılık) | REDDET (bu platformda regresyon); kayıt + izolasyon testi eklendi |
| /app/ayarlar sekmelere bölme | "~1,1 MB ham" = rota girişleri + kök çalışma zamanı (taban 1.126.424 B); bunun 283 KB'ı tek zod parçasıydı | Kök neden çözüldü (−25,7% ham). Sekmeye bölme ERTELE: `#marka-kimlik`/`#eslestirme-agirliklari` derin bağlantıları başka ajanın sayfalarında (abonelik, eşleştirme), UX değişikliği ister |
| `ICONS` sözlüğü kabukta | 89 kavramın 78'i kabukta (menü/palet) zaten kullanılıyor; kullanılmayan 11 ikon ≈ birkaç KB ham | REDDET (değer < tek kaynak ikon sözlüğünü bölme maliyeti) |
| Kabuk panelleri ilk tık (R3 P2) | §5 | YAPILDI (`lazyPanel`) |
| P2: kabukta `getUser()` yerine yerel JWT doğrulaması (`getClaims`) | `app-shell` p50 − RPC ≈ 90 ms | ERTELE — güvenlik incelemesi ister (proxy kimlik kapısıyla birlikte değerlendirilmeli) |
| P3: kalan 11 rotada istemci zod'u | §3 tarama | ERTELE — sahibi modül sayfaları (E2) / admin; `demand-criteria` istemci yardımcıları zod şemasından ayrılabilir |
| `/giris`, `/kayit` dinamik (`ƒ`) | build çıktısı | ERTELE — proxy bu yollarda zaten kimlik çözüyor; statik kabuk kazancı küçük |

## 7. Ölçülmeyenler

- Canlı (Vercel) TTFB/LCP/INP; bölge gecikmesi; soğuk başlatma.
- Mobil ağ kısıtının TTFB'ye etkisi (localhost'ta CDP gecikmesi belge zamanlamasına yansımadı).
- Komut paleti ilk açılış süresi; INP.
- `cacheComponents` açıkken prerender hataları (segment ayarları kaldırılamadığı için o aşamaya geçilmedi).
