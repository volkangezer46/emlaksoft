import Link from "@/components/ui/smart-link";
import { AlertTriangle, Rocket, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Avatar } from "@/components/ui/avatar";
import { SCORE_RULE_KEYS, SCORE_RULE_LABELS } from "@/lib/gamification";
import { LEAGUE_ROLES, loadLeagueData } from "@/lib/gamification-query";
import { loadChallengeBoard } from "@/lib/league/challenge-load";
import { lowActivityAdvisors } from "@/lib/league/coach";
import { evidenceHref } from "@/lib/league/evidence";
import { currentLeaguePeriod } from "@/lib/league/periods";

/**
 * Ekip karnesi — Lig özeti (yönetici): bu ayın PUAN dağılımı (kimin puanı hangi kalemden geliyor),
 * düşük aktivite uyarısı (kanıtlı: puan + ofis medyanı + dönemin geçen payı) ve meydan okuma yönetimine giriş.
 * Yalnız puan ve adet; ciro/komisyon tutarı yok (P12). Her satır ilgili kayıt listesine/danışmana gider.
 */
export async function LigOzeti({ tenantId, nowMs }: { tenantId: string | null; nowMs: number }) {
  if (!tenantId) return null;
  const supabase = await createClient();
  const period = currentLeaguePeriod("month", nowMs);
  const todayIso = new Date(nowMs).toISOString().slice(0, 10);
  const league = await loadLeagueData(supabase, { period, tenantId, todayIso, nowMs });
  const racers = league.ranked.filter((r) => LEAGUE_ROLES.includes((league.agents.find((a) => a.id === r.staffId)?.role ?? "") as (typeof LEAGUE_ROLES)[number]));
  if (racers.length === 0) return null;

  const nameOf = (id: string) => league.agents.find((a) => a.id === id)?.fullName ?? "Danışman";
  const max = Math.max(1, ...racers.map((r) => r.total));
  const elapsed = Math.max(0, Math.min(1, (nowMs - league.range.startMs) / (league.range.endMs - league.range.startMs)));
  const low = lowActivityAdvisors(
    racers.map((r) => ({ staffId: r.staffId, name: nameOf(r.staffId), total: r.total, activityCount: r.activityCount })),
    elapsed,
  );
  const cards = await loadChallengeBoard(supabase, {
    tenantId,
    agentIds: new Set(league.agents.map((a) => a.id)),
    includeSample: league.includeSample,
    nowMs,
  });
  const live = cards.filter((c) => c.state === "live");

  return (
    <section aria-labelledby="lig-ozet-baslik" className="surface-card space-y-4 rounded-[var(--radius-panel)] p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-amber-600">
            <Trophy className="h-4 w-4" aria-hidden="true" /> Lig puan dağılımı
          </p>
          <h2 id="lig-ozet-baslik" className="mt-0.5 font-display text-base font-bold text-text first-letter:uppercase">
            {league.range.label}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/app/lig?donem=${period}&sekme=meydan`}
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:bg-surface-2 hover:text-text"
          >
            <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
            Meydan okumalar{live.length > 0 ? ` (${live.length} süren)` : ""}
          </Link>
          <Link
            href={`/app/lig?donem=${period}`}
            className="focus-ring press rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:bg-surface-2 hover:text-text"
          >
            Lig tablosu
          </Link>
        </div>
      </header>

      {low.length > 0 ? (
        <div className="rounded-[var(--radius-card)] border border-amber-400/50 bg-amber-400/10 p-3">
          <p className="flex items-center gap-2 text-xs font-bold text-amber-700">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Düşük aktivite uyarısı
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {low.map((f) => (
              <li key={f.staffId}>
                <Link href={f.href} className="focus-ring rounded text-sm text-text hover:text-accent-text hover:underline">
                  {f.evidence}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="space-y-2">
        {racers.map((r) => {
          const top = SCORE_RULE_KEYS.filter((k) => r.breakdown[k].points > 0)
            .sort((a, b) => r.breakdown[b].points - r.breakdown[a].points)
            .slice(0, 3);
          return (
            <li key={r.staffId} className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,14rem)_1fr_auto]">
              <Link
                href={`/app/ekip/${r.staffId}`}
                className="focus-ring flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] text-sm font-semibold text-text hover:text-accent-text"
              >
                <Avatar name={nameOf(r.staffId)} size="sm" />
                <span className="truncate">{nameOf(r.staffId)}</span>
              </Link>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-line"
                role="progressbar"
                aria-label={`${nameOf(r.staffId)} puanı`}
                aria-valuemin={0}
                aria-valuemax={max}
                aria-valuenow={r.total}
              >
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((r.total / max) * 100)}%` }} />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1">
                <span className="numeric mr-1 font-display text-sm font-extrabold text-accent-text">{r.total}</span>
                {top.map((k) => (
                  <Link
                    key={k}
                    href={evidenceHref(k, r.staffId)}
                    className="focus-ring rounded-full border border-line bg-canvas px-2 py-0.5 text-xs font-semibold text-text-muted hover:text-accent-text"
                    title={`${r.breakdown[k].points} puan`}
                  >
                    {SCORE_RULE_LABELS[k]} {r.breakdown[k].count}
                  </Link>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
