import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Layers, Tag } from "lucide-react";
import { differenceCards } from "@/lib/portal-transfer/gaps";
import { getDb } from "@/components/listing-control/readers";
import { loadPortalGaps } from "@/components/listing-control/portal-gap-readers";
import { kpiHref, type SummaryNumbers } from "@/components/listing-control/helpers";
import { Panel } from "@/components/listing-control/ui-parts";

/**
 * "Portal farkları" (İlan Kontrol ana ekranı): EKSİK PORTAL (yayında portföy, ofisin kullandığı portalda ilanı yok) ve
 * FİYAT / DURUM farkı kartları. Veri yoksa kart yok; hiçbir kart ölü değildir: her biri aynı kaynaktan filtrelenmiş hedefe gider
 * (eksik portal → `/app/ilan-kontrol/eksik-portal?portal=…`, fark kartları → KPI listesi).
 */
export async function PortalGapSection({ summary }: { summary: Pick<SummaryNumbers, "price_mismatch" | "portal_missing"> }) {
  const db = await getDb();
  const { gaps } = await loadPortalGaps(db);
  const diffs = differenceCards(summary, (k) => kpiHref(k));
  if (gaps.length === 0 && diffs.length === 0) return null;
  return (
    <Panel title="Portal farkları" description="Portföy ile portallar arasındaki farklar; her kart ilgili listeye gider.">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {gaps.map((g) => (
          <li key={g.portal}>
            <Link
              href={`/app/ilan-kontrol/eksik-portal?portal=${g.portal}`}
              className="focus-ring press group flex h-full min-h-11 items-start gap-3 rounded-[var(--radius-card)] border border-line bg-canvas p-3 transition hover:border-brand-400"
            >
              <Layers className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-2xl font-semibold tabular-nums text-text">{g.missing.length}</span>
                <span className="block text-sm font-medium text-text">{g.label}&apos;te yok</span>
                <span className="block text-xs text-text-muted">Yayındaki portföy bu portalda görünmüyor</span>
              </span>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-text-faint transition group-hover:text-brand-600" aria-hidden />
            </Link>
          </li>
        ))}
        {diffs.map((d) => (
          <li key={d.key}>
            <Link
              href={d.href}
              className="focus-ring press group flex h-full min-h-11 items-start gap-3 rounded-[var(--radius-card)] border border-line bg-canvas p-3 transition hover:border-brand-400"
            >
              <Tag className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-2xl font-semibold tabular-nums text-text">{d.count}</span>
                <span className="block text-sm font-medium text-text">{d.label}</span>
                <span className="block text-xs text-text-muted">{d.hint}</span>
              </span>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-text-faint transition group-hover:text-brand-600" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
