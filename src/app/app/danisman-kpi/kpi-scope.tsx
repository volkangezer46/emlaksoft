import Link from "@/components/ui/smart-link";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterSelect } from "@/components/ui/list-kit";
import type { createClient } from "@/lib/supabase/server";
import { now } from "@/lib/clock";
import { loadReportScopeContext, type ReportScopeContext } from "../raporlar/_parts/report-scope";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type KpiScope = {
  ctx: ReportScopeContext;
  /** Kapsamdaki danışman kimlikleri; kapsam seçilmemişse null (tüm ekip). */
  members: Set<string> | null;
  /** URL'e taşınacak kapsam parametreleri (sube/takim). */
  params: Record<string, string>;
};

/**
 * OA3: Danışman karnesi ve Kıyas için şube/takım kapsamı (`?sube=&takim=`). Kural Raporlar ile aynı
 * (`loadReportScopeContext`): yönetim serbest seçer, takım lideri kendi takımına kilitlidir, diğer rollerde seçici yok.
 */
export async function resolveKpiScope(
  supabase: Supabase,
  input: { sp: Record<string, string | string[] | undefined>; role: string; userId: string; tenantId: string | null },
): Promise<KpiScope> {
  // Karnede danışman tek tek seçilmez (tablo zaten kişi bazlı): ?danisman= yok sayılır.
  const sp = { ...input.sp, danisman: undefined };
  const ctx = await loadReportScopeContext(supabase, { ...input, sp, nowMs: now() });
  const { branchId, teamId } = ctx.scope;
  const params: Record<string, string> = {};
  if (branchId) params.sube = branchId;
  if (teamId && !ctx.lockedTeam) params.takim = teamId;
  if (!branchId && !teamId) return { ctx, members: null, params };
  const members = new Set(
    ctx.advisors.filter((a) => (!branchId || a.branchId === branchId) && (!teamId || a.teamId === teamId)).map((a) => a.id),
  );
  return { ctx, members, params };
}

/** Kapsam seçici (GET formu; istemci JS yok). `keep`: korunacak diğer parametreler (ay, görünüm, sıralama). */
export function KpiScopeFilter({ path, scope, keep }: { path: string; scope: KpiScope; keep: Record<string, string | undefined> }) {
  const { ctx } = scope;
  if (!ctx.canPick || ctx.lockedTeam) {
    return ctx.lockedTeam ? (
      <p className="text-xs text-text-muted">
        Kapsam: <span className="font-semibold text-text">{ctx.lockedTeam.name} takımı</span>
      </p>
    ) : null;
  }
  if (ctx.branches.length === 0 && ctx.teams.length === 0) return null;
  const hidden = Object.entries(keep).filter((e): e is [string, string] => Boolean(e[1]));
  const clearQs = new URLSearchParams(hidden).toString();
  return (
    <details className="no-print rounded-[var(--radius-card)] border border-line bg-surface" open={Boolean(ctx.scopeLabel) || undefined}>
      <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[var(--radius-card)] px-3 text-xs font-semibold text-text-muted hover:bg-surface-hover [&::-webkit-details-marker]:hidden">
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Şube ve takıma göre daralt
        {ctx.scopeLabel ? <span className="ml-auto truncate rounded-full bg-surface-accent-soft px-2 py-0.5 text-accent-text">{ctx.scopeLabel}</span> : null}
      </summary>
      <form method="get" action={path} className="grid gap-2 border-t border-line p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        {hidden.map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {ctx.branches.length > 0 ? (
          <FilterSelect
            name="sube"
            label="Şube"
            value={ctx.scope.branchId ?? ""}
            options={[{ value: "", label: "Tüm şubeler" }, ...ctx.branches.map((b) => ({ value: b.id, label: b.name }))]}
          />
        ) : null}
        {ctx.teams.length > 0 ? (
          <FilterSelect
            name="takim"
            label="Takım"
            value={ctx.scope.teamId ?? ""}
            options={[{ value: "", label: "Tüm takımlar" }, ...ctx.teams.map((t) => ({ value: t.id, label: t.name }))]}
          />
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" size="sm" className="flex-1 sm:flex-none">
            Uygula
          </Button>
          {ctx.scopeLabel ? (
            <Link
              href={clearQs ? `${path}?${clearQs}` : path}
              className="focus-ring inline-flex min-h-9 items-center rounded-[var(--radius-control)] px-3 text-xs font-semibold text-text-muted hover:bg-surface-hover touch:min-h-11"
            >
              Temizle
            </Link>
          ) : null}
        </div>
      </form>
    </details>
  );
}
