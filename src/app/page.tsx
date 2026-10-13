import { getEfCatalog } from "@/lib/ef-credits/credit-reader";
import { getPublicPricing } from "@/lib/billing/public-pricing";
import { getLiveSiteContent } from "@/lib/site-content/store";
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/store";
import { renderHome } from "./_home/render-home";
import "./marketing.css";
import "./marketing-sections.css";
import "./marketing-motion.css";
import "./marketing-mobile.css";

// Canonical "/" burada verilir (kökte yok); başlık/açıklama/OG ayarlardan, ayar yokken layout varsayılanı.
export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata("/");
}

/**
 * Ana sayfa: gövde `renderHome` (src/app/_home/render-home.tsx; taslak önizlemesi de aynı işlevi kullanır). Statik sayfa:
 * çerez/başlık okuması yok. Public sayfa her zaman açık temadır.
 */
export default async function HomePage() {
  // Metinler yönetim panelinden (Site içeriği); yayın yoksa bugünkü metin. Okuma sunucuda, etiketli önbellekten (sayfa statik kalır).
  const [pricing, content] = await Promise.all([getPublicPricing(), getLiveSiteContent()]);
  const efCatalog = await getEfCatalog();
  return renderHome({ content, pricing, efCatalog });
}
