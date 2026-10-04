import { PLANS } from "@/lib/billing/plans";
import { getBaseUrl } from "@/lib/base-url";
import { buildPageJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { getSeoPage } from "@/lib/seo/registry";
import { getSeoSettings } from "@/lib/seo/store";

/**
 * Sayfa yapılandırılmış verisi (JSON-LD). Türler: sayfa kaydı varsayılanı, /admin/seo "Sayfalar" ile değiştirilebilir.
 * - FAQPage yalnız çağıranın geçirdiği GÖRÜNEN SSS listesinden üretilir.
 * - Fiyatlar plans.ts'teki gerçek KDV hariç aylık tutarlardır; AggregateRating/Review ASLA üretilmez.
 * - Çıktı serializeJsonLd ile kaçışlıdır (HTML/XSS yok).
 */
export async function SeoJsonLd({
  path,
  faq,
  tool,
}: {
  path: string;
  faq?: readonly { q: string; a: string }[];
  tool?: { title: string; description: string; url: string };
}) {
  const s = await getSeoSettings();
  const kinds = s.pages[path]?.jsonLd ?? getSeoPage(path)?.jsonLd ?? [];
  const graph = buildPageJsonLd({
    global: s.global,
    base: getBaseUrl(),
    path,
    plans: PLANS.map((p) => ({ id: p.id, name: p.name, monthlyTry: p.monthlyTry })),
    faq,
    kinds,
    tool,
  });
  if (!graph) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(graph) }} />;
}
