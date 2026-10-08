import { BarCompare } from "@/components/ui/lazy-charts";
import type { ChartValueFormat } from "@/components/ui/chart-format";
import { cn } from "@/lib/utils";

export type RankItem = {
  key: string;
  label: string;
  /** Filtrelenmiş hedef (sıfır çıkmaz metrik): çubuğa tıklayınca gidilir. */
  href: string;
  /** Çubuk değeri (sayı ya da ₺). */
  value: number;
  /** Ekran okuyucu için tam metin (yüzde, tutar, açıklama). */
  valueText: string;
};

/**
 * RankBars — sıralı kategori çubukları (7+ kategoride pasta yerine). Ortak canlı grafik seti (`BarCompare`, yatay):
 * üzerine gelince ipucu, çubuğa tıklayınca filtrelenmiş liste. Tam değerler sr-only listede de verilir (renk/grafik tek başına
 * anlam taşımaz). Satır başına ~44 px ayrılır; Recharts tembel yüklenir.
 */
export function RankBars({
  items,
  format = "number",
  color = "var(--viz-1)",
  ariaLabel,
  seriesLabel = "Adet",
  className,
}: {
  items: readonly RankItem[];
  format?: ChartValueFormat;
  color?: string;
  ariaLabel: string;
  seriesLabel?: string;
  className?: string;
}) {
  return (
    <figure className={cn("m-0", className)} aria-label={ariaLabel}>
      <div style={{ height: Math.max(120, items.length * 44 + 28) }}>
        <BarCompare
          layout="horizontal"
          hrefKey="href"
          hint="Listeyi aç"
          format={format}
          data={items.map((it) => ({ ad: it.label, deger: it.value, href: it.href }))}
          xKey="ad"
          series={[{ key: "deger", label: seriesLabel, color }]}
          showValues
        />
      </div>
      <ul className="sr-only">
        {items.map((it) => (
          <li key={it.key}>
            {it.label}: {it.valueText}
          </li>
        ))}
      </ul>
    </figure>
  );
}
