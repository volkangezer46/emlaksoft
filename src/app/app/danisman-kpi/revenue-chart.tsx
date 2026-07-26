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
import { CHART_COLORS } from "@/components/ui/chart";

/**
 * Danışman gelir grafiği — paylaşılan BarCompare'in tıklanabilir sürümü.
 * Çubuğa tıklayınca danışman detayına gider; BarCompare onClick almadığı
 * için (ve paylaşılan bileşen bu iş için değiştirilmediği için) yerel kopya.
 */

const tryFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 0,
});
const compactFormatter = new Intl.NumberFormat("tr-TR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export type RevenueDatum = { id: string; name: string; revenue: number };

const axisProps = {
  stroke: "var(--text-faint)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

function RevenueTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number | string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[11px] border border-hairline bg-surface/95 px-3 py-2 shadow-[var(--inner-top),var(--elev-4)] backdrop-blur-sm">
      {label != null ? (
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
          {label}
        </p>
      ) : null}
      <p className="flex items-center gap-2 text-sm text-ink-950">
        <span
          className="h-2 w-2 shrink-0 rounded-full ring-2 ring-inset ring-white/40"
          style={{ background: CHART_COLORS[0] }}
        />
        <span className="text-text-muted">Gelir</span>
        <span className="numeric ml-auto font-bold">
          {tryFormatter.format(Number(payload[0]?.value ?? 0))}
        </span>
      </p>
      <p className="mt-1 text-[11px] text-text-faint">Danışman detayı için tıklayın</p>
    </div>
  );
}

export function RevenueChart({ data }: { data: RevenueDatum[] }) {
  const router = useRouter();

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 12, left: 8, bottom: 0 }}
        barGap={4}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical horizontal={false} />
        <XAxis type="number" {...axisProps} tickFormatter={(v: number) => compactFormatter.format(v)} />
        <YAxis type="category" dataKey="name" {...axisProps} width={110} />
        <Tooltip content={<RevenueTooltip />} cursor={{ fill: "var(--brand-600)", fillOpacity: 0.05 }} />
        <Bar
          dataKey="revenue"
          name="Gelir"
          fill={CHART_COLORS[0]}
          radius={[0, 6, 6, 0]}
          maxBarSize={18}
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
