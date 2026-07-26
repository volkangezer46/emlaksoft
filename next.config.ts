import type { NextConfig } from "next";

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
    // React <ViewTransition> entegrasyonu (docs: 01-next-config-js/viewTransition.md).
    // Navigasyonlarda tarayıcının View Transitions API'si devreye girer;
    // desteklemeyen tarayıcıda hiçbir şey değişmez (progressive enhancement).
    viewTransition: true,
    // Barrel-import maliyetini düşür: yalnızca kullanılan alt modüller derlenir.
    // Buradaki her paket gerçekten kurulu olmalı — aksi halde satır ölü kalır.
    optimizePackageImports: [
      "lucide-react",
      "date-fns",
      "recharts",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-select",
      "@radix-ui/react-tabs",
      "@radix-ui/react-tooltip",
    ],
  },

  async headers() {
    return [
      // Güvenlik başlıkları — tüm yollar
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
      // Statik varlıklar — uzun cache
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
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
