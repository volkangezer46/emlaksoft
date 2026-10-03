import Link from "next/link";
import { Bell, Radar } from "lucide-react";
import { moneyTry } from "@/lib/leak-shield";
import { Widget } from "../dashboard-widgets";
import { loadClosures, loadLiveListings, type HomeCtx } from "./data";
import { overdueListingsOf } from "./helpers";
import { PanelLink } from "./ortak";

export async function KayipKacak({ ctx }: { ctx: HomeCtx }) {
  const [listings, closures] = await Promise.all([loadLiveListings(), loadClosures(ctx)]);
  const overdueListings = overdueListingsOf(listings);

  return (
    <Widget id="kayip" className="h-full">
      <section className="pm-bx h-full p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-danger-500" />
            <h2 className="font-display font-bold text-ink-950">Kayıp-kaçak</h2>
          </div>
          <PanelLink href="/app/kayip-kacak">Detay</PanelLink>
        </div>
        <div className="mt-4 space-y-3 text-sm">
          {overdueListings.length > 0 ? (
            <Link
              href="/app/portallar?durum=teyit"
              className="focus-ring group block rounded-[var(--radius-card)] border border-warn-500/30 bg-warn-500/5 px-3 py-3 transition hover:border-warn-500/50 hover:bg-warn-500/10"
            >
              <p className="flex items-center justify-between gap-2 font-semibold text-ink-950">
                {overdueListings.length} ilanda 7+ gün teyit yok
                <span className="hover-action shrink-0 text-xs font-bold text-brand-600 opacity-0 transition group-hover:opacity-100">
                  İncele →
                </span>
              </p>
              <p className="mt-1 text-text-muted">Portal Kontrol’den teyit edin</p>
            </Link>
          ) : (
            <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/5 px-3 py-3">
              <Bell className="h-4 w-4 text-mint-600" />
              <p className="font-semibold text-mint-600">Teyit kuyruğu temiz</p>
            </div>
          )}
          {closures.recent
            .filter((c) => Number(c.estimated_lost_commission || 0) > 0)
            .slice(0, 2)
            .map((c) => {
              const listing = Array.isArray(c.portal_listing) ? c.portal_listing[0] : c.portal_listing;
              return (
                <Link
                  key={c.id}
                  href={`/app/kayip-kacak?neden=${encodeURIComponent(c.reason ?? "")}`}
                  className="focus-ring group block rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/5 px-3 py-3 transition hover:border-danger-500/50 hover:bg-danger-500/10"
                >
                  <p className="flex items-center justify-between gap-2 font-semibold text-ink-950">
                    {c.reason}
                    <span className="hover-action shrink-0 text-xs font-bold text-brand-600 opacity-0 transition group-hover:opacity-100">
                      İncele →
                    </span>
                  </p>
                  <p className="mt-1 text-text-muted">
                    {listing?.portal_name ?? "Portal"}
                    {listing?.portal_listing_id ? ` #${listing.portal_listing_id}` : ""} · −
                    {moneyTry(Number(c.estimated_lost_commission || 0))}
                  </p>
                </Link>
              );
            })}
        </div>
      </section>
    </Widget>
  );
}
