import Link from "@/components/ui/smart-link";
import { MapPin, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { loadProjectBuyerMatches } from "@/lib/projects/buyer-matches";
import { tierCls, tierLabel } from "@/lib/matching";
import type { MatchableProject, MatchableUnit } from "@/lib/projects/unit-match";
import { BuyerShareButton } from "./buyer-share-button";

function money(n: number | null) {
  return n == null ? "—" : "₺" + new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n);
}

/**
 * PF-06 — Projenin müsait daireleri için uygun alıcılar (açık satın alma talepleri). Skor eşleşme motorunun kendisi
 * (ofis ağırlıkları, olmazsa olmaz kriterler, gösterim eşiği). Her satır talebin kendisine gider; "Gönder" proje
 * paylaşım linkini İYS izni olan alıcıya WhatsApp'la iletir. Sayfayı bekletmez: Suspense içinde akar.
 */
export async function ProjectBuyers({
  tenantId,
  project,
  units,
  shareEnabled,
  canSeeCustomers,
}: {
  tenantId: string;
  project: MatchableProject;
  units: MatchableUnit[];
  shareEnabled: boolean;
  canSeeCustomers: boolean;
}) {
  const supabase = await createClient();
  const result = await loadProjectBuyerMatches(supabase, { tenantId, project, units });
  const shown = result.buyers.slice(0, 30);

  return (
    <section aria-labelledby="uygun-alicilar" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:p-5">
      <h2 id="uygun-alicilar" className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
        <Users className="h-4 w-4 text-brand-600" /> Uygun alıcılar{result.buyers.length > 0 ? ` (${result.buyers.length})` : ""}
      </h2>
      <p className="mt-1 text-sm text-text-muted">Kriterleri müsait dairelerle uyan açık satın alma talepleri.</p>

      {result.reason === "no_district" ? (
        <p className="mt-4 flex items-start gap-2 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-4 text-sm text-text-muted">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          Eşleşme için projenin ilçesini seçin (&quot;Projeyi düzenle&quot;). İlçesiz projede başka şehirdeki alıcılara öneri yapılmaz.
        </p>
      ) : result.reason === "no_available_units" ? (
        <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-4 text-sm text-text-muted">
          Müsait daire yok; eşleşme yalnız müsait daireler için yapılır.
        </p>
      ) : shown.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-4 text-sm text-text-muted">
          {result.scanned} açık satın alma talebi tarandı; müsait dairelerle uyan yok.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line">
          {shown.map((b) => {
            const customer = Array.isArray(b.demand.customer) ? b.demand.customer[0] : b.demand.customer;
            return (
              <li key={b.demand.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-4">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/app/talepler/${b.demand.id}`}
                      className="focus-ring truncate rounded-[var(--radius-control)] text-sm font-semibold text-ink-950 hover:text-brand-600 hover:underline"
                    >
                      {canSeeCustomers && customer?.full_name ? customer.full_name : "Alıcı talebi"}
                    </Link>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${tierCls(b.tier)}`}>
                      %{b.best} · {tierLabel(b.tier)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {[b.demand.rooms, b.demand.budget_max != null ? `en çok ${money(Number(b.demand.budget_max))}` : null].filter(Boolean).join(" · ") || "Kriter özeti yok"}
                    {" · "}
                    {b.unitCount} daire uyuyor: {b.units.map((u) => u.label).join(", ")}
                  </p>
                </div>
                {shareEnabled && canSeeCustomers && customer?.id ? (
                  <BuyerShareButton projectId={project.id} customerId={customer.id} unitLabels={b.units.map((u) => u.label)} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {result.buyers.length > shown.length || result.truncated ? (
        <p className="mt-2 text-xs text-text-faint">
          {result.buyers.length > shown.length ? `En iyi ${shown.length} alıcı gösteriliyor. ` : ""}
          {result.truncated ? "En yeni 300 açık talep tarandı." : ""}
        </p>
      ) : null}
      {!shareEnabled && shown.length > 0 ? (
        <p className="mt-2 text-xs text-text-faint">Alıcılara link göndermek için paylaşım sayfasını açın.</p>
      ) : null}
    </section>
  );
}
