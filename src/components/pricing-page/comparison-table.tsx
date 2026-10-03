import { Check, Minus } from "lucide-react";
import { PLANS } from "@/lib/billing/plans";
import { buildComparison } from "@/lib/pricing-page-model";

/** Paket karşılaştırma tablosu: satırlar plans.ts + page-gates.ts'ten üretilir. */
export function ComparisonTable() {
  const groups = buildComparison();
  return (
    <div
      className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-sm)]"
      role="region"
      aria-label="Paket karşılaştırma tablosu, yatay kaydırılabilir"
      tabIndex={0}
    >
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <caption className="sr-only">Paketlerin fiyat, limit ve özellik karşılaştırması</caption>
        <thead>
          <tr className="border-b border-line bg-surface-2">
            <th scope="col" className="sticky left-0 z-10 w-[34%] bg-surface-2 px-4 py-3 font-semibold text-ink-950">
              Özellik
            </th>
            {PLANS.map((p) => (
              <th key={p.id} scope="col" className="px-3 py-3 text-center font-semibold text-ink-950">
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.title}>
            <tr>
              <th scope="colgroup" colSpan={PLANS.length + 1} className="bg-brand-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-700">
                {g.title}
              </th>
            </tr>
            {g.rows.map((row) => (
              <tr key={row.label} className="border-t border-line">
                <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-3 font-medium text-ink-950">
                  {row.label}
                </th>
                {row.cells.map((cell, i) => (
                  <td key={PLANS[i]!.id} className="px-3 py-3 text-center tabular-nums text-text">
                    {cell.included === undefined ? (
                      cell.text
                    ) : cell.included ? (
                      <>
                        <Check aria-hidden className="mx-auto h-4 w-4 text-mint-700" />
                        <span className="sr-only">{cell.text}</span>
                      </>
                    ) : (
                      <>
                        <Minus aria-hidden className="mx-auto h-4 w-4 text-text-muted" />
                        <span className="sr-only">{cell.text}</span>
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
