import { cn } from "@/lib/utils";
import { Illustration } from "@/components/ui/illustrations";
import { formatViz, VIZ_SEQ, type VizFormat } from "./colors";

/**
 * Heatmap (viz) — CSS grid ısı haritası (ör. 7 gün x 24 saat). Tek hue sıralı palet
 * (`--viz-seq-1..5`): koyu = yüksek. Hücre başına title + aynı veriyi veren sr-only tablo.
 * Veri yoksa (hepsi 0 / boş) EmptyArt değil illüstrasyonlu boş durum. Hareket yok (hücre
 * sayısı yüksek; sayfa hareket bütçesini yemez).
 *
 * `values[r][c]` satır r, sütun c. Düzey: değer/en büyük değer oranı 5 basamağa bölünür;
 * 0 değer "boş" yüzeydir (palette girmez).
 */
export function Heatmap({
  rows,
  cols,
  values,
  format = "number",
  unit,
  ariaLabel,
  labelEvery,
  emptyText = "Henüz veri yok",
  className,
}: {
  rows: readonly string[];
  cols: readonly string[];
  values: readonly (readonly number[])[];
  format?: VizFormat;
  /** Hücre title'ı için birim (ör. "randevu"). */
  unit?: string;
  ariaLabel: string;
  /** Sütun etiketi seyreltme (varsayılan: 12'den fazla sütunda her 3.). */
  labelEvery?: number;
  emptyText?: string;
  className?: string;
}) {
  const flat = values.flatMap((r) => [...r]).filter((v) => Number.isFinite(v));
  const max = Math.max(0, ...flat);
  if (rows.length === 0 || cols.length === 0 || max <= 0) {
    return (
      <div className={cn("grid place-items-center gap-2 py-4 text-center", className)}>
        <Illustration kind="heatmap" size={112} />
        <p className="text-sm text-text-muted">{emptyText}</p>
      </div>
    );
  }
  const every = labelEvery ?? (cols.length > 12 ? 3 : 1);
  const level = (v: number) => (v > 0 ? Math.min(VIZ_SEQ.length, Math.max(1, Math.ceil((v / max) * VIZ_SEQ.length))) : 0);

  return (
    <figure className={cn("m-0", className)}>
      <div role="img" aria-label={ariaLabel} className="overflow-x-auto">
        <div className="grid min-w-[22rem] gap-[3px]" style={{ gridTemplateColumns: `auto repeat(${cols.length}, minmax(0, 1fr))` }} aria-hidden="true">
          <span />
          {cols.map((c, i) => (
            <span key={i} className="truncate text-center text-xs text-text-muted">
              {i % every === 0 ? c : ""}
            </span>
          ))}
          {rows.map((r, ri) => (
            <div key={ri} className="contents">
              <span className="pr-2 text-right text-xs leading-5 text-text-muted">{r}</span>
              {cols.map((c, ci) => {
                const v = values[ri]?.[ci] ?? 0;
                const lv = level(Number.isFinite(v) ? v : 0);
                return (
                  <span
                    key={ci}
                    title={`${r} ${c}: ${formatViz(v, format)}${unit ? ` ${unit}` : ""}`}
                    className="h-5 rounded-sm shadow-[inset_0_0_0_1px_var(--hairline)]"
                    style={{ background: lv === 0 ? "var(--surface-sunken)" : VIZ_SEQ[lv - 1] }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <figcaption className="mt-2 flex items-center justify-end gap-1.5 text-xs text-text-muted" aria-hidden="true">
        Az
        {VIZ_SEQ.map((c) => (
          <span key={c} className="h-3 w-5 rounded-sm shadow-[inset_0_0_0_1px_var(--hairline)]" style={{ background: c }} />
        ))}
        Çok
      </figcaption>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col" />
            {cols.map((c, i) => (
              <th key={i} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              <th scope="row">{r}</th>
              {cols.map((_, ci) => (
                <td key={ci}>{formatViz(values[ri]?.[ci] ?? 0, format)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
