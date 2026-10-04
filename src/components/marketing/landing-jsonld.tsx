import { SeoJsonLd } from "@/components/seo/seo-json-ld";

/**
 * Organization + WebSite + SoftwareApplication (paket başına gerçek KDV hariç fiyat, admin paket tanımlarından)
 * + FAQPage (yalnız görünen SSS). Üretim ve doğrulama src/lib/seo/jsonld.ts'te; türler /admin/seo'dan ayarlanır.
 */
export function LandingJsonLd({ faq }: { faq: readonly { q: string; a: string }[] }) {
  return <SeoJsonLd path="/" faq={faq} />;
}
