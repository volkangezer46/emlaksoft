import Link from "next/link";
import { ArrowUpRight, ChevronRight, Gauge } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Widget } from "../dashboard-widgets";
import { loadLiveListings, type HomeCtx } from "./data";
import { portalHealth } from "./helpers";

/**
 * PORTAL SAĞLIĞI ("Daha fazla", yönetim): genel teyit oranı + portal kırılımı TEK kartta (eski metrik şeridindeki
 * "Teyit sağlığı" buraya birleşti). Kapsam ana ekranla aynı (`ctx`: Ben → yalnız bana atanan portföylerin ilanları).
 * Teyitsiz ilan SAYISI "Dikkat gerektirenler"dedir; burada yalnız oran ve portal dağılımı vardır.
 */
export async function PortalSagligi({ ctx }: { ctx: HomeCtx }) {
  const listings = await loadLiveListings(ctx);
  const { pct, portals } = portalHealth(listings);
  const tone = pct >= 90 ? "success" : pct >= 70 ? "warn" : "danger";

  return (
    <Widget id="portal" className="h-full">
      <section aria-labelledby="portal-baslik" className="ds-card ds-pad h-full">
        <header className="ds-head mb-3">
          <span className="pm-ico pm-t-brand" aria-hidden="true">
            <Gauge />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="portal-baslik" className="ds-title">
              Portal sağlığı
            </h2>
            <p className="ds-sub mt-0.5">Canlı ilanlarda son 7 gün teyit oranı</p>
          </div>
          <Link href="/app/portallar" className="ds-link focus-ring">
            Portallar <ArrowUpRight aria-hidden="true" />
          </Link>
        </header>
        {portals.length === 0 ? (
          <EmptyState variant="compact" illustration="liste" title="Canlı portal kaydı yok" description="Portföyleri portallara bastığınızda teyit durumu burada izlenir." action={{ href: "/app/portallar", label: "Portallara git" }} />
        ) : (
          <>
            <Link href="/app/portallar?durum=teyit" className={`ds-tile ds-lift focus-ring pm-t-${tone} mb-3`}>
              <span className="text-xs text-text-muted">Genel teyit oranı · {listings.length} canlı ilan</span>
              <span className="ds-num text-lg">%{pct}</span>
            </Link>
            <ul className="ds-sep -mx-1.5">
              {portals.map((portal) => (
                <li key={portal.name}>
                  <Link href={`/app/portallar?portal=${encodeURIComponent(portal.name)}`} className="ds-row focus-ring group">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex items-center gap-2 truncate font-semibold text-text">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${portal.tone}`} aria-hidden="true" />
                          {portal.name}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-text-muted">
                          {portal.healthy}/{portal.live} teyitli
                        </span>
                      </span>
                      <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-[var(--surface-sunken)]" aria-hidden="true">
                        <span className={`block h-full rounded-full ${portal.tone}`} style={{ width: `${portal.live ? (portal.healthy / portal.live) * 100 : 0}%` }} />
                      </span>
                    </span>
                    <ChevronRight className="ds-row-chev h-4 w-4" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </Widget>
  );
}
