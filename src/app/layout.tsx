import type { Metadata, Viewport } from "next";
import { Geist_Mono, Caveat, Inter, Manrope } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/app/sw-register";
import { getBaseUrl } from "@/lib/base-url";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import { BrandProvider } from "@/components/brand/brand";
import { getBrandMeta } from "@/lib/brand/store";
import { brandIcons } from "@/lib/brand/icons";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "latin-ext"],
  display: "swap",
  preload: true,
  fallback: ["system-ui", "sans-serif"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
  display: "swap",
  preload: true,
  fallback: ["system-ui", "sans-serif"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  fallback: ["monospace"],
});

// Yalnız ana sayfadaki el yazısı not için (marketing.css --font-hand); preload kapalı, kullanılmayan sayfalarda indirilmez.
const caveat = Caveat({
  variable: "--font-hand",
  weight: "600",
  subsets: ["latin", "latin-ext"],
  display: "swap",
  preload: false,
  fallback: ["Segoe Script", "cursive"],
});

const SITE_NAME = "EmlakSoft";
const SITE_TITLE = "EmlakSoft — Türkiye’nin emlak işletim sistemi";
const SITE_DESC =
  "Müşteriden tapuya, ilandan komisyona kadar emlak ofisinizi tek platformda yönetin. İYS/EİDS hazırlık süreçleri ve yapay zeka destekli emlak CRM.";

const baseMetadata: Metadata = {
  title: {
    default: SITE_TITLE,
    template: "%s | EmlakSoft",
  },
  description: SITE_DESC,
  applicationName: SITE_NAME,
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
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "tr_TR",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESC,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESC,
  },
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
  const brand = await getBrandMeta();
  return { ...baseMetadata, icons: brandIcons(brand) };
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
      data-scroll-behavior="smooth"
      className={`${manrope.variable} ${inter.variable} ${geistMono.variable} ${caveat.variable} h-full antialiased`}
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
