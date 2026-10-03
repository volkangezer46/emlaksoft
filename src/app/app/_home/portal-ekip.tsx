import Link from "next/link";
import { ArrowUpRight, Gauge, Trophy } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { moneyTry } from "@/lib/leak-shield";
import { Widget } from "../dashboard-widgets";
import { loadDeals, loadLiveListings, loadProfiles, type HomeCtx } from "./data";
import { portalHealth, teamLeaders } from "./helpers";
import { PanelLink } from "./ortak";

export async function PortalSagligi() {
  const listings = await loadLiveListings();
  const { portals, pct } = portalHealth(listings);

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
            className="focus-ring rounded-[var(--radius-control)] font-display text-2xl font-extrabold text-mint-600 transition hover:text-mint-500"
          >
            %{pct}
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

export async function Ekip({ ctx }: { ctx: HomeCtx }) {
  const [deals, profiles] = await Promise.all([loadDeals(), loadProfiles()]);
  const team = teamLeaders(deals, profiles);

  return (
    <Widget id="ekip" className="h-full">
      <section className="pm-bx h-full p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-amber-500">
              <Trophy className="h-4 w-4" /> Ekip performansı
            </p>
            <h2 className="mt-1 font-display font-bold text-ink-950">Anlaşma değeri liderliği</h2>
          </div>
          <PanelLink href="/app/ekip">Ekip</PanelLink>
        </div>
        <div className="mt-5 space-y-3">
          {team.length === 0 ? (
            <EmptyState
              variant="compact"
              illustration="ekip"
              title="Atanmış anlaşma yok"
              description="Satış hattından anlaşma ekleyin."
              action={{ href: "/app/anlasmalar", label: "Anlaşmalara git" }}
            />
          ) : (
            team.map((member, index) => (
              <div
                key={member.id}
                className="group relative flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3 transition hover:border-brand-300 hover:bg-surface"
              >
                <Link
                  href={`/app/ekip/${member.id}`}
                  className="focus-ring absolute inset-0 z-0 rounded-[var(--radius-card)]"
                  aria-label={member.name}
                />
                <span
                  className={`grid h-6 w-6 place-items-center rounded-full text-xs font-extrabold ${
                    index === 0 ? "bg-amber-400 text-ink-950" : "bg-ink-950/5 text-text-muted"
                  }`}
                >
                  {index + 1}
                </span>
                <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-[image:var(--grad-brand)] text-xs font-bold text-white">
                  {member.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-ink-950">{member.name}</p>
                  <p className="truncate text-xs text-text-faint">{member.role}</p>
                </div>
                <p className="hover-action-hide text-xs font-bold text-ink-950 transition group-hover:opacity-0">{moneyTry(member.value)}</p>
                {!ctx.tvMode && (
                  <Link
                    href="/app/danisman-kpi"
                    className="hover-action focus-ring absolute right-3 z-10 rounded-[var(--radius-control)] bg-brand-600/10 px-2 py-1 text-xs font-bold text-brand-600 opacity-0 transition hover:bg-brand-600/20 group-hover:opacity-100"
                  >
                    KPI →
                  </Link>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </Widget>
  );
}
