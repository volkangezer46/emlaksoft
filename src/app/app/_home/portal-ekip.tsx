import Link from "next/link";
import { ArrowUpRight, Gauge } from "lucide-react";
import { Widget } from "../dashboard-widgets";
import { loadLiveListings } from "./data";
import { portalHealth } from "./helpers";

/**
 * Portal sağlığı ("Daha fazla" bölümü). Ekip liderliği tablosu `ekip-performans.tsx`'e taşındı
 * (danışman, görüşme, randevu, teklif, anlaşma, hedef %, durum).
 */
export async function PortalSagligi() {
  const listings = await loadLiveListings();
  // Genel teyit yüzdesi metrik şeridindedir (teyit sağlığı); burada yalnız portal kırılımı.
  const { portals } = portalHealth(listings);

  return (
    <Widget id="portal" className="h-full">
      <section className="pm-bx h-full p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
              <Gauge className="h-4 w-4" /> Yayın ağı
            </p>
            <h2 className="mt-1 font-display font-bold text-ink-950">Portal sağlığı</h2>
          </div>
          <Link
            href="/app/portallar"
            className="focus-ring rounded-[var(--radius-control)] text-xs font-semibold text-brand-600"
          >
            Portallar
          </Link>
        </div>
        <div className="mt-5 space-y-3">
          {portals.length === 0 ? (
            <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-3 py-8 text-center text-sm text-text-muted">
              Canlı portal kaydı yok.
            </p>
          ) : (
            portals.map((portal) => (
              <Link
                key={portal.name}
                href={`/app/portallar?portal=${encodeURIComponent(portal.name)}`}
                className="focus-ring group block rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3 py-2.5 transition hover:border-brand-300 hover:bg-surface"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 font-semibold text-ink-950">
                    <span className={`h-2 w-2 rounded-full ${portal.tone}`} />
                    {portal.name}
                  </span>
                  <span className="flex items-center gap-1.5 text-text-faint">
                    {portal.healthy}/{portal.live} teyitli
                    <ArrowUpRight className="hover-action h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                  </span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                  <div
                    className={`h-full rounded-full ${portal.tone}`}
                    style={{ width: `${portal.live ? (portal.healthy / portal.live) * 100 : 0}%` }}
                  />
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
    </Widget>
  );
}
