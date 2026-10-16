import type { NextConfig } from "next";
import { assertProductionEnvironment } from "./src/lib/deployment-env";
import { globalContentSecurityPolicy } from "./src/lib/security/global-csp";
import { STATIC_ROUTES } from "./src/lib/static-home/registry";
import { HTML_LIMITED_BOTS } from "./src/lib/seo/html-limited-bots";

// Config is loaded by both `next build` and `next start`; fail before the app
// can be built or served with any production demo escape hatch enabled.
assertProductionEnvironment(process.env);

const isDevelopment = process.env.NODE_ENV === "development";
// Vercel dışı (Hetzner/Coolify) derleme: standalone Docker imajı, kendi Supabase alan adı.
const isVercel = Boolean(process.env.VERCEL);
// Supabase kökü YALNIZ yapılandırılmış tek origin (görsel uzak deseni; CSP de aynı kökü src/lib/security/global-csp.ts'te kurar).
const supabaseOrigin = (() => {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
})();
// Küresel CSP tek kaynak: src/lib/security/global-csp.ts (statik sayfa yedeği ve proxy de aynısını kullanır).
const contentSecurityPolicy = globalContentSecurityPolicy({ isDevelopment, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL });
// Statik sunulan yollar (kayıt defteri: ana sayfa + yasal sayfalar) küresel CSP'yi ALMAZ: Next aynı adlı başlıkta config
// değerini korur, rota değerini eklemez; katı hash politikasını rota verir (src/lib/static-home/csp.ts). Kök "/" bu
// desene hiç uymaz; tek parçalı statik yollar negatif bakışla dışarıda, alt yolları içeride.
const STATIC_CSP_EXEMPT = STATIC_ROUTES.filter((r) => r.path !== "/" && !r.disabled).map((r) => r.path.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const CSP_SOURCE = `/:first((?!(?:${STATIC_CSP_EXEMPT.join("|")})$)[^/]+)/:rest*`;

// Fiş okuma motorunun çalışma anı dosyaları (src/lib/finance/receipt/engine/*). Tesseract çekirdeğinden Node'un okuduğu
// .js + .wasm çiftleri (tarayıcı için base64 .wasm.js kopyaları alınmaz; tesseract.js 7 OEM bayrağını boolean geçirdiği için
// LSTM'siz derlemeyi yükler, iki aile de dahil) ve Türkçe "best_int" modeli alınır.
const RECEIPT_READER_TRACE = [
  "./node_modules/unpdf/**",
  "./node_modules/jsqr/**",
  "./node_modules/tesseract.js/**",
  "./node_modules/tesseract.js-core/package.json",
  "./node_modules/tesseract.js-core/index.js",
  ...["", "-simd", "-relaxedsimd"].flatMap((v) => ["", "-lstm"].flatMap((l) => [".js", ".wasm"].map((ext) => `./node_modules/tesseract.js-core/tesseract-core${v}${l}${ext}`))),
  "./node_modules/@tesseract.js-data/tur/package.json",
  "./node_modules/@tesseract.js-data/tur/4.0.0_best_int/**",
  "./node_modules/regenerator-runtime/**",
  "./node_modules/is-url/**",
  "./node_modules/wasm-feature-detect/**",
  "./node_modules/bmp-js/**",
  "./node_modules/zlibjs/**",
  "./node_modules/idb-keyval/**",
  "./node_modules/node-fetch/**",
  "./node_modules/whatwg-url/**",
  "./node_modules/tr46/**",
  "./node_modules/webidl-conversions/**",
];

const nextConfig: NextConfig = {
  // Hetzner/Coolify: `node server.js` ile çalışan standalone çıktı (Vercel kendi çıktısını kullanır).
  output: isVercel ? undefined : "standalone",
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
  // Akışlı metadata: insanlar için açık kalır (loading.tsx açılış ekranı + hızlı TTFB); Next'in varsayılan bot listesi +
  // Googlebot ise <title>/description/canonical/robots'u bloklayarak <head> içinde alır (src/lib/seo/html-limited-bots.ts).
  htmlLimitedBots: HTML_LIMITED_BOTS,
  // SK1/B050: sunucu içi önbellek (ISR/fetch/RSC yükleri) 64 MB bellekte; 0 iken her isabet diskten okunuyordu.
  // Konteyner sınırı 2 GB (deploy/compose.prod.yml), V8 yığını 1,5 GB: 64 MB bu bütçenin içinde.
  cacheMaxMemorySize: 64 * 1024 * 1024,

  turbopack: {
    // Workspace kökünü açıkça sabitliyoruz. Otomatik tespit lockfile arayarak
    // yukarı yürüyor; bu makinede C:\Users\Laptop altında .pnpm/.pnpm-state
    // işaretçileri var, tespit belirsiz. __dirname burada mutlak yol döndüğü
    // doğrulandı (Next config CJS olarak yükleniyor).
    root: __dirname,
  },

  // Uygulama kodu sharp kullanmıyor (filigran istemcide); Vercel görseli kendi altyapısında optimize eder.
  // Her sunucu fonksiyonunun izine giren sharp + @img ikilileri paketi şişirip soğuk başlangıcı uzatıyordu.
  // Kendi sunucumuzda next/image optimizasyonu sharp'a ihtiyaç duyar → hariç tutma yalnız Vercel'de.
  outputFileTracingExcludes: isVercel ? { "/*": ["node_modules/sharp/**", "node_modules/@img/**"] } : {},
  // Tarayıcı eklentisi paketi (build sırasında public/downloads'a yazılır) ve rapor merkezi PDF yazı tipi
  // (src/assets/fonts) çalışma anında fs ile okunur; izleme dosyaları kendiliğinden bulamaz.
  outputFileTracingIncludes: {
    "/api/app/ilan-kontrol/eklenti.zip": ["./public/downloads/**/*"],
    "/app/ilan-kontrol/eklenti": ["./public/downloads/**/*"],
    "/api/app/rapor/[id]": ["./src/assets/fonts/**"],
    "/api/admin/rapor/[id]": ["./src/assets/fonts/**"],
    // Fiş okuma: PDF/karekod yalıtılmış iş parçacığında ve Tesseract çalışma anında node_modules'tan yüklenir (paketleyici
    // izlemez). Türkçe OCR modeli pakette gelir; çalışma anında ağdan indirme YOK.
    "/api/app/finans/belge": RECEIPT_READER_TRACE,
    "/api/app/finans/belge/oku": RECEIPT_READER_TRACE,
  },

  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    remotePatterns: [
      // Supabase storage (yalnız yapılandırılmış origin; joker bulut deseni yok)
      ...(supabaseOrigin
        ? [
            {
              protocol: supabaseOrigin.protocol.replace(":", "") as "http" | "https",
              hostname: supabaseOrigin.hostname,
              pathname: "/storage/v1/object/public/**",
            },
          ]
        : []),
    ],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
  },

  experimental: {
    // Large customer/property files use signed direct-to-Storage uploads. The
    // remaining logo/profile-photo actions are capped at 2/3 MB; 4 MB leaves
    // multipart overhead without exposing every action to a 16 MB body.
    serverActions: { bodySizeLimit: "4mb" },
    // Next 16.3+: React <ViewTransition> yapılandırma gerektirmez (docs: 02-guides/view-transitions.md);
    // eski `experimental.viewTransition` seçeneği kaldırıldı.
    // Next 15+'ta dinamik sayfaların istemci router cache TTL'i varsayılan 0sn
    // (docs: 01-next-config-js/staleTimes.md) — /app ve /admin'in tamamı auth/cookie
    // gerektirdiği için "dinamik" sayılıyor, yani her tık (geri/ileri dahil) sunucuya
    // sıfırdan gidiyordu. 30sn içinde tekrar ziyaret edilen bir segment artık
    // önbellekten anında açılır (bu tamamen istemci tarafı, tek oturuma özel bellek
    // önbelleği — sunucudaki no-store Cache-Control başlıklarını etkilemez).
    // 300 sn (HIZ ANA İLKESİ): önbellekten ANINDA göster, arkadan tazele; güvenlik/tazelik: ClientCacheSync (arka plan router.refresh, kapı reddinde tam yükleme, kimlik/kapsam değişiminde temizlik) + realtime + mutasyon revalidate.
    staleTimes: { dynamic: 300, static: 300 },
    // Ana sayfa çoğu ziyaretçinin İLK sayfası: istemci JS'i birkaç dosyada birleştirilir (istek sayısı ↓,
    // Pingdom/YSlow "fewer HTTP requests"). Diğer rotalar varsayılan parçalamayla kalır (gezinmede önbellek paylaşımı).
    turbopackChunking: {
      priorityRoutes: [/^\/$/],
      priorityBoost: 20,
      requestCost: 2_000_000,
      minChunkSize: 400_000,
    },
    // Barrel-import maliyetini düşür: yalnızca kullanılan alt modüller derlenir.
    // Buradaki her paket gerçekten kurulu olmalı — aksi halde satır ölü kalır.
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "motion/react",
      "@dnd-kit/core",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-popover",
      "@radix-ui/react-select",
      "@radix-ui/react-tabs",
      "@radix-ui/react-tooltip",
    ],
  },

  // IndexNow anahtar dosyası kökte `/<32 hex>.txt` olmalıdır; route handler /api/indexnow-key/[key] altındadır.
  // Desen yalnız 32 haneli küçük hex + .txt eşleşir (robots.txt, llms.txt vb. etkilenmez); IndexNow kapalıysa 404.
  async rewrites() {
    return [{ source: "/:key([a-f0-9]{32}).txt", destination: "/api/indexnow-key/:key" }];
  },

  // /demo public sayfası kapatıldı: 308 ile kayıt akışına gider.
  async redirects() {
    // Yalnız herkese açık pazarlama adresi (/demo reklamlarda kullanılmış olabilir). Eski /app ve /admin
    // takma adları kaldırıldı — iz bırakılmaz.
    return [
      { source: "/demo", destination: "/kayit", permanent: true },
    ];
  },

  async headers() {
    return [
      // The worker is security-sensitive executable code. Every check must hit
      // the origin so an old controller cannot survive behind a browser/CDN cache.
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
          { key: "CDN-Cache-Control", value: "no-store" },
          { key: "Vercel-CDN-Cache-Control", value: "no-store" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      // Güvenlik başlıkları — tüm yollar
      {
        source: CSP_SOURCE,
        headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          // HTTPS zorunlu — 2 yıl, alt alan adları dahil (prod'da HTTPS varsayımı)
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          // Gereksiz güçlü API'leri kapat
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()" },
        ],
      },
      // The catch-all policy above also matches the worker. Re-apply a narrower
      // executable-resource policy last so inline page allowances never reach it.
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'; object-src 'none'",
          },
        ],
      },
      // public/ statik dosyaları (adları içerik özeti taşımaz): 30 gün önbellek + 1 gün arka planda tazeleme. 30 gün,
      // Lighthouse "Verimli önbellek süreleri" eşiği (altı uyarı). Özel marka yüklemesi kendi adresiyle gelir (brandAssetUrl),
      // varsayılan dosyalar yalnız yayınla değişir. sw.js, manifest ve offline.html bu desenlere girmez (kendi kurallarında).
      ...["/brand/:file*", "/:file([a-z0-9-]+\\.(?:svg|png|webp|ico))"].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "public, max-age=2592000, stale-while-revalidate=86400" }],
      })),
      // Statik ana sayfa adacıkları: içerik özetli adlar → kalıcı önbellek (runtime.js satır içi gömülür).
      {
        source: "/statik/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      // API route'ları — cache yok
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate",
          },
        ],
      },
      // App & admin sayfaları — kimlik doğrulama gerektiren, cache yok
      {
        source: "/(app|admin)/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-cache, no-store, must-revalidate",
          },
        ],
      },
      // Taslak önizlemesi (imzalı belirteçli): önbelleğe alınmaz, dizine eklenmez (robots.txt'e değil başlığa dayanır).
      {
        source: "/onizleme/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, no-store, must-revalidate" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      // Public statik sayfalar — SWR
      {
        source: "/(gizlilik|kullanim-sartlari)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
