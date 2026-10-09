# Hız iskeleti pilotu: cacheComponents (statik kabuk / PPR) değerlendirmesi

Durum: UYGULANMADI (rapor). Tarih: 2026-10-09. Dal: worktree-agent-a6b0966e2e65a25ce.

## Bulgu 1: bayrak KÜRESELDİR

`cacheComponents: true` tek bir `next.config.ts` ayarıdır; sayfa bazlı açılamaz. Açıldığında TÜM rotalar (256 sayfa, 82 route handler)
yeni kurallara girer:

- PPR varsayılan olur; `dynamic` / `revalidate` / `dynamicParams` / `fetchCache` segment ayarları DERLEME HATASI verir.
- `runtime = "edge"` desteklenmez (projede yalnız `"nodejs"` var, sorun yok).
- Senkron `new Date()` / `Date.now()` / `Math.random()` prerender sırasında hata verir (`instant = false` bunu geçirmez).
- Suspense dışı `cookies()` / `headers()` / `searchParams` erişimi "blocking route" hatası/insight üretir.

"Tek sayfa pilotu" yalnız şu yolla olur: bayrak küresel açılır, diğer tüm rotalar `instant = false` ile doğrulamadan muaf tutulur
(docs: `01-app/02-guides/migrating-to-cache-components.md`, "Opting out of validation"; codemod `cache-components-instant-false`),
pilot sayfa dönüştürülür.

## Bulgu 2: ölçüm

`next build --webpack` bayrak açıkken denendi ("Cache Components enabled" göründü); derleme ilk aşamada şu hatayla durdu:
`Route segment config "dynamic" is not compatible with nextConfig.cacheComponents. Please remove it.`
(Turbopack bu worktree'de node_modules bağlantısı yüzünden çalışmadı; kod sorunu değil.)

Bu birinci hata sınıfının dosyaları (72 dosya: 62 `dynamic`, 9 `revalidate`, 1 `dynamicParams`):

- dynamicParams: `src/app/araclar/[slug]/page.tsx`
- revalidate: `danisman/[slug]/page.tsx`, `lead/[token]/page.tsx`, `robots.ts`, `vitrin/[slug]/page.tsx`, `vitrin/[slug]/[id]/page.tsx`,
  `vitrin/[slug]/degerleme/page.tsx`, `vitrin/[slug]/favoriler/page.tsx`, `vitrin/[slug]/opengraph-image.tsx`, `vitrin/[slug]/[id]/opengraph-image.tsx`
- dynamic (sayfalar): `[...slug]`, `acik-ev-kayit/[token]`, `admin/muhasebe`, `admin/muhasebe/defter`, `anket/[token]`, `app/ayarlar/filigran`,
  `app/ayarlar/lead`, `app/ayarlar/vitrin`, `app/gorevler`, `app/lig`, `bakim`, `degerleme-raporu/[token]`, `evrak/[token]`, `imza/[token]`,
  `lead/[token]`, `malik-portali/[token]`, `musteri-portali/[token]`, `odeme-link/[token]`, `paylas/[token]`, `randevu-al/[token]`,
  `randevu-teyit/[token]`, `sunum/[token]`, `tavsiye/[token]`
- dynamic (route handler, 39): `admin/ef-kontor/piyasa-verisi`, `api/admin/rapor/[id]`, `api/app/*` (ef-rapor pdf, ilan-kontrol eklenti/isci, sosyal-kart,
  rapor, tv-data), `api/cron/*` (12 rota), `api/customer-files`, `api/expense-receipts`, `api/export/kapanis`, `api/health` (+cron), `api/leads`,
  `api/property-media/*` (3), `api/ticket-attachments/*` (3), `api/v1/[resource]`, `api/vitrin-sohbet`, `api/webhooks/{meta,netgsm-sms}`,
  `imza/k/[kod]`, `p/[code]`, `r/[code]`

Ek: sayfa/layout'larda senkron `new Date()`/`Date.now()` kullanan 11 dosya var (üçüncü sınıf).

İkinci sınıf (Suspense dışı `cookies()` / `headers()` / `await searchParams`) bu 72 satır silinmeden görünmez. Kapıda (`requireModulePage`,
`getRequestUser`) cookie okuyan sayfa sayısı yüzlerce olabilir; kırılan rota sayısı OLÇÜLEMEDİ.
Bu oturumda 72 dosyaya toplu satır silme (sed) otomatik izin sistemi tarafından reddedildi ve kullanıcı izni olmadan sürdürülmedi.

## Neden uygulanmadı

1. Küresel bayrak: canlıyı yüzlerce rotada etkiler; `instant = false` codemod'lu kademeli geçiş gerekir (karar: uygulama, plan).
2. `revalidate` kaldırılırsa public vitrin sayfaları ISR'ini kaybeder; yerine `"use cache"` + `cacheLife` ile yeniden yazılmalı
   (yalnız kullanıcısız, slug'lı public veri; güvenli ama yeniden test gerekir).
3. Kazanç sınırlı: `/app` layout'u kabuğu (kenar çubuğu / üst çubuk / sekmeler) zaten ayrı Suspense sınırlarında akıtıyor ve dashboard blokları
   kendi Suspense'inde. Asıl gecikme `page.tsx` başında `await searchParams + requireModulePage + cookies()` kapısıdır (ilk Suspense'ten ÖNCE).
   Bu kapı Suspense içine alınıp sayfa gövdesi akışa verilirse (`instant` doğrulamasız bile) ilk bayt kazancı büyük ölçüde bayraksız elde edilir;
   PPR farkı yalnız önceden üretilmiş HTML (TTFB) kısmıdır. Kimlik doğrulamalı /app'te kabuğun CDN'den statik gelmesi
   `staleTimes.dynamic = 180` ile zaten kısmen karşılanıyor.

## Önerilen kademeli geçiş planı

0. (Bayraksız, düşük risk) Dashboard için: `requireModulePage` + `searchParams` + `cookies()` kapısını `<Suspense>` içindeki bir alt bileşene taşı;
   üst düzeyde yalnız sabit kabuk (AnaHero iskeleti, sekme şeridi, kart iskeletleri) kalsın. Ölç; kazanç yeterliyse bayrak gerekmez.
1. Bayrak + 72 segment ayarı kaldırımı TEK commit'te (bayrak kapalıyken `force-dynamic` silmek route handler'ları statikleştirebilir).
2. `npx @next/codemod@canary cache-components-instant-false ./src/app` ile tüm page/layout/default'a `instant = false`.
3. Senkron IO (11 dosya): `src/lib/clock.ts` + `connection()` / Suspense.
4. Public vitrin: `revalidate` yerine `"use cache"` + `cacheLife('minutes')` + `cacheTag`.
5. Pilot: `/app` sayfasından `instant = false` kaldır, kabuğu statik yap. KURAL: kullanıcı/tenant verisi `"use cache"` İÇİNE ALINMAZ;
   tüm tenant/kullanıcı okumaları Suspense içinde dinamik kalır.
6. Doğrulama: build, `check:links`, sözleşme testleri, canlı oturumlu hız ölçümü; sonra sayfa sayfa `instant = false` kaldır.
