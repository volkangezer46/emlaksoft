"use client";

import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_COLORS } from "@/components/ui/chart-colors";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import { formatChartAxis } from "@/components/ui/chart-format";
import { useReducedMotion } from "@/components/ui/use-reduced-motion";

/**
 * Danışman gelir grafiği — paylaşılan BarCompare'in tıklanabilir sürümü.
 * Çubuğa tıklayınca danışman detayına gider; BarCompare onClick almadığı
 * için yerel sürüm. İpucu ortak `ChartTooltip` (tek ipucu bileşeni).
 */

export type RevenueDatum = { id: string; name: string; revenue: number };

const axisProps = {
  stroke: "var(--text-faint)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

export function RevenueChart({ data }: { data: RevenueDatum[] }) {
  const router = useRouter();
  const reduce = useReducedMotion();

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 12, left: 8, bottom: 0 }}
        barGap={4}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical horizontal={false} />
        <XAxis type="number" {...axisProps} tickFormatter={(v: number) => formatChartAxis(v)} />
        <YAxis type="category" dataKey="name" {...axisProps} width={110} />
        <Tooltip content={<ChartTooltip format="money" hint="Danışman detayı için tıklayın" />} cursor={{ fill: "var(--accent)", fillOpacity: 0.05 }} />
        <Bar
          dataKey="revenue"
          name="Gelir"
          fill={CHART_COLORS[0]}
          radius={[0, 6, 6, 0]}
          maxBarSize={18}
          isAnimationActive={!reduce}
          animationDuration={600}
          cursor="pointer"
          onClick={(entry: unknown) => {
            // Recharts onClick payload'ı: çubuğun veri satırı (id dahil)
            const d = entry as { id?: string; payload?: { id?: string } };
            const id = d?.id ?? d?.payload?.id;
            if (id) router.push(`/app/ekip/${id}`);
          }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
