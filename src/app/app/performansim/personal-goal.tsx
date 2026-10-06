import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { now } from "@/lib/clock";
import { effectiveCanAccessModule, type EffectivePermissions } from "@/lib/permissions-effective";
import { targetPeriodRange } from "@/lib/team/target-actuals";
import { loadTargetActualsLive } from "@/lib/team/advisor-metrics";
import { targetProgressPct } from "@/lib/team/scorecard";
import { RadialGauge } from "@/components/ui/viz";
import { monthElapsedPct } from "../danisman-kpi/month-progress";

const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
const PERIOD_LABEL: Record<string, string> = { monthly: "Aylık", quarterly: "Çeyreklik", yearly: "Yıllık" };

/**
 * Kişisel hedef halkası + dönem ilerleme işaretçisi. Halka GERÇEK hedef oranıdır
 * (`targetProgressPct`, hedefler sayfasıyla aynı formül); halkadaki çentik dönemin ne kadarının
 * geçtiğini gösterir (monthElapsedPct) — çentiğin gerisindeki ilerleme tempo uyarısıdır.
 * Hedef tanımlı değilse ya da modül izni yoksa HİÇBİR ŞEY çizilmez (uydurma yüzde yok).
 * Kazanç yalnız kendi verisi olduğu için `showEarnings` her zaman açıktır (kişi kendi karnesinde).
 */
export async function PersonalGoal({
  userId,
  role,
  tenantId,
  perms,
}: {
  userId: string;
  role: string;
  tenantId: string | null;
  perms: EffectivePermissions;
}) {
  if (!effectiveCanAccessModule(perms, "targets")) return null;
  const supabase = await createClient();
  const nowMs = now();
  const [{ data }, { data: me }] = await Promise.all([
    supabase
      .from("targets")
      .select("id, period, period_start, target_deals, target_revenue, profile_id")
      .eq("profile_id", userId)
      .order("period_start", { ascending: false })
      .limit(24),
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);
  const targets = ((data ?? []) as { id: string; period: string; period_start: string; target_deals: number; target_revenue: number; profile_id: string | null }[]).filter((t) => {
    const r = targetPeriodRange(t.period_start, t.period);
    return nowMs >= r.start && nowMs < r.end;
  });
  if (targets.length === 0) return null;
  // Aylık hedef öncelikli; yoksa içinde bulunulan ilk dönem.
  const t = targets.find((x) => x.period === "monthly") ?? targets[0];
  const live = await loadTargetActualsLive(supabase, {
    viewer: { userId, role, perms },
    tenantId,
    targets: [t],
    names: new Map([[userId, (me?.full_name as string | undefined) ?? ""]]),
  });
  const a = live.get(t.id) ?? { deals: 0, revenue: 0 };
  const tDeals = Number(t.target_deals) || 0;
  const tRev = Number(t.target_revenue) || 0;
  const pct = targetProgressPct({ deals: tDeals, revenue: tRev }, a, true);
  if (pct === null) return null;
  const range = targetPeriodRange(t.period_start, t.period);
  const elapsed = monthElapsedPct(nowMs, range.start, range.end);
  const behind = elapsed !== null && elapsed < 100 && pct < elapsed - 10;

  return (
    <section aria-label="Kişisel hedef" className="ds-card ds-pad h-full">
      <div className="flex flex-wrap items-center gap-6">
        <RadialGauge
          value={pct}
          max={100}
          target={elapsed !== null && elapsed > 0 && elapsed < 100 ? elapsed : undefined}
          size={120}
          stroke={11}
          tone={behind ? "warn" : "accent"}
          format="percent"
          ariaLabel={`${PERIOD_LABEL[t.period] ?? t.period} hedef ilerlemesi yüzde ${pct}${elapsed !== null ? `, dönemin yüzde ${elapsed} kadarı geçti` : ""}`}
        >
          <span className="font-display text-2xl font-extrabold tabular-nums text-text">%{pct}</span>
        </RadialGauge>
        <div className="min-w-56 flex-1">
          <h2 className="font-display text-base font-bold tracking-[-0.015em] text-text">{PERIOD_LABEL[t.period] ?? t.period} hedefim</h2>
          <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {tDeals > 0 ? (
              <div>
                <dt className="text-xs text-text-muted">Anlaşma</dt>
                <dd className="font-semibold tabular-nums text-text">{a.deals} / {tDeals}</dd>
              </div>
            ) : null}
            {tRev > 0 ? (
              <div>
                <dt className="text-xs text-text-muted">Kazanç (tahsil edilen pay)</dt>
                <dd className="font-semibold tabular-nums text-text">{money(a.revenue)} / {money(tRev)}</dd>
              </div>
            ) : null}
          </dl>
          {elapsed !== null ? (
            <p className="mt-2 text-xs tabular-nums text-text-muted">
              Dönemin %{elapsed}&apos;i geçti{behind ? " · ilerleme temponun gerisinde" : ""}
            </p>
          ) : null}
          <Link href="/app/hedefler" className="focus-ring mt-2 inline-block rounded text-xs font-semibold text-accent-text hover:underline">
            Hedeflerime git
          </Link>
        </div>
      </div>
    </section>
  );
}
