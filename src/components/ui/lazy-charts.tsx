"use client";

/**
 * Grafiklerin TEMBEL kapısı (TEK kaynak; `src/app/app/_ui/lazy-chart.tsx` bunu yeniden dışa aktarır).
 *
 * SORUN: `@/components/ui/chart` modülünün ilk satırı `import { ... } from "recharts"`.
 * O modülden SADECE çerçeve içe aktarmak bile Recharts'ın tamamını sayfanın ilk paketine
 * sokuyordu (~1.0 MB istemci JS'i ölçülmüştü).
 *
 * ÇÖZÜM: `next/dynamic` (docs: 01-app/02-guides/lazy-loading.md). Recharts ayrı bir parçaya
 * (chunk) taşınır; `ssr` KAPATILMADI — sunucu HTML'i aynı kalır, yalnız ilk JS paketi küçülür.
 * Sunucu bileşeninden doğrudan `dynamic()` kod bölmediği için kapı bir istemci modülüdür.
 */
import dynamic from "next/dynamic";
import { SkeletonCard } from "@/components/ui/viz/skeleton-card";

export { ChartFrame, ChartCard } from "@/components/ui/chart-frame";
export { ChartTooltip } from "@/components/ui/chart-tooltip";
export type { TrendPoint } from "@/components/ui/chart";

const chartModule = () => import("@/components/ui/chart");

// Grafik parçası inerken kartın sabit yüksekliğini dolduran iskelet (düzen kayması yok;
// parlama `.skeleton`, reduced-motion'da durağan).
function ChartSkeleton() {
  return <SkeletonCard height="100%" label="Grafik yükleniyor" />;
}

export const AreaTrend = dynamic(() => chartModule().then((m) => m.AreaTrend), { loading: ChartSkeleton });
export const BarCompare = dynamic(() => chartModule().then((m) => m.BarCompare), { loading: ChartSkeleton });
export const DonutSplit = dynamic(() => chartModule().then((m) => m.DonutSplit), { loading: ChartSkeleton });
export const AreaTrendChart = dynamic(() => chartModule().then((m) => m.AreaTrendChart), { loading: ChartSkeleton });
