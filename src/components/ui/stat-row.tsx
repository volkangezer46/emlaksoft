import type { ReactNode } from "react";
import { formatCount } from "@/lib/ui/filter-params";
import { KpiGrid } from "@/components/ui/dashboard-grid";
import { KpiTile } from "@/components/ui/premium/kpi-card";

/**
 * StatRow — tıklanabilir KPI şeridi (eski imza korunur). Görünüm tasarım sistemi v4'ün TEK kart uygulaması
 * `KpiTile` (`layout="inline"`: ikon karosu solda, sayaç değer, alt bilgi) + `KpiGrid` ızgarası; /admin ve /app
 * ana ekranıyla aynı kart. "Sıfır çıkmaz metrik": `href` zorunlu, her öğe filtrelenmiş hedefe gider.
 * Değer 0 ise sönük gösterilir (yine tıklanabilir); `attention` sıfır değilse değer tehlike tonunda.
 */
export type StatRowItem = {
  label: string;
  /** Sayı ya da önceden biçimlenmiş metin (ör. "₺1,2 Mn"). */
  value: number | string;
  href: string;
  /** Kısa ek bilgi (ör. "bu hafta"). */
  hint?: string;
  icon?: ReactNode;
  /** Dikkat gerektiren değer: sıfır değilse vurgulanır. */
  attention?: boolean;
};

function isZero(v: number | string) {
  return v === 0 || v === "0";
}

export function StatRow({
  items,
  label = "Özet göstergeler",
  className,
}: {
  items: StatRowItem[];
  label?: string;
  className?: string;
}) {
  return (
    <KpiGrid count={items.length} label={label} className={className}>
      {items.map((it) => {
        const zero = isZero(it.value);
        const alert = Boolean(it.attention) && !zero;
        return (
          <KpiTile
            key={`${it.label}-${it.href}`}
            layout="inline"
            label={it.label}
            value={typeof it.value === "number" ? formatCount(it.value) : it.value}
            href={it.href}
            iconNode={it.icon}
            tone={alert ? "danger" : "brand"}
            tinted={alert}
            attention={alert}
            dim={zero && !it.attention}
            hint={it.hint}
          />
        );
      })}
    </KpiGrid>
  );
}
