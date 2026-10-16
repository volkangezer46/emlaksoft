import Link from "@/components/ui/smart-link";
import { ArrowRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { now } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { currentMonthPeriod, loadAdvisorMetrics } from "@/lib/team/advisor-metrics";
import { hrefAccessible } from "@/lib/nav-config";
import { effectiveCanAccessModule } from "@/lib/permissions-merge";
import type { AppModule } from "@/lib/permissions";
import { afterFirstScreen, type HomeCtx } from "./data";
import { monthProgress, rankTeam, teamDot, teamLine, type TeamStatus } from "./home-metrics";

const MAX_ROWS = 8;
const DOT: Record<TeamStatus, string> = {
  ok: "bg-[var(--pm-success-text)]",
  warn: "bg-amber-500",
  danger: "bg-[var(--pm-danger-text)]",
  none: "bg-[var(--text-faint)]",
};

export function EkipDurumIskelet() {
  return (
    <div role="status" aria-busy="true" className="ds-card ds-pad flex min-h-[15rem] flex-col gap-2">
      <span className="sr-only">Yükleniyor</span>
      <Skeleton className="h-5 w-16" />
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

/**
 * PATRON PANOSU (4) "EKİP" (sadeleştirme planı 2.4 / C08): danışman başına TEK satır + renkli durum noktası (`teamDot`:
 * hareket yok / tempo / çalışıyor) ve tek satır özet. Ayrıntılı tablo "Ofis özeti > Ekip performansı"ndadır.
 * Kaynak `lib/team/advisor-metrics` (kapsam ve örnek veri kuralları orada). Satır kişi sayfasına gider (yetki varsa).
 */
export async function EkipDurum({ ctx }: { ctx: HomeCtx }) {
  await afterFirstScreen(ctx);
  const nowMs = now();
  const supabase = await createClient();
  const res = await loadAdvisorMetrics(supabase, {
    viewer: { userId: ctx.userId, role: ctx.role, perms: ctx.perms },
    tenantId: ctx.tenantId,
    period: currentMonthPeriod(nowMs),
    nowMs,
    withTargets: true,
    sample: ctx.sample,
  });
  const { elapsedPct } = monthProgress(nowMs);
  const rows = rankTeam(res.rows, MAX_ROWS);
  const accessible = (Object.keys(ctx.perms) as AppModule[]).filter((m) => effectiveCanAccessModule(ctx.perms, m));
  const teamOpen = hrefAccessible("/app/ekip", accessible);

  return (
    <section aria-labelledby="ekip-durum-baslik" className="ds-card ds-pad flex h-full flex-col gap-2">
      <header className="flex items-center justify-between gap-2">
        <h2 id="ekip-durum-baslik" className="ds-title">
          Ekip
        </h2>
        {teamOpen ? (
          <Link href="/app/ekip" className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-control)] px-2 text-sm font-semibold text-[var(--accent-text)]">
            Tüm ekip <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </header>
      {res.failed ? (
        <p className="text-sm text-[var(--pm-warn-text)]">Ekip bilgisi şu an okunamadı.</p>
      ) : rows.length === 0 ? (
        <EmptyState
          variant="compact"
          illustration="ekip"
          title="Henüz danışman yok"
          description="Danışman davet edin; her biri burada tek satırda görünür."
          action={teamOpen ? { href: "/app/ekip", label: "Ekibe git" } : undefined}
        />
      ) : (
        <ul className="divide-y divide-line" aria-label="Danışmanların bu ayki durumu">
          {rows.map((r) => {
            const dot = teamDot(r, elapsedPct);
            const body = (
              <>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[dot.status]}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink-950">{r.fullName}</span>
                  <span className="block truncate text-sm text-text-muted">
                    {dot.label} · {teamLine(r)}
                  </span>
                </span>
              </>
            );
            return (
              <li key={r.id} data-ekip-satir="">
                {teamOpen ? (
                  <Link href={`/app/ekip/${r.id}`} className="focus-ring flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-1 py-2 hover:bg-surface-hover">
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-h-11 items-center gap-3 px-1 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
