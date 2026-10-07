import Link from "@/components/ui/smart-link";
import { ArrowUpRight, ChevronRight, Radar } from "lucide-react";
import { moneyTry } from "@/lib/leak-shield";
import { createClient } from "@/lib/supabase/server";
import { getControlSummary } from "@/lib/listing-control/server/readers";
import type { Db } from "@/lib/listing-control/server/db";
import { kpiHref, sumSummaryRows } from "@/components/listing-control/helpers";
import { EmptyState } from "@/components/ui/empty-state";
import { Widget } from "../dashboard-widgets";
import { loadClosures, type HomeCtx } from "./data";

/**
 * KAÇAN KOMİSYONLAR (yönetim alt satırı): portalda kaybolan ilan sayısı (İlan Kontrol özetiyle TEK KAYNAK) + son kapanışlarda
 * tahmini kaçan komisyon. Teyitsiz ilan sayısı burada YOK: "Dikkat gerektirenler" listesindedir (aynı sayı iki yerde yok).
 * Kapsam: İlan Kontrol özeti rol kapsamını kendisi uygular; kapanışlar RLS ile ofis kapsamındadır.
 */
export async function KayipKacak({ ctx }: { ctx: HomeCtx }) {
  const [closures, control] = await Promise.all([
    loadClosures(ctx),
    // İlan Kontrol ile TEK KAYNAK: "portalda kayıp" sayısı İlan Kontrol özetiyle (aynı RPC, aynı rol kapsamı) birebir aynıdır.
    createClient().then((c) => getControlSummary(c as unknown as Db, "tenant")),
  ]);
  const portalMissing = control.available ? sumSummaryRows(control.rows).portal_missing : 0;
  const lost = closures.recent.filter((c) => Number(c.estimated_lost_commission || 0) > 0).slice(0, 3);

  return (
    <Widget id="kayip" className="h-full">
      <section aria-labelledby="kayip-baslik" className="ds-card ds-pad h-full">
        <header className="ds-head mb-3">
          <span className="pm-ico pm-t-danger" aria-hidden="true">
            <Radar />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="kayip-baslik" className="ds-title">
              Kaçan komisyonlar
            </h2>
            <p className="ds-sub mt-0.5">Portal kayıpları ve kapanan ilanlar</p>
          </div>
          <Link href="/app/kayip-kacak" className="ds-link focus-ring">
            Detay <ArrowUpRight aria-hidden="true" />
          </Link>
        </header>
        {portalMissing === 0 && lost.length === 0 ? (
          <EmptyState variant="compact" illustration="basari" title="Kaçan komisyon kaydı yok" description="Portal kaybı ya da tahmini kayıplı kapanış oluşunca burada görünür." />
        ) : (
          <ul className="ds-sep -mx-1.5">
            {portalMissing > 0 ? (
              <li>
                <Link href={kpiHref("portal_missing")} className="ds-row focus-ring group">
                  <span className="ds-row-ico pm-t-danger" aria-hidden="true">
                    <Radar />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-text">{portalMissing} portföyde portal ilanı kayıp</span>
                    <span className="block truncate text-xs text-text-muted">İlan Kontrol Merkezi: doğrulanan kayıplar</span>
                  </span>
                  <ChevronRight className="ds-row-chev h-4 w-4" aria-hidden="true" />
                </Link>
              </li>
            ) : null}
            {lost.map((c) => {
              const listing = Array.isArray(c.portal_listing) ? c.portal_listing[0] : c.portal_listing;
              return (
                <li key={c.id}>
                  <Link href={`/app/kayip-kacak?neden=${encodeURIComponent(c.reason ?? "")}`} className="ds-row focus-ring group">
                    <span className="ds-row-ico pm-t-warn" aria-hidden="true">
                      <Radar />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-text">{c.reason}</span>
                      <span className="block truncate text-xs text-text-muted">
                        {listing?.portal_name ?? "Portal"}
                        {listing?.portal_listing_id ? ` #${listing.portal_listing_id}` : ""}
                      </span>
                    </span>
                    <span className="ds-num shrink-0 text-sm text-[var(--pm-danger-text)]">−{moneyTry(Number(c.estimated_lost_commission || 0))}</span>
                    <ChevronRight className="ds-row-chev h-4 w-4" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Widget>
  );
}
