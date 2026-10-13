import type { NextConfig } from "next";
import { assertProductionEnvironment } from "./src/lib/deployment-env";
import { VIRTUAL_TOUR_FRAME_HOSTS } from "./src/lib/virtual-tour";

// Config is loaded by both `next build` and `next start`; fail before the app
// can be built or served with any production demo escape hatch enabled.
assertProductionEnvironment(process.env);

const isDevelopment = process.env.NODE_ENV === "development";
// Vercel dışı (Hetzner/Coolify) derleme: standalone Docker imajı, kendi Supabase alan adı.
const isVercel = Boolean(process.env.VERCEL);
// Self-hosted Supabase (ör. https://api.emlaksoft.com.tr); bulut *.supabase.co desenleri geçiş süresince kalır.
const supabaseOrigin = (() => {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return url.hostname.endsWith(".supabase.co") ? null : url;
  } catch {
    return null;
  }
})();
const supabaseHttp = supabaseOrigin ? ` ${supabaseOrigin.origin}` : "";
const supabaseWs = supabaseOrigin ? ` ${supabaseOrigin.origin.replace(/^http/, "ws")}` : "";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://*.supabase.co${supabaseHttp} https://api.qrserver.com https://tile.openstreetmap.org`,
  "font-src 'self' data:",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co${supabaseHttp}${supabaseWs} https://api.qrserver.com${isDevelopment ? " ws: wss:" : ""}`,
  `media-src 'self' data: blob: https://*.supabase.co${supabaseHttp}`,
  `frame-src 'self' https://www.openstreetmap.org ${VIRTUAL_TOUR_FRAME_HOSTS.map((h) => `https://${h}`).join(" ")}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  // Hetzner/Coolify: `node server.js` ile çalışan standalone çıktı (Vercel kendi çıktısını kullanır).
  output: isVercel ? undefined : "standalone",
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
  // Turbopack dev cache — yerel geliştirmede yeniden derlemeyi hızlandırır
  cacheMaxMemorySize: 0, // disk cache'e devret, RAM'i serbest bırak

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
  },

  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    remotePatterns: [
      // Supabase storage
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
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

  // /demo public sayfası kapatıldı: 308 ile kayıt akışına gider (satış demosu formu verisi /admin/satis'te kalır).
  async redirects() {
    // Eski, yalnız yönlendiren sayfalar (kalıcı). İstek sorgu parametreleri hedefe aynen taşınır (Next redirects);
    // hedef sayfa kendi modül/paket kapısını uygular.
    return [
      { source: "/demo", destination: "/kayit", permanent: true },
      { source: "/app/brifing", destination: "/app", permanent: true },
      { source: "/app/ekip/kazanc", destination: "/app/cuzdan?sekme=ofis", permanent: true },
      { source: "/app/ayarlar/duyurular", destination: "/app/bildirimler?sekme=yonetim", permanent: true },
      { source: "/app/arama", destination: "/app/gelen-kutusu?sekme=cagri", permanent: true },
      { source: "/app/eslestirme", destination: "/app/talepler?sekme=eslesme", permanent: true },
      { source: "/app/yatirim", destination: "/app/hesaplayici?sekme=yatirim", permanent: true },
      { source: "/admin/ef-kontor", destination: "/admin/analiz-tarifesi", permanent: true },
      { source: "/admin/ef-kontor/:path*", destination: "/admin/analiz-tarifesi/:path*", permanent: true },
      { source: "/admin/satis", destination: "/admin/tenants?durum=trial", permanent: true },
      { source: "/admin/satis/:path*", destination: "/admin/tenants?durum=trial", permanent: true },
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
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
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
