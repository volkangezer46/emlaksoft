import { getPlan } from "@/lib/billing/plans";
import { getBaseUrl } from "@/lib/base-url";
import { FAQS } from "./faq";

/** Organization + SoftwareApplication + FAQPage (yalnız görünen SSS'den). */
export function LandingJsonLd() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "EmlakSoft",
        url: getBaseUrl(),
        description: "Türkiye emlak ofisleri için abonelikli CRM ve ofis yönetim platformu.",
        areaServed: "TR",
      },
      {
        "@type": "SoftwareApplication",
        name: "EmlakSoft",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: "Müşteri, portföy, randevu, anlaşma ve komisyon akışını tek platformda yöneten emlak ofisi yazılımı. KVKK süreçlerini destekler.",
        offers: { "@type": "Offer", price: String(getPlan("advisor").monthlyTry), priceCurrency: "TRY" },
        inLanguage: "tr-TR",
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQS.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
    ],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />;
}
