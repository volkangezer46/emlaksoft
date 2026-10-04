import { SeoJsonLd } from "@/components/seo/seo-json-ld";
import { FAQS } from "./faq";

/**
 * Organization + WebSite + SoftwareApplication (paket başına gerçek KDV hariç fiyat) + FAQPage (yalnız görünen SSS).
 * Üretim ve doğrulama src/lib/seo/jsonld.ts'te; türler /admin/seo'dan ayarlanır.
 */
export function LandingJsonLd() {
  return <SeoJsonLd path="/" faq={FAQS} />;
}
