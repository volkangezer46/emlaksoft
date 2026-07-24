import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Manrope } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/app/sw-register";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
  preload: true,
  fallback: ["system-ui", "sans-serif"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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

const SITE_NAME = "EmlakSoft";
const SITE_TITLE = "EmlakSoft — Türkiye’nin emlak işletim sistemi";
const SITE_DESC =
  "Müşteriden tapuya, ilandan komisyona kadar emlak ofisinizi tek platformda yönetin. İYS/EİDS uyumlu, yapay zeka destekli emlak CRM.";

export const metadata: Metadata = {
  title: {
    default: SITE_TITLE,
    template: "%s | EmlakSoft",
  },
  description: SITE_DESC,
  applicationName: SITE_NAME,
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  ),
  manifest: "/manifest.webmanifest",
  keywords: [
    "emlak CRM", "emlak yazılımı", "emlak ofis yönetimi", "portföy yönetimi",
    "İYS uyum", "EİDS", "emlak komisyon", "gayrimenkul CRM", "emlak danışmanı yazılımı",
    "sahibinden entegrasyon", "hepsiemlak", "kira artış hesaplama",
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

export const viewport: Viewport = {
  themeColor: "#071a38",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      data-scroll-behavior="smooth"
      className={`${manrope.variable} ${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-[family-name:var(--font-inter)]">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
