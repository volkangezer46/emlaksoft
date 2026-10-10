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
import { useEffect, useState, type ComponentType } from "react";
import { isSoftNavigated } from "@/lib/soft-nav";
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

const AreaTrendLazy = dynamic(() => chartModule().then((m) => m.AreaTrend), { loading: ChartSkeleton });
const BarCompareLazy = dynamic(() => chartModule().then((m) => m.BarCompare), { loading: ChartSkeleton });
const DonutSplitLazy = dynamic(() => chartModule().then((m) => m.DonutSplit), { loading: ChartSkeleton });
const AreaTrendChartLazy = dynamic(() => chartModule().then((m) => m.AreaTrendChart), { loading: ChartSkeleton });

/**
 * Yumuşak gezinmede (menüden sayfa geçişi) Recharts'ın ilk ölçüm+çizimi 200-300 ms'lik tek bir uzun görev
 * yaratıyordu. Bu kapı, gezinmeyle gelen grafikleri önce iskeletle boyar; Recharts'ı ilk boyamadan SONRA
 * (requestIdleCallback, yoksa kısa zamanlayıcı) kurar. Sayfa ilk açıldığında (sunucu HTML'i + hidrasyon) davranış
 * değişmez: grafik hemen çizilir. Hidrasyonda `data-soft-nav` yoktur, bu yüzden uyuşmazlık oluşmaz.
 */
function withIdleGate<P extends object>(Chart: ComponentType<P>): ComponentType<P> {
  function IdleGated(props: P) {
    const [ready, setReady] = useState(() => !isSoftNavigated());
    useEffect(() => {
      if (ready) return;
      const w = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      };
      if (w.requestIdleCallback) {
        const id = w.requestIdleCallback(() => setReady(true), { timeout: 400 });
        return () => w.cancelIdleCallback?.(id);
      }
      const t = setTimeout(() => setReady(true), 80);
      return () => clearTimeout(t);
    }, [ready]);
    return ready ? <Chart {...props} /> : <ChartSkeleton />;
  }
  return IdleGated;
}

export const AreaTrend = withIdleGate(AreaTrendLazy);
export const BarCompare = withIdleGate(BarCompareLazy);
export const DonutSplit = withIdleGate(DonutSplitLazy);
export const AreaTrendChart = withIdleGate(AreaTrendChartLazy);
