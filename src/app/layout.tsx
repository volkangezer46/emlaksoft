import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/app/sw-register";
import { getBaseUrl } from "@/lib/base-url";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import { BrandProvider } from "@/components/brand/brand";
import { getBrandMeta } from "@/lib/brand/store";
import { brandIcons } from "@/lib/brand/icons";
import { buildRootMetadata } from "@/lib/seo/store";
import "./globals.css";

// Inter ve Manrope kendi sunucumuzdan (src/app/fonts + globals.css @font-face; Türkçe harfler küçük alt küme).
// Yalnız Geist Mono (kod/sayı; public sayfalarda yüklenmez) next/font ile gelir.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  fallback: ["monospace"],
});


// Başlık, açıklama, Open Graph, Twitter ve arama motoru doğrulama kodları /admin/seo "Genel" sekmesinden
// gelir (src/lib/seo/store.ts buildRootMetadata); ayar yokken değerler eskisiyle birebir aynıdır.
// Canonical kökte VERİLMEZ: her sayfa kendi canonical'ını buildMetadata ile taşır (aksi halde
// canonical'ı olmayan sayfalar ana sayfaya işaret ederdi).
const baseMetadata: Metadata = {
  metadataBase: new URL(getBaseUrl()),
  manifest: "/manifest.webmanifest",
  keywords: [
    "emlak CRM", "emlak yazılımı", "emlak ofis yönetimi", "portföy yönetimi",
    "İYS süreç yönetimi", "EİDS hazırlığı", "emlak komisyon", "gayrimenkul CRM", "emlak danışmanı yazılımı",
    "sahibinden ilan takibi", "hepsiemlak ilan takibi", "kira artış hesaplama",
  ],
  authors: [{ name: "EmlakSoft" }],
  creator: "EmlakSoft",
  publisher: "EmlakSoft",
  category: "business",
  formatDetection: { telephone: true, email: true, address: true },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  appleWebApp: {
    capable: true,
    title: "EmlakSoft",
    statusBarStyle: "black-translucent",
  },
};

/** Favicon/ana ekran simgesi süper admin ayarından gelir (/admin/marka); ayar yoksa varsayılan dosyalar. */
export async function generateMetadata(): Promise<Metadata> {
  const [brand, seoRoot] = await Promise.all([getBrandMeta(), buildRootMetadata()]);
  return { ...baseMetadata, ...seoRoot, icons: brandIcons(brand) };
}

export const viewport: Viewport = {
  themeColor: "#071a38",
  width: "device-width",
  initialScale: 1,
  // iOS: safe-area env() değerlerinin dolu gelmesi ve çentik/home-indicator
  // altındaki fixed menü/hamburger'ın doğru konumlanması için şart.
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const brandMeta = await getBrandMeta();
  return (
    <html
      lang="tr"
      suppressHydrationWarning
      className={`${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col font-[family-name:var(--font-inter)]">
        <a href="#main-content" className="skip-link">İçeriğe atla</a>
        <ServiceWorkerRegister />
        <BrandProvider meta={brandMeta}>{children}</BrandProvider>
      </body>
    </html>
  );
}
