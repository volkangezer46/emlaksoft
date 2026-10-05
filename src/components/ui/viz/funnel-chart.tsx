import Link from "next/link";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { Illustration } from "@/components/ui/illustrations";
import { formatViz, type VizFormat } from "./colors";

/**
 * FunnelChart (viz) — yatay hunidir: tüm aşamalar ORTAK ölçekte (en büyük aşama = %100),
 * böylece çubuk uzunlukları gerçek oranı gösterir. Aşama etiketi ve değer her satırda
 * görünür (renge bağımlı değil). `href` verilen aşama filtrelenmiş listeye gider.
 *
 * Dönüşüm oku (aşamalar arası %): YALNIZ `ardisik` true ise çizilir — yani her aşama bir
 * öncekinin alt kümesi olduğu doğrulanmış gerçek bir hunide. Aksi halde (bağımsız sayımlar)
 * oran yanıltıcı olur, gösterilmez.
 * Hareket: çubuklar ilk görünümde soldan bir kez dolar (motion.css `.viz-grow-x`).
 */
export type FunnelStage = { label: string; value: number; href?: string; sub?: string };

export function FunnelChart({
  stages,
  format = "number",
  ardisik = false,
  ariaLabel = "Dönüşüm hunisi",
  emptyText = "Henüz veri yok",
  className,
}: {
  stages: readonly FunnelStage[];
  format?: VizFormat;
  /** Her aşama bir öncekinin alt kümesi mi? true ise aşamalar arası dönüşüm oku gösterilir. */
  ardisik?: boolean;
  ariaLabel?: string;
  emptyText?: string;
  className?: string;
}) {
  const max = Math.max(0, ...stages.map((s) => (Number.isFinite(s.value) ? s.value : 0)));
  if (stages.length === 0 || max <= 0) {
    return (
      <div className={cn("grid place-items-center gap-2 py-4 text-center", className)}>
        <Illustration kind="funnel" size={112} />
        <p className="text-sm text-text-muted">{emptyText}</p>
      </div>
    );
  }
  return (
    <ol className={cn("m-0 flex list-none flex-col p-0", className)} aria-label={ariaLabel}>
      {stages.map((s, i) => {
        const v = Number.isFinite(s.value) ? Math.max(0, s.value) : 0;
        const pct = v > 0 ? Math.max(2, (v / max) * 100) : 0;
        const prev = i > 0 ? stages[i - 1]!.value : 0;
        const conv = ardisik && i > 0 ? (prev > 0 ? Math.round((v / prev) * 100) : null) : undefined;
        const row = (
          <div className="grid grid-cols-[minmax(5.5rem,9rem)_1fr_auto] items-center gap-3 py-1.5">
            <span className="min-w-0 text-sm text-text-muted">
              <span className="block truncate" title={s.label}>
                {s.label}
              </span>
              {s.sub ? <span className="block truncate text-xs text-text-faint">{s.sub}</span> : null}
            </span>
            <span className="relative block h-3 overflow-hidden rounded-full bg-[var(--surface-sunken)]" aria-hidden="true">
              <span
                className="viz-grow-x absolute inset-y-0 left-0 block rounded-full"
                style={{ width: `${pct}%`, background: "var(--viz-1)", "--viz-delay": `${i * 60}ms` } as CSSProperties}
              />
            </span>
            <span className="text-sm font-semibold tabular-nums text-[color:var(--viz-tooltip-text)]">{formatViz(v, format)}</span>
          </div>
        );
        return (
          <li key={i}>
            {conv !== undefined ? (
              <p className="m-0 ml-1 flex items-center gap-1.5 py-0.5 text-xs text-text-faint">
                <span aria-hidden="true">↓</span>
                {conv === null ? "Dönüşüm hesaplanamadı (önceki aşama 0)" : `%${conv} sonraki aşamaya geçti`}
              </p>
            ) : null}
            {s.href ? (
              <Link href={s.href} className="block rounded-[var(--radius-control)] hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ol>
  );
}
