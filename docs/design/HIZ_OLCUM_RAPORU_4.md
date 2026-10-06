# Hız Ölçüm Raporu 4 (hız turu 2: kabuk + ana ekran) — build ölçümü

Tarih: 2026-10-06. Kapsam: `docs/HAFIZA.md` §20. Bu rapor YALNIZ build çıktısını ölçer; canlı/tarayıcı ölçümü (LCP/FCP/TTFB)
ve gerçek veritabanı süresi bu turda ÖLÇÜLMEDİ (PB42 migration'ları canlıda değil, izole DB yok).

## Yöntem

- Build: `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy ALLOW_PLATFORM_DEMO=0 ENABLE_DEMO_LOGIN=0 EMLAKSOFT_ENV=preview npm run build` (Next 16.3.8, Turbopack). İkisi de `BUILD_EXIT=0`; sahte env kaynaklı "Supabase admin env eksik" prerender uyarıları iki build'de de var (taban 384, dal 356 satır).
- Taban: `main` @ `768c7efa`. Dal: `worktree-agent-a41f7eb4462207972` @ `d3e6485a` (main 768c7efa birleştirilmiş hâli; fark yalnız bu turun işi).
- "First Load JS": `.next/server/app/<rota>_client-reference-manifest.js` içindeki `entryJSFiles` (kök layout + segment layout/error/template + sayfa girişleri) benzersiz parça kümesinin HAM bayt toplamı (sıkıştırmasız). `.next/static/chunks` toplamı: tüm `.js` dosyaları, ham bayt.
- Betik repoda değil (scratchpad `measure.cjs`).

## Sonuç tablosu

| Ölçü | main 768c7efa | dal d3e6485a | Fark |
|---|---|---|---|
| `.next/static/chunks` toplamı | 9.034.459 B (320 dosya) | 9.050.695 B (323 dosya) | +16.236 B (+3 dosya: tembel parçalar ayrıldı) |
| /app First Load JS | 337.954 B | 338.146 B | +192 B |
| /app/portfoyler First Load JS | 417.716 B | 417.278 B | −438 B |
| /app/anlasmalar First Load JS | 362.494 B | 362.056 B | −438 B |
| /app/musteriler First Load JS | 411.499 B | 411.061 B | −438 B |
| /app/belgeler First Load JS | 332.128 B | 329.188 B | −2.940 B (belge önizleme lightbox'ı ayrı parça) |
| /admin/danisman First Load JS | 327.251 B | 314.955 B | −12.296 B (sohbet `next/dynamic`, ssr:false) |
| /admin/marka First Load JS | 322.764 B | 314.984 B | −7.780 B (marka yöneticisi `next/dynamic`) |
| `/app/layout` girişi | 270.862 B | 270.424 B | −438 B (AppPrefetcher + use-app-api kaldırıldı; SectionTabsPlaceholder eklendi) |

Not: toplam chunk boyutu artar çünkü tembel parçalar ayrı dosyalara bölünür; ilk yüklemede inen JS düşer. /app'teki +192 B,
`DeferredSection` istemci bileşenidir. İstemci JS'i bu turun ana hedefi değildi; algılanan açılış süresinin ana kaynağı sunucu
tarafındaki bekleme zinciriydi (aşağıda).

## Sunucu tarafı (kod okumasıyla sayıldı, ÖLÇÜLMEDİ)

| Yol | Önce | Sonra |
|---|---|---|
| Sayfa içeriği ile kabuk | Tek `<Suspense fallback={RouteSplash}>` içinde: sayfa render'ı kabuk verisi bitince BAŞLIYORDU | Çerçeve + iskeletler ilk baytta; kabuk dilimleri ayrı Suspense; sayfa paralel akar (`loading.tsx` her segmentte) |
| Kabuk verisi (RPC uygulandıktan sonra) | getUser → [profil+tenant, platform_staff] → [rol override, kullanıcı istisnası, ofis skoru, 3 kullanım sayımı, modüller] → [2 rozet sayımı] | getUser → [`app_shell_bootstrap`, platform_staff] (ofis skoru ayrı sınırda, kabuğu bekletmez) |
| Kabuk verisi (RPC YOKKEN, bugünkü canlı) | yukarıdaki gibi | aynı sorgular; profil+tenant istek-içi TEK okuma, sayfa kapısı/requireActiveTenant/hoş geldin/örnek veri bunu paylaşır |
| Ana ekran blok öncesi | searchParams → kapı → hoş geldin → kapalı modüller → kullanıcı → örnek veri kapsamı (4-5 seri tur) | [searchParams + kapı] → [hoş geldin, modüller, örnek veri, kullanıcı] (2 tur) |
| Ana ekran blokları (RPC uygulandıktan sonra) | ~30 küçük PostgREST isteği (sayaçlar, görevler, karar, dönem, içgörü) | 3 RPC (içgörü/metrik/görev) + kalan blok sorguları |
| Boşta arka plan isteği | Her gezintide `/api/app/bootstrap` (~10 sorgu; sonucu okuyan yoktu) | Kaldırıldı |

Gerçek süreyi ölçmek için: Vercel'de `EMLAKSOFT_SERVER_TIMING=1` → loglarda `[server-timing] app-shell;dur=…`,
`app-shell-rpc`, `home-gate`, `home-ctx`, `home-snapshot` satırları. Önce/sonra karşılaştırması PB42 uygulanmadan ve uygulandıktan
sonra aynı ofisle yapılmalı.

## Ölçülmeyenler

- Canlı LCP/FCP/TTFB/CLS (Playwright turu yapılmadı). Kabuk iskeleti ile gerçek kabuk arasında olası kayma: demo/deneme şeridi üst
  çubukla aynı dilimde geldiğinden şeritli ofiste içerik bir kez aşağı itilebilir (ölçülmedi).
- RPC'lerin gerçek DB'de çalışma süresi ve plan maliyeti (`EXPLAIN` yapılmadı).
