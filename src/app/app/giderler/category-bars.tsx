import Link from "next/link";
import type { CSSProperties } from "react";
import { categoryShares } from "@/lib/expense-category-chart";

/**
 * Kategori dağılımı — 7+ kalemde pasta yerine sıralı yatay çubuk. Her satır o kategoriyle
 * süzülmüş listeye gider (aynıysa süzgeci kaldırır). Çubuklar ortak `viz-grow-x` hareketini kullanır.
 */
export function CategoryBars({
  items,
  activeValue,
  hrefFor,
  formatMoney,
}: {
  items: { value: string; label: string; total: number }[];
  activeValue: string;
  hrefFor: (value: string | null) => string;
  formatMoney: (n: number) => string;
}) {
  const rows = categoryShares(items);
  return (
    <ol className="m-0 flex list-none flex-col p-0" aria-label="Kategori dağılımı">
      {rows.map((r, i) => {
        const active = activeValue === r.value;
        return (
          <li key={r.value}>
            <Link
              href={hrefFor(active ? null : r.value)}
              aria-current={active ? "page" : undefined}
              className={`grid min-h-10 grid-cols-[minmax(5rem,9rem)_1fr_auto] items-center gap-3 rounded-[var(--radius-control)] px-2 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] ${active ? "bg-surface-accent-soft" : ""}`}
            >
              <span className="truncate text-sm text-text-muted" title={r.label}>
                {r.label}
              </span>
              <span className="relative block h-2.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]" aria-hidden="true">
                <span
                  className="viz-grow-x absolute inset-y-0 left-0 block rounded-full"
                  style={{ width: `${r.barPct}%`, background: "var(--viz-1)", "--viz-delay": `${i * 40}ms` } as CSSProperties}
                />
              </span>
              <span className="text-right text-sm font-semibold tabular-nums text-text">
                {formatMoney(r.total)} <span className="text-xs font-medium text-text-faint">· %{r.share}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
