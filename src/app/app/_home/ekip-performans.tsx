import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { now } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { currentMonthPeriod, loadAdvisorMetrics } from "@/lib/team/advisor-metrics";
import type { HomeCtx } from "./data";
import { monthProgress, rankTeam, teamStatus, TEAM_STATUS_LABEL, type TeamStatus } from "./home-metrics";

const MAX_ROWS = 8;
/** 8 satır * 38px + başlık: iskelet ve içerik aynı yükseklikte (CLS yok). */
const CARD_MIN = "min-h-[22rem]";

export function EkipPerformansIskelet() {
  return (
    <div role="status" aria-busy="true" className={`pm-c1 ${CARD_MIN} p-4`}>
      <span className="sr-only">Yükleniyor</span>
      <Skeleton className="h-3 w-40" />
      <div className="mt-3 space-y-1.5">
        {Array.from({ length: MAX_ROWS }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}

const DOT: Record<TeamStatus, string> = { ok: "pm-t-success", warn: "pm-t-warn", danger: "pm-t-danger", none: "pm-t-neutral" };

/**
 * EKİP PERFORMANSI tablosu (bu ay): danışman, görüşme, randevu, teklif, anlaşma, hedef %, durum noktası.
 * Kaynak tek yerde: `lib/team/advisor-metrics` (kapsam, kazanç gizliliği ve örnek veri kuralları orada).
 * Satır 38px, sütunlar hizalı (tabular-nums), tek eylem = danışman adı (kişi sayfası); satır içi başka eylem yok.
 */
export async function EkipPerformans({ ctx }: { ctx: HomeCtx }) {
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

  return (
    <section aria-labelledby="ekip-baslik" className={`pm-c1 ${CARD_MIN} flex h-full flex-col p-4`}>
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 id="ekip-baslik" className="pm-bx-eyebrow">
          Ekip performansı · bu ay
        </h2>
        <Link href="/app/ekip" className="focus-ring rounded-[var(--radius-control)] px-1 text-xs font-semibold text-[var(--accent-text)]">
          Tüm ekip
        </Link>
      </div>
      {res.failed ? (
        <p className="mt-3 px-1 text-sm text-[var(--pm-warn-text)]">Ekip metrikleri şu an okunamadı; sayılar gösterilmiyor.</p>
      ) : rows.length === 0 ? (
        <EmptyState
          variant="compact"
          illustration="ekip"
          title="Henüz ekip verisi yok"
          description="Danışman ekleyin; görüşme, randevu ve anlaşmalar burada tablo olur."
          action={{ href: "/app/ekip", label: "Ekibe git" }}
        />
      ) : (
        <div className="pm-cq mt-2 overflow-x-auto">
          <table className="pm-tbl">
            <caption className="sr-only">Danışman bazında bu ayın görüşme, randevu, teklif ve anlaşma sayıları ile hedef gerçekleşmesi</caption>
            <thead>
              <tr>
                <th scope="col">Danışman</th>
                <th scope="col">Görüşme</th>
                <th scope="col" className="pm-cq-hide-narrow">Randevu</th>
                <th scope="col">Teklif</th>
                <th scope="col">Anlaşma</th>
                <th scope="col">Hedef</th>
                <th scope="col">
                  <span className="sr-only">Durum</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = teamStatus(r.targetPct, elapsedPct);
                return (
                  <tr key={r.id}>
                    <th scope="row">
                      <Link href={`/app/ekip/${r.id}`} className="focus-ring rounded-sm" title={r.fullName}>
                        {r.fullName}
                      </Link>
                    </th>
                    <td>{r.callCount}</td>
                    <td className="pm-cq-hide-narrow">{r.appointCount}</td>
                    <td>{r.offerCount}</td>
                    <td className="font-semibold text-ink-950">{r.dealCount}</td>
                    <td>{r.targetPct === null ? <span className="text-text-faint" title="Bu ay için hedef tanımlı değil">—</span> : `%${r.targetPct}`}</td>
                    <td>
                      <span className={`pm-dot ${DOT[st]}`} title={TEAM_STATUS_LABEL[st]} aria-hidden="true" />
                      <span className="sr-only">{TEAM_STATUS_LABEL[st]}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-auto px-1 pt-3 text-xs text-text-muted">
        {res.sampleLabel ? `${res.sampleLabel} · ` : ""}
        {res.partial ? "Tarama sınırına ulaşıldı, sayılar eksik olabilir · " : ""}
        Ayın %{elapsedPct}&apos;i geçti
      </p>
    </section>
  );
}
