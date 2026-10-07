import type { ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { cn } from "@/lib/utils";
import { VIZ_SERIES } from "@/components/ui/viz/colors";

/**
 * Admin panelleri için iki sakin çubuk bileşeni (saf CSS, sunucu bileşeni, sonsuz animasyon YOK).
 * - StackedBar: parçaların toplamdaki payını tek yığılmış çubukta gösterir (plan dağılımı vb.).
 * - RankedBars: değere göre sıralı yatay çubuk listesi (gelir türü, ödeme yöntemi, kaynak kırılımı).
 * Renkler `--viz-*` tokenlarından; her satır/parça `href` verilirse filtrelenmiş hedefe bağlanır.
 */

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

export type BarRow = {
  label: string;
  value: number;
  href?: string;
  hint?: string;
};

type Fmt = (n: number) => string;

function pct(part: number, total: number): string {
  if (total <= 0) return "%0";
  const p = (part / total) * 100;
  return `%${p < 1 && part > 0 ? "<1" : nf.format(p)}`;
}

function RowShell({ href, className, children }: { href?: string; className?: string; children: ReactNode }) {
  const base = cn("flex min-h-9 items-center gap-3 rounded-[var(--radius-control)] px-1.5 text-sm", className);
  if (!href) return <div className={base}>{children}</div>;
  return (
    <Link href={href} className={cn(base, "focus-ring transition-colors hover:bg-[var(--surface-sunken)]")}>
      {children}
    </Link>
  );
}

export function StackedBar({
  rows,
  format = (n) => nf.format(n),
  ariaLabel,
  className,
}: {
  rows: readonly BarRow[];
  format?: Fmt;
  ariaLabel: string;
  className?: string;
}) {
  const shown = rows.filter((r) => r.value > 0);
  const total = shown.reduce((n, r) => n + r.value, 0);
  if (total <= 0) return null;
  const color = (label: string) => VIZ_SERIES[rows.findIndex((r) => r.label === label) % VIZ_SERIES.length];
  return (
    <div className={className}>
      <div role="img" aria-label={ariaLabel} className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
        {shown.map((r) => {
          const style = { width: `${(r.value / total) * 100}%`, background: color(r.label) };
          return r.href ? (
            <Link key={r.label} href={r.href} aria-label={`${r.label}: ${format(r.value)}`} title={`${r.label}: ${format(r.value)}`} className="focus-ring block h-full min-w-1" style={style} />
          ) : (
            <span key={r.label} title={`${r.label}: ${format(r.value)}`} className="block h-full min-w-1" style={style} />
          );
        })}
      </div>
      <ul className="mt-2">
        {rows.map((r) => (
          <li key={r.label}>
            <RowShell href={r.href} className={r.value === 0 ? "opacity-60" : undefined}>
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: color(r.label) }} />
              <span className="min-w-0 flex-1 truncate text-text">{r.label}</span>
              {r.hint ? <span className="hidden text-xs text-text-faint sm:inline">{r.hint}</span> : null}
              <span className="w-12 text-right text-xs tabular-nums text-text-faint">{pct(r.value, total)}</span>
              <span className="min-w-16 text-right font-semibold tabular-nums text-text">{format(r.value)}</span>
            </RowShell>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RankedBars({
  rows,
  format = (n) => nf.format(n),
  emptyText = "Henüz veri yok",
  className,
}: {
  rows: readonly BarRow[];
  format?: Fmt;
  emptyText?: string;
  className?: string;
}) {
  const sorted = [...rows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length === 0) return <p className="py-3 text-sm text-text-muted">{emptyText}</p>;
  const max = sorted[0]!.value;
  const total = sorted.reduce((n, r) => n + r.value, 0);
  return (
    <ul className={className}>
      {sorted.map((r) => (
        <li key={r.label}>
          <RowShell href={r.href} className="flex-col items-stretch justify-center gap-1 py-1">
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-text">
                {r.label}
                {r.hint ? <span className="ml-1.5 text-xs text-text-faint">{r.hint}</span> : null}
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="mr-2 text-xs text-text-faint">{pct(r.value, total)}</span>
                <span className="font-semibold text-text">{format(r.value)}</span>
              </span>
            </span>
            <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
              <span className="block h-full rounded-full" style={{ width: `${Math.max((r.value / max) * 100, 2)}%`, background: "var(--viz-1)" }} />
            </span>
          </RowShell>
        </li>
      ))}
    </ul>
  );
}
