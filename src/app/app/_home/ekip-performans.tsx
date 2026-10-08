import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Users } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { now, trDayKey } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { currentMonthPeriod, loadAdvisorMetrics } from "@/lib/team/advisor-metrics";
import type { HomeCtx } from "./data";
import { monthProgress, rankTeam, teamStatus, TEAM_STATUS_LABEL, type TeamStatus } from "./home-metrics";

const MAX_ROWS = 8;
/** 8 satır * 38px + başlık: iskelet ve içerik aynı yükseklikte (CLS yok). */
const CARD_MIN = "lg:min-h-[22rem]";

export function EkipPerformansIskelet() {
  return (
    <div role="status" aria-busy="true" className={`ds-card ds-pad ${CARD_MIN}`}>
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

/** Sıfır çıkmaz metrik: her hücre danışman + metrik süzgeçli hedefe gider (dokunma hedefi satır yüksekliği kadar). */
function CellLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link href={href} aria-label={label} className="focus-ring -mx-1 inline-flex min-h-8 min-w-8 touch:min-h-11 touch:min-w-11 items-center justify-end rounded-sm px-1 hover:text-[var(--accent-text)] hover:underline">
      {children}
    </Link>
  );
}

/**
 * EKİP PERFORMANSI tablosu (bu ay): danışman, görüşme, randevu, teklif, anlaşma, hedef %, durum noktası.
 * Kaynak tek yerde: `lib/team/advisor-metrics` (kapsam, kazanç gizliliği ve örnek veri kuralları orada).
 * Satır 38px, sütunlar hizalı (tabular-nums); ad kişi sayfasına, her sayı danışman + metrik süzgeçli listeye gider.
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
  // Hücre hedefleri sayımla aynı pencere: bu ayın başı → bugün (teklif created_at, TR günü).
  const monthFrom = ctx.monthStartKey;
  const today = trDayKey(nowMs);

  return (
    <section aria-labelledby="ekip-baslik" className={`ds-card ds-pad ${CARD_MIN} flex h-full flex-col`}>
      <header className="ds-head mb-2">
        <span className="pm-ico pm-t-brand" aria-hidden="true">
          <Users />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="ekip-baslik" className="ds-title">
            Ekip performansı
          </h2>
          <p className="ds-sub mt-0.5">Bu ay görüşme, randevu, teklif ve hedef</p>
        </div>
        <Link href="/app/ekip" className="ds-link focus-ring">
          Tüm ekip <ArrowUpRight aria-hidden="true" />
        </Link>
      </header>
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
                    <td>
                      <CellLink href={`/app/ekip/${r.id}`} label={`${r.fullName}: bu ay ${r.callCount} görüşme`}>
                        {r.callCount}
                      </CellLink>
                    </td>
                    <td className="pm-cq-hide-narrow">
                      <CellLink href={`/app/randevular?danisman=${r.id}`} label={`${r.fullName}: randevuları`}>
                        {r.appointCount}
                      </CellLink>
                    </td>
                    <td>
                      <CellLink href={`/app/teklifler?danisman=${r.id}&from=${monthFrom}&to=${today}`} label={`${r.fullName}: bu ay ${r.offerCount} teklif`}>
                        {r.offerCount}
                      </CellLink>
                    </td>
                    <td className="font-semibold text-ink-950">
                      <CellLink
                        href={`/app/teklifler?danisman=${r.id}&durum=accepted&from=${monthFrom}&to=${today}`}
                        label={`${r.fullName}: bu ay ${r.dealCount} kabul edilen teklif`}
                      >
                        {r.dealCount}
                      </CellLink>
                    </td>
                    <td>
                      {r.targetPct === null ? (
                        <span className="text-text-faint" title="Bu ay için hedef tanımlı değil">—</span>
                      ) : (
                        <CellLink href="/app/hedefler" label={`${r.fullName}: hedef gerçekleşmesi yüzde ${r.targetPct}`}>
                          %{r.targetPct}
                        </CellLink>
                      )}
                    </td>
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
