import Link from "@/components/ui/smart-link";
import { ArrowUpRight, PieChart } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { lossReasonGroupLabel } from "@/lib/loss-reason";

export type ClosedDeal = { stage: string; deal_value: number | null; loss_reason: string | null };

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

/** Son 12 ayda kaybedilen anlaşmaların neden dağılımı (adet + tutar); eski Riskli müşteriler sayfasından taşındı. */
export function LossReasons({ deals, reasonLabels }: { deals: readonly ClosedDeal[]; reasonLabels: Record<string, string> }) {
  const lost = deals.filter((d) => d.stage === "lost");
  const agg = new Map<string, { count: number; value: number }>();
  for (const d of lost) {
    const r = lossReasonGroupLabel(d.loss_reason, reasonLabels);
    const rec = agg.get(r) ?? { count: 0, value: 0 };
    rec.count += 1;
    rec.value += Number(d.deal_value || 0);
    agg.set(r, rec);
  }
  const bars = [...agg.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.count - a.count).slice(0, 6);
  const max = Math.max(1, ...bars.map((b) => b.count));
  const lostRevenue = lost.reduce((s, d) => s + Number(d.deal_value || 0), 0);

  return (
    <section id="kayip-nedenleri" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-amber-600">
            <PieChart className="h-4 w-4" /> Kayıp nedenleri · son 12 ay
          </p>
          <h2 className="mt-1 font-display text-base font-bold text-ink-950">Neden kaybediyoruz?</h2>
        </div>
        <Link href="/app/anlasmalar?asama=lost" className="focus-ring inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
          Kaybedilen anlaşmalar{lost.length > 0 ? ` (${lost.length}${lostRevenue > 0 ? ` · ${money(lostRevenue)}` : ""})` : ""} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      {bars.length === 0 ? (
        <EmptyState
          className="mt-4"
          variant="compact"
          icon={PieChart}
          tone="brand"
          title="Henüz kaybedilen anlaşma kaydı yok"
          description="Bir anlaşma 'kaybedildi' aşamasına taşındığında nedenleri burada dağılım olarak görürsünüz."
          action={{ href: "/app/anlasmalar", label: "Anlaşma panosunu aç" }}
        />
      ) : (
        <div className="mt-4 space-y-3">
          {bars.map((r, i) => (
            <Link key={r.label} href="/app/anlasmalar?asama=lost" className="focus-ring group -m-1 block rounded-[var(--radius-control)] p-1">
              <div className="mb-1 flex justify-between gap-3 text-xs">
                <span className="truncate font-semibold text-ink-950">{r.label}</span>
                <span className="shrink-0 tabular-nums text-text-muted">
                  {r.count} anlaşma{r.value > 0 ? ` · ${money(r.value)}` : ""}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-canvas">
                <div className="bar-live h-full rounded-full bg-danger-500/70" style={{ width: `${(r.count / max) * 100}%`, animationDelay: `${i * 0.08}s` }} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
