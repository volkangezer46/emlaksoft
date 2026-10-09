# Hız mimarisi araştırması (2026-10-09)

Kapsam: altyapı + "anında açılma" teknikleri. A (sunucu render/stream), B (istemci gezinme/prefetch/loading), C (DB sorgu/indeks/RPC) kapsamları tekrarlanmadı, "A/B/C'ye ait" diye işaretlendi.
Yöntem notu: web araması yapılmadı; teknik tablosu bilinen yayınlanmış mimarilere ve bu sürümün (Next 16.3.8) yerel belgelerine dayanır. Ölçümler bu makineden (İstanbul) alındı, tek örneklem küçüktür.

## 1. Ölçülen değerler

| Ölçüm | Sonuç | Kanıt |
|---|---|---|
| Supabase proje ana makinesi | `vbtuexdbhvcetswdtzts.supabase.co` -> Cloudflare anycast (172.64.149.246, 104.18.38.10); yanıt `CF-RAY ...-IST`. Bölge DNS'ten çözülemez | nslookup, curl -I |
| Supabase bölgesi | eu-central-1 Frankfurt (belgede), Vercel fra1 ile aynı. Canlı doğrulanamadı (Cloudflare önünde) | docs/DECISIONS.md:7, docs/PRODUCT.md:36, vercel.json `regions:["fra1"]` |
| İstanbul -> Supabase auth/health (5 deneme) | bağlantı 68-200 ms, TLS sonrası ilk bayt 232-425 ms (toplam ort. ~330 ms). Bu, Vercel->Supabase süresi DEĞİL (o fra1 içi, birkaç ms beklenir) | curl -w |
| `/` canlı TTFB (4 deneme) | 0.49-1.46 s (ilk soğuk 1.46, sonra ~0.5-0.66); `X-Vercel-Cache: HIT`, `X-Nextjs-Prerender: 1`, ama `Cache-Control: public, max-age=0, must-revalidate` | curl |
| `/giris` canlı TTFB (4 deneme) | 0.41-0.56 s; `Cache-Control: private, no-store`, `X-Vercel-Cache: MISS` (her istek fonksiyona gider) | curl |
| HTML boyutu | `/`: 744 KB ham, 82 KB brotli; `/giris`: 50 KB ham, 10 KB brotli | curl |
| Statik varlıklar | `/_next/static/immutable/chunks/*.js`: `public,max-age=31536000,immutable`, brotli, `X-Vercel-Cache: HIT` (sağlam) | curl -I |
| `/app` oturumsuz | 307 -> `/giris?next=%2Fapp` (proxy karar veriyor) | curl -I |
| JWT imza anahtarı | JWKS `ES256` (asimetrik) yayında: yerel doğrulama (`getClaims`) mümkün | /auth/v1/.well-known/jwks.json |

Not: İstanbul'dan ~0.5 s TTFB'nin büyük kısmı ağ (TR -> fra1 gidiş-dönüş ~60-100 ms, TLS+TCP el sıkışma). Sunucu içi süreyi ancak `EMLAKSOFT_SERVER_TIMING=1` ile oturumlu ölçüm verir (bkz. HIZ_OLCUM_RAPORU_*).

## 2. Proxy (src/proxy.ts) her istekte ne yapıyor

- Matcher `/((?!api/|_next/|.*\..*).*)`: tüm sayfa isteklerini, RSC/prefetch isteklerini de kapsar (src/proxy.ts:9).
- Her /app, /admin, /giris, /kayit isteğinde (src/lib/supabase/middleware.ts:79) `auth.getUser()` = Supabase Auth sunucusuna AĞ turu. Ardından `readProxyGateData` (profil+personel+ofis tek RPC, middleware.ts:~117) + `getClaims()` yerel paralel. Yani oturumlu her gezinme proxy'de en az 2 ağ turu (auth + 1 RPC) yer, sonra sunucu bileşenleri `getClaims` ile yerel doğrular (auth-cache.ts:14-32: bu kısım zaten iyi).
- Bakım bayrağı 30 sn bellek önbellekli okunuyor (iyi).
- Sonuç: proxy tabanı ~2 x (Vercel fra1 -> Supabase) tur. Aynı bölgede 5-20 ms/tur ise önemsiz; farklı bölgeyse (doğrulanamadı) 2 x 100+ ms.

## 3. En hızlı sitelerin teknikleri -> bizde var mı

| Teknik (kim kullanıyor) | Bizde | Kanıt / not |
|---|---|---|
| Yerel-öncelikli/sync engine (Linear, Figma, Superhuman, Notion) | YOK | Veri sunucudan RSC ile geliyor. Büyük yatırım, kısa vadede değil |
| İstemci önbelleği + stale-while-revalidate (Vercel dashboard, GitHub) | KISMEN | `staleTimes.dynamic: 180` next.config.ts:~66; SWR/TanStack veri katmanı yok |
| İyimser UI (Linear, Superhuman) | Bilinmiyor (B/C'ye ait) | |
| Statik kabuk + PPR / cacheComponents (Vercel, Hydrogen) | YOK | `cacheComponents` next.config.ts'te yok; belge: 01-app/03-api-reference/05-config/01-next-config-js/cacheComponents.md (Next 16.3.8'de VAR). `use cache` yalnız 11 dosyada kelime olarak geçiyor, kabuk yok |
| Kısmi prefetch (yalnız statik kısım) | YOK | `partialPrefetching` belgesi var (aynı klasör), açılmamış; cacheComponents gerektirir |
| Edge/CDN HTML önbelleği (Hydrogen, McMaster) | KISMEN | `/` HIT ama `max-age=0 must-revalidate`; `/giris` no-store (dinamik, proxy'den geçiyor) |
| Hover/viewport prefetch | Next `Link` varsayılanı (B'ye ait) | |
| Speculation Rules API (McMaster tarzı prerender) | YOK | repo'da `speculationrules` yok. Public sayfalar için uygun; /app'te auth+yan etki riski |
| bfcache | Bilinmiyor | Geri/ileri hızı için `Cache-Control: no-store` bfcache'i engeller (Chrome yeni sürümlerde izin veriyor ama garanti değil); /giris, /app yanıtlarında `no-store` var. Ölçülmedi |
| HTTP önbellek başlıkları (statik) | VAR | immutable 1 yıl + brotli, doğrulandı |
| Servis çalışanı | VAR, ağ-öncelikli | public/sw.js:157-172 sayfa için network-first (hız kazandırmaz, yalnız çevrimdışı); statik cacheFirst |
| Bölge eş-konumlama | VAR (belgeye göre) | vercel.json regions fra1 + Supabase eu-central-1; canlı doğrulama gerek |
| Bağlantı havuzu | Bilinmiyor | Supabase JS REST/PostgREST (HTTP) kullanıyor, havuz gerekmez; Supavisor yalnız doğrudan pg araçlarında (`DATABASE_POOLER_URL`) |
| Okuma kopyaları | YOK | Tek bölgeli proje; ücretli, gerek görünmüyor |
| Fluid compute | VAR | vercel.json `fluid: true` (soğuk başlangıç azaltır) |
| Görsel optimizasyon, optimizePackageImports | VAR | next.config.ts images/experimental |

## 4. Öncelikli eylem listesi

Sıra: etki/risk/çaba.

1. Proxy'de `getUser()` yerine yerel `getClaims()` (ES256 zaten aktif). Etki YÜKSEK (her oturumlu gezinmeden 1 ağ turu gider), risk ORTA (iptal edilmiş oturum token süresi sonuna kadar geçer; ancak `readProxyGateData` her istekte profil `is_active`/askı/2FA'yı DB'den zaten kontrol ediyor, riski sınırlar), çaba DÜŞÜK-ORTA: src/lib/supabase/middleware.ts:79 ve `claimsMatchLiveUser` mantığı. Güvenlik gevşetmesi sayıldığı için KULLANICI KARARI bölümüne de yazıldı; önce `supabase.auth.getClaims()` ile oturum yenileme (refresh) davranışının bozulmadığı test edilmeli.
2. Proxy'de kapı RPC'sini kısa ömürlü (örn. 10-15 sn) kullanıcı bazlı bellek/edge önbelleğe al (`readProxyGateData`, src/lib/supabase/proxy-gates.ts:43). Etki YÜKSEK (ikinci tur gider), risk ORTA (askıya alma gecikmesi <=TTL; sunucu action'lar ve RLS zaten tekrar kontrol ediyor), çaba DÜŞÜK. Serverless örnekler arası paylaşılmaz; kazanç sıcak örnekte.
3. RSC/prefetch isteklerinde proxy maliyetini ölç: `next-router-prefetch` / `RSC` başlıklı isteklerde kapı sonuçları yeniden kullanılabilir mi. B ile koordinasyonlu; önce `EMLAKSOFT_SERVER_TIMING=1` ile proxy süresini (tAuth, tGates zaten ölçülüyor, middleware.ts:76,120) canlıda oku. Etki bilinmiyor -> ÖNCE ÖLÇ.
4. `cacheComponents` + `partialPrefetching` ile statik kabuk (yan menü/üst çubuk anında, veri akar). Etki ÇOK YÜKSEK (algılanan gezinme), risk YÜKSEK (tüm sayfalarda cookies()/headers() okuyan dinamik kısımların Suspense içine alınması gerekir; derlemeyi kırar), çaba YÜKSEK. Önce tek bir rota (örn. /app/musteriler) pilotu. Sunucu render tarafı A'ya, Link/prefetch tarafı B'ye ait; yalnız bayrak kararı burada.
5. Public sayfalarda (`/`, vitrin, SEO sayfaları) `Cache-Control: s-maxage` + `stale-while-revalidate` ile CDN'de gerçek önbellek (şu an `max-age=0, must-revalidate`; her istek Vercel'de doğrulanıyor, TTFB 0.5-0.65 s). Etki ORTA (public/SEO TTFB), risk DÜŞÜK, çaba DÜŞÜK: `export const revalidate` ya da `headers()` ile (next.config.ts headers). `/giris` no-store kalmalı.
6. Speculation Rules API (`<script type="speculationrules">`, `prefetch`/`prerender`, `eagerness: moderate`) yalnız public sayfa ve vitrin geçişleri için. Etki ORTA, risk DÜŞÜK (prerender yan etkili sayfalarda kapalı), çaba DÜŞÜK. /app'te kullanma (auth, yan etkili RSC). Chromium-dışı tarayıcıda yok sayılır.
7. bfcache uygunluğunu ölç (Chrome DevTools > Application > Back/forward cache) /app sayfalarında; `no-store` ve açık WebSocket/Realtime bağlantıları engelleyebilir (CSP `wss://*.supabase.co` Realtime kullanıldığını gösteriyor). Etki ORTA (geri tuşu anlık), risk DÜŞÜK, çaba ORTA. Önce ölç.
8. Servis çalışanı: `pageNetworkFirst` (public/sw.js:157) /app HTML'ini ağ-öncelikli getiriyor; hız kazancı yok. İstenirse yalnız public sayfa için stale-while-revalidate yap; /app'e DOKUNMA (güvenlik: eski yetki/oturum). Etki DÜŞÜK-ORTA, risk ORTA, çaba ORTA. Öncelik düşük.
9. Ana sayfa HTML'i 744 KB ham/82 KB br: satır içi RSC verisi büyük. `/` ilk yükleme için A'ya ait (render/stream) + LCP ölçümü HIZ_OLCUM_RAPORU'nda. A'ya ait.
10. Bölge doğrulaması: Vercel fonksiyonundan Supabase'e gerçek süreyi `Server-Timing` ile ölç (tAuth zaten var). tAuth > 60 ms çıkarsa bölgeler farklı demektir -> KULLANICI KARARI #1.
11. Sorgu/indeks/RPC, Suspense bölümleri, loading.tsx, prefetch ayarı: sırasıyla C, A, B'ye ait.

## 5. Kullanıcı kararı gerektirenler

1. Supabase bölgesi: DNS ile doğrulanamadı (Cloudflare). Dashboard > Project Settings > Infrastructure'dan bölgeyi doğrula. fra1 ile aynı değilse taşıma (yeni proje + veri/auth taşıma, kesinti, geri alınamaz risk) ya da Vercel `regions`ı Supabase bölgesine çekmek. Yalnızca bölgeler farklıysa gündeme gelir.
2. Proxy'de `getUser` -> `getClaims` (madde 1): iptal edilen oturumun, token süresi (varsayılan 1 saat) dolana dek geçerli kalması kabul edilebilir mi? Kapılar (is_active, askı) DB'den kontrol edilmeye devam eder; "çıkış yap/tüm oturumlar" gecikmeli etkili olur.
3. Kapı RPC önbelleği (madde 2): askıya alma/rol değişikliğinin TTL kadar gecikmesi kabul mü?
4. `cacheComponents` pilotu (madde 4): büyük yeniden yapılandırma; hangi rotada başlanacağı.
5. Ücretli/altyapı: Vercel Pro/Enterprise özellikleri (ör. daha fazla eşzamanlılık), Supabase okuma kopyası/bilgisayar boyutu yükseltmesi; şu an ölçüm bunları gerektirdiğini göstermiyor.
