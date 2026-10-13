import { requirePlatformModule } from "@/lib/platform";
import { gscSummary, readInspections } from "@/lib/google/db";
import { parsePeriod } from "@/lib/google/performance-model";
import { readConnectionView } from "@/lib/google/read";
import { serviceCard } from "@/lib/google/view-model";
import { PerformanceView, TABS, type PerformanceData } from "./performance-view";

export const metadata = { title: "Arama performansı" };

type SP = { sekme?: string; donem?: string };

/**
 * Search Console performansı (modül `seo`). Render sırasında Google API çağrılmaz: yalnız `seo_gsc_daily` /
 * `seo_url_inspections` okunur (SQL tarafında toplanır). Bağlı değilse tablolar hiç sorgulanmaz, kurulum kartı çizilir.
 */
export default async function SeoPerformancePage({ searchParams }: { searchParams?: Promise<SP> }) {
  await requirePlatformModule("seo");
  const sp = (await searchParams) ?? {};
  const tab = (TABS.find((t) => t.id === sp.sekme)?.id ?? "sorgular") as PerformanceData["tab"];
  const period = parsePeriod(sp.donem);

  const view = await readConnectionView();
  const card = serviceCard(view, "gsc");
  const connected = card.status !== "bagli_degil";

  const [queries, pages, inspections] = connected
    ? await Promise.all([
        tab === "sorgular" ? gscSummary(period, "query", 200) : Promise.resolve(null),
        tab === "sayfalar" ? gscSummary(period, "page", 200) : Promise.resolve(null),
        tab === "inceleme" ? readInspections(500) : Promise.resolve(null),
      ])
    : [null, null, null];

  return <PerformanceView data={{ card, property: view.gscProperty, period, tab, queries, pages, inspections }} />;
}
