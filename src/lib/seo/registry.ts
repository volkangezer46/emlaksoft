import { publishedTools } from "@/lib/tools/registry";
import type { ChangeFreq, JsonLdKind } from "./schema";

/**
 * Public SEO sayfa envanteri: yönetilebilir statik sayfaların TEK kaynağı.
 * Varsayılan değerler bu dosyaya taşınmadan önce sayfalardaki `metadata` ile BİREBİR aynıdır
 * (sözleşme testi: seo-metadata.test.ts). Admin ayarı (seo.pages) yalnız üzerine yazar.
 *
 * Token'lı/kişiye özel yüzeyler (portallar, imza, ödeme, anket, randevu, sunum, paylaş, /app, /admin)
 * BİLEREK burada YOKTUR: yönetilemez, sitemap'e giremez, her zaman noindex'tir.
 */
export type SeoPageGroup = "ana" | "arac" | "yasal" | "hesap";

export type SeoPageDef = {
  path: string;
  label: string;
  group: SeoPageGroup;
  /** null: kökteki varsayılan başlık (layout title.default) kullanılır. */
  title: string | null;
  description: string | null;
  ogTitle?: string;
  ogDescription?: string;
  /** Varsayılan robots: false ise noindex. */
  index: boolean;
  /** false: admin bu sayfayı indekslenebilir YAPAMAZ (ör. giriş). */
  canIndex: boolean;
  sitemap: { include: boolean; priority: number; freq: ChangeFreq };
  /** Sayfada fiilen basılan yapılandırılmış veri türleri (BreadcrumbList otomatik). */
  jsonLd: JsonLdKind[];
};

const LEGAL = { include: true, priority: 0.3, freq: "yearly" as ChangeFreq };

const BASE_PAGES: SeoPageDef[] = [
  {
    path: "/",
    label: "Ana sayfa",
    group: "ana",
    title: null,
    description: null,
    index: true,
    canIndex: true,
    sitemap: { include: true, priority: 1, freq: "weekly" },
    jsonLd: ["Organization", "WebSite", "SoftwareApplication", "FAQPage"],
  },
  {
    path: "/fiyatlar",
    label: "Fiyatlar",
    group: "ana",
    title: "Fiyatlar",
    description:
      "EmlakSoft paketleri, aylık ve yıllık fiyatlar, kullanıcı ve portföy limitleri ile özellik karşılaştırması. Ücretsiz deneme, kredi kartı gerekmez.",
    ogTitle: "EmlakSoft Fiyatlar",
    ogDescription: "Açık fiyatlar, paket limitleri ve karşılaştırma tablosu. Ücretsiz deneme, kredi kartı gerekmez.",
    index: true,
    canIndex: true,
    sitemap: { include: true, priority: 0.8, freq: "monthly" },
    jsonLd: ["SoftwareApplication", "FAQPage", "BreadcrumbList"],
  },
  {
    path: "/demo",
    label: "Ücretsiz deneme / görüşme",
    group: "ana",
    title: "14 Gün Ücretsiz Deneyin",
    description:
      "EmlakSoft'u 14 gün ücretsiz deneyin; kredi kartı gerekmez. Portföy, müşteri, komisyon ve portal yönetimini kendi verinizle görün. Sorunuz varsa görüşme talep edebilirsiniz.",
    ogTitle: "EmlakSoft — 14 Gün Ücretsiz Dene",
    ogDescription: "Emlak ofisinizi tek platformda yönetin. 14 gün ücretsiz deneyin.",
    index: true,
    canIndex: true,
    sitemap: { include: true, priority: 0.8, freq: "monthly" },
    jsonLd: ["BreadcrumbList"],
  },
  {
    path: "/kayit",
    label: "Kayıt",
    group: "hesap",
    title: "Ofisinizi Ücretsiz Oluşturun",
    description:
      "Ücretsiz deneme ile EmlakSoft'a başlayın. Kredi kartı gerekmez. Deneme boyunca tüm paketlerin özellikleri açıktır. Portföy, müşteri ve komisyon yönetimi tek platformda.",
    ogTitle: "EmlakSoft — Ücretsiz Başla",
    ogDescription: "Ücretsiz deneme. Emlak ofisinizi bugün dijitalleştirin.",
    index: true,
    canIndex: true,
    sitemap: { include: true, priority: 0.9, freq: "monthly" },
    jsonLd: ["BreadcrumbList"],
  },
  {
    path: "/giris",
    label: "Giriş",
    group: "hesap",
    title: "Giriş Yap",
    description: "EmlakSoft ofis ve personel paneline güvenli giriş.",
    index: false,
    canIndex: false,
    // Giriş sayfası noindex'tir; sitemap'te bulunması çelişkidir (eski sitemap'te vardı).
    sitemap: { include: false, priority: 0.5, freq: "monthly" },
    jsonLd: [],
  },
  {
    path: "/araclar",
    label: "Araçlar (liste)",
    group: "arac",
    title: "Ücretsiz emlak hesaplama araçları",
    description:
      "Komisyon, tapu ve alım masrafı, kira getirisi ve konut kredisi taksit hesaplayıcıları. Ücretsiz, kayıt gerekmez; veriler tarayıcınızda hesaplanır.",
    ogTitle: "Ücretsiz emlak hesaplama araçları | EmlakSoft",
    ogDescription: "Komisyon, alım masrafı, kira getirisi ve kredi taksiti için ücretsiz hesaplayıcılar.",
    index: true,
    canIndex: true,
    sitemap: { include: true, priority: 0.6, freq: "monthly" },
    jsonLd: ["BreadcrumbList"],
  },
  {
    path: "/gizlilik",
    label: "Gizlilik politikası",
    group: "yasal",
    title: "Gizlilik Politikası",
    description: "EmlakSoft gizlilik politikası — verileriniz nasıl korunur.",
    index: true,
    canIndex: true,
    sitemap: LEGAL,
    jsonLd: [],
  },
  {
    path: "/kullanim-sartlari",
    label: "Kullanım şartları",
    group: "yasal",
    title: "Kullanım Şartları",
    description: "EmlakSoft üyelik ve kullanım şartları.",
    index: true,
    canIndex: true,
    sitemap: LEGAL,
    jsonLd: [],
  },
  {
    path: "/cerez-politikasi",
    label: "Çerez politikası",
    group: "yasal",
    title: "Çerez Politikası",
    description: "EmlakSoft'un kullandığı çerezler ve yönetim seçenekleri.",
    index: true,
    canIndex: true,
    sitemap: LEGAL,
    jsonLd: [],
  },
  {
    path: "/kvkk-aydinlatma",
    label: "KVKK aydınlatma metni",
    group: "yasal",
    title: "KVKK Aydınlatma Metni",
    description: "6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında aydınlatma metni.",
    index: true,
    canIndex: true,
    sitemap: LEGAL,
    jsonLd: [],
  },
  {
    path: "/iptal-iade",
    label: "İptal ve iade politikası",
    group: "yasal",
    title: "İptal & İade Politikası",
    description: "Abonelik iptali, cayma hakkı ve iade koşulları.",
    index: true,
    canIndex: true,
    sitemap: LEGAL,
    jsonLd: [],
  },
  {
    path: "/mesafeli-satis",
    label: "Mesafeli satış sözleşmesi",
    group: "yasal",
    title: "Mesafeli Satış Sözleşmesi",
    description: "6502 sayılı Kanun ve Mesafeli Sözleşmeler Yönetmeliği kapsamında mesafeli satış sözleşmesi.",
    index: true,
    canIndex: true,
    sitemap: LEGAL,
    jsonLd: [],
  },
  {
    path: "/on-bilgilendirme",
    label: "Ön bilgilendirme formu",
    group: "yasal",
    title: "Ön Bilgilendirme Formu",
    description: "Mesafeli Sözleşmeler Yönetmeliği m.5 kapsamında ön bilgilendirme formu.",
    index: true,
    canIndex: true,
    sitemap: LEGAL,
    jsonLd: [],
  },
  {
    path: "/davet-kosullari",
    label: "Davet ve ortaklık programı koşulları",
    group: "yasal",
    title: "Davet ve Ortaklık Programı Koşulları",
    description: "EmlakSoft davet programında kimler katılabilir, hesap kredisi nasıl kazanılır ve hangi hâllerde geri alınır.",
    index: true,
    canIndex: true,
    sitemap: LEGAL,
    jsonLd: [],
  },
];

function toolPages(): SeoPageDef[] {
  return publishedTools().map((t) => ({
    path: `/araclar/${t.slug}`,
    label: `Araç: ${t.title}`,
    group: "arac" as const,
    title: t.title,
    description: t.description,
    ogTitle: `${t.title} | EmlakSoft`,
    ogDescription: t.description,
    index: true,
    canIndex: true,
    sitemap: { include: true, priority: 0.6, freq: "monthly" as ChangeFreq },
    jsonLd: ["WebApplication", "BreadcrumbList"] as JsonLdKind[],
  }));
}

/** Yönetilebilir tüm statik sayfalar (sıra: ana, hesap, araçlar, yasal). */
export function seoPages(): SeoPageDef[] {
  const tools = toolPages();
  const araclar = BASE_PAGES.filter((p) => p.path === "/araclar");
  const rest = BASE_PAGES.filter((p) => p.path !== "/araclar");
  const [home, ...others] = rest;
  return [home!, ...others.filter((p) => p.group !== "yasal"), ...araclar, ...tools, ...others.filter((p) => p.group === "yasal")];
}

export function getSeoPage(path: string): SeoPageDef | undefined {
  return seoPages().find((p) => p.path === path);
}

/**
 * Hiçbir koşulda sitemap'e girmeyen ve robots.txt'te taranması kapatılan yol önekleri.
 * Token'lı portallar, oturumlu alanlar, ödeme/imza/anket/randevu, sunum/paylaş.
 */
export const NEVER_INDEX_PREFIXES = [
  "/app",
  "/admin",
  "/api",
  "/odeme-link",
  "/malik-portali",
  "/musteri-portali",
  "/randevu-teyit",
  "/randevu-al",
  "/paylas",
  "/sunum",
  "/tavsiye",
  "/imza",
  "/degerleme-raporu",
  "/anket",
  "/lead",
  "/acik-ev-kayit",
  "/giris",
  "/sifre-sifirla",
  "/sifre-yenile",
  "/brand-asset",
  "/site-menu-asset",
] as const;

/** robots.txt'te her zaman Disallow olan yollar (çıkarılamaz). */
export const ALWAYS_DISALLOW = [
  "/app/",
  "/admin/",
  "/api/",
  "/odeme-link/",
  "/malik-portali/",
  "/musteri-portali/",
  "/randevu-teyit/",
  "/randevu-al/",
  "/paylas/",
  "/sunum/",
  "/tavsiye/",
  "/imza/",
  "/degerleme-raporu/",
  "/anket/",
  "/lead/",
  "/acik-ev-kayit/",
  "/r/",
  "/p/",
  "/vitrin/*/favoriler",
] as const;
