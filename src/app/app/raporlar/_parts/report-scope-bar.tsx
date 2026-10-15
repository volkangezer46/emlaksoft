import Link from "@/components/ui/smart-link";
import { CalendarRange, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterDate, FilterSelect } from "@/components/ui/list-kit";
import { PERIOD_PRESETS, periodScopeParams, rangeLabel } from "@/lib/report-center/period-scope";
import type { ReportScopeContext } from "./report-scope";

function buildHref(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `${path}?${qs}` : path;
}

const CHIP =
  "focus-ring inline-flex min-h-9 shrink-0 snap-start items-center rounded-full border px-3.5 text-xs font-semibold transition touch:min-h-11";

/**
 * Dönem + kapsam çubuğu (sunucu bileşeni, istemci JS yok). Dönem çipleri BAĞLANTIDIR (kapsamı korur); özel aralık ve
 * şube/takım/danışman seçimi GET formudur (dönemi korur). URL ↔ sunucu sorgusu iki yönlü (filtre kontratı).
 * Mobilde çipler yatay kaydırılır (snap), form alanları tek sütun; dokunma hedefleri ≥44 px.
 */
export function ReportScopeBar({ path, ctx, extra = {} }: { path: string; ctx: ReportScopeContext; extra?: Record<string, string> }) {
  const { period, scope } = ctx;
  const scopeParams = periodScopeParams({ ...period, key: "bu-ay" }, scope);
  const periodParams = periodScopeParams(period, { branchId: null, teamId: null, profileId: null });
  const hrefFor = (donem: string) => buildHref(path, { ...extra, ...scopeParams, ...(donem === "bu-ay" ? {} : { donem }) });
  const scopeOpen = Boolean(scope.branchId || scope.profileId || (scope.teamId && !ctx.lockedTeam));
  const advisorOptions = ctx.advisors.filter(
    (a) => (!scope.branchId || a.branchId === scope.branchId) && (!scope.teamId || a.teamId === scope.teamId),
  );

  return (
    <section aria-label="Dönem ve kapsam" className="surface-card rounded-[var(--radius-panel)] p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <nav aria-label="Dönem seçici" className="-mx-1 flex min-w-0 max-w-full snap-x gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
          {PERIOD_PRESETS.map((p) => {
            const active = period.key === p.value;
            return (
              <Link
                key={p.value}
                href={hrefFor(p.value)}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={`${CHIP} ${active ? "border-transparent bg-accent text-accent-fg" : "border-line bg-surface text-text-muted hover:bg-surface-hover hover:text-text"}`}
              >
                {p.label}
              </Link>
            );
          })}
          {period.key === "ozel" ? (
            <span aria-current="true" className={`${CHIP} border-transparent bg-accent text-accent-fg`}>
              Özel
            </span>
          ) : null}
        </nav>
        <p className="text-xs text-text-muted">
          <span className="font-semibold text-text">{rangeLabel(period.from, period.to)}</span>
          <span className="hidden sm:inline"> · önceki dönem {rangeLabel(period.prevFrom, period.prevTo)}</span>
          {ctx.scopeLabel ? <span> · {ctx.scopeLabel}</span> : null}
        </p>
      </div>

      <div className="mt-2 grid gap-2 lg:grid-cols-2">
        <details className="group rounded-[var(--radius-card)] border border-line" open={period.key === "ozel" || undefined}>
          <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[var(--radius-card)] px-3 text-xs font-semibold text-text-muted hover:bg-surface-hover [&::-webkit-details-marker]:hidden">
            <CalendarRange className="h-4 w-4" aria-hidden="true" /> Özel tarih aralığı
          </summary>
          <form method="get" action={path} className="grid gap-2 border-t border-line p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            {Object.entries({ ...extra, ...scopeParams }).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <input type="hidden" name="donem" value="ozel" />
            <FilterDate name="baslangic" label="Başlangıç" value={period.from} />
            <FilterDate name="bitis" label="Bitiş" value={period.to} />
            <Button type="submit" size="sm" variant="outline">
              Uygula
            </Button>
          </form>
        </details>

        {ctx.canPick ? (
          <details className="group rounded-[var(--radius-card)] border border-line" open={scopeOpen || undefined}>
            <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[var(--radius-card)] px-3 text-xs font-semibold text-text-muted hover:bg-surface-hover [&::-webkit-details-marker]:hidden">
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              {ctx.lockedTeam ? `Kapsam: ${ctx.lockedTeam.name} takımı` : "Şube, takım, danışman"}
              {ctx.scopeLabel ? <span className="ml-auto truncate rounded-full bg-surface-accent-soft px-2 py-0.5 text-accent-text">{ctx.scopeLabel}</span> : null}
            </summary>
            <form method="get" action={path} className="grid gap-2 border-t border-line p-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end">
              {Object.entries({ ...extra, ...periodParams }).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              {!ctx.lockedTeam && ctx.branches.length > 0 ? (
                <FilterSelect
                  name="sube"
                  label="Şube"
                  value={scope.branchId ?? ""}
                  options={[{ value: "", label: "Tüm şubeler" }, ...ctx.branches.map((b) => ({ value: b.id, label: b.name }))]}
                />
              ) : null}
              {!ctx.lockedTeam && ctx.teams.length > 0 ? (
                <FilterSelect
                  name="takim"
                  label="Takım"
                  value={scope.teamId ?? ""}
                  options={[
                    { value: "", label: "Tüm takımlar" },
                    ...ctx.teams.filter((t) => !scope.branchId || t.branchId === scope.branchId).map((t) => ({ value: t.id, label: t.name })),
                  ]}
                />
              ) : null}
              <FilterSelect
                name="danisman"
                label="Danışman"
                value={scope.profileId ?? ""}
                options={[{ value: "", label: ctx.lockedTeam ? "Tüm takım" : "Tüm danışmanlar" }, ...advisorOptions.map((a) => ({ value: a.id, label: a.name }))]}
              />
              <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
                <Button type="submit" size="sm" className="flex-1 lg:flex-none">
                  Uygula
                </Button>
                {ctx.scopeLabel && !ctx.lockedTeam ? (
                  <Link
                    href={buildHref(path, { ...extra, ...periodParams })}
                    className="focus-ring inline-flex min-h-9 items-center rounded-[var(--radius-control)] px-3 text-xs font-semibold text-text-muted hover:bg-surface-hover touch:min-h-11"
                  >
                    Temizle
                  </Link>
                ) : null}
              </div>
            </form>
          </details>
        ) : null}
      </div>
    </section>
  );
}
