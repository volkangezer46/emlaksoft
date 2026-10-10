import { PLANS, type PlanDef } from "@/lib/billing/plans";
import { buildComparison } from "@/lib/pricing-page-model";

/**
 * Paket karşılaştırma tablosu: satırlar plans.ts + page-gates.ts'ten üretilir.
 * Tekrarlayan işaretler (✓ / –) tabloda BİR kez tanımlanan <symbol>'lere `<use>` ile bağlanır: yüzlerce hücrede
 * SVG yolu yeniden basılmaz (HTML + RSC yükü küçülür). Çizgi stili `.sprite-ic` (globals.css), lucide ile aynıdır.
 */
export function ComparisonTable({ plans = PLANS, efValuationCost, efLive = false }: { plans?: readonly PlanDef[]; efValuationCost?: number; efLive?: boolean } = {}) {
  const groups = buildComparison(plans, { efValuationCost, efLive });
  return (
    <div
      className="relative overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-sm)]"
      role="region"
      aria-label="Paket karşılaştırma tablosu, yatay kaydırılabilir"
      tabIndex={0}
    >
      <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          <symbol id="cmp-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></symbol>
          <symbol id="cmp-minus" viewBox="0 0 24 24"><path d="M5 12h14" /></symbol>
        </defs>
      </svg>
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <caption className="sr-only">Paketlerin fiyat, limit ve özellik karşılaştırması</caption>
        <thead>
          <tr className="border-b border-line bg-surface-2">
            <th scope="col" className="sticky left-0 z-10 w-[34%] bg-surface-2 px-4 py-3 font-semibold text-ink-950">
              Özellik
            </th>
            {plans.map((p) => (
              <th key={p.id} scope="col" className="px-3 py-3 text-center font-semibold text-ink-950">
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.title}>
            <tr>
              <th scope="colgroup" colSpan={plans.length + 1} className="bg-brand-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-700">
                {g.title}
              </th>
            </tr>
            {g.rows.map((row) => (
              <tr key={row.label} className="border-t border-line">
                <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-3 font-medium text-ink-950">
                  {row.label}
                </th>
                {row.cells.map((cell, i) => (
                  <td key={plans[i]!.id} className="px-3 py-3 text-center tabular-nums text-text">
                    {cell.included === undefined ? (
                      cell.text
                    ) : cell.included ? (
                      <>
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="sprite-ic mx-auto h-4 w-4 text-mint-700"><use href="#cmp-check" /></svg>
                        <span className="sr-only">{cell.text}</span>
                      </>
                    ) : (
                      <>
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="sprite-ic mx-auto h-4 w-4 text-text-muted"><use href="#cmp-minus" /></svg>
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
