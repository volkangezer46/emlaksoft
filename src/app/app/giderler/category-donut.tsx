"use client";

import { useRouter } from "next/navigation";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CHART_COLORS } from "@/components/ui/chart";

/**
 * Gider kategori dağılımı — paylaşılan DonutSplit'in tıklanabilir sürümü.
 * Segmente tıklayınca liste o kategoriye süzülür (?kategori=). DonutSplit
 * onClick almadığı için yerel kopya.
 */

const tryFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 0,
});

export type CategoryDatum = { name: string; value: number; category: string };

function DonutTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name?: string | number; value?: number | string; payload?: { fill?: string } }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[11px] border border-hairline bg-surface/95 px-3 py-2 shadow-[var(--inner-top),var(--elev-4)] backdrop-blur-sm">
      <p className="flex items-center gap-2 text-sm text-ink-950">
        <span
          className="h-2 w-2 shrink-0 rounded-full ring-2 ring-inset ring-white/40"
          style={{ background: payload[0]?.payload?.fill ?? CHART_COLORS[0] }}
        />
        <span className="text-text-muted">{payload[0]?.name}</span>
        <span className="numeric ml-auto font-bold">
          {tryFormatter.format(Number(payload[0]?.value ?? 0))}
        </span>
      </p>
      <p className="mt-1 text-[11px] text-text-faint">Kategoriye süzmek için tıklayın</p>
    </div>
  );
}

export function CategoryDonut({ data, centerLabel }: { data: CategoryDatum[]; centerLabel?: string }) {
  const router = useRouter();
  const total = data.reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="relative h-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={2}
            strokeWidth={0}
            cursor="pointer"
            onClick={(entry: unknown) => {
              const d = entry as { category?: string; payload?: { category?: string } };
              const category = d?.category ?? d?.payload?.category;
              if (category) router.push(`/app/giderler?kategori=${encodeURIComponent(category)}`);
            }}
          >
            {data.map((_, index) => (
              <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<DonutTooltip />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-x-0 top-[38%] -translate-y-1/2 text-center">
        <p className="numeric font-display text-xl font-extrabold tracking-[-0.02em] text-ink-950">
          {tryFormatter.format(total)}
        </p>
        {centerLabel ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-faint">
            {centerLabel}
          </p>
        ) : null}
      </div>
    </div>
  );
}
