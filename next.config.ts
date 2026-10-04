import type { NextConfig } from "next";
import { assertProductionEnvironment } from "./src/lib/deployment-env";

// Config is loaded by both `next build` and `next start`; fail before the app
// can be built or served with any production demo escape hatch enabled.
assertProductionEnvironment(process.env);

const isDevelopment = process.env.NODE_ENV === "development";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co https://api.qrserver.com https://tile.openstreetmap.org",
  "font-src 'self' data:",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.qrserver.com${isDevelopment ? " ws: wss:" : ""}`,
  "media-src 'self' data: blob: https://*.supabase.co",
  "frame-src 'self' https://www.openstreetmap.org",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
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
    staleTimes: { dynamic: 30 },
    // Barrel-import maliyetini düşür: yalnızca kullanılan alt modüller derlenir.
    // Buradaki her paket gerçekten kurulu olmalı — aksi halde satır ölü kalır.
    optimizePackageImports: [
      "lucide-react",
      "recharts",
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
