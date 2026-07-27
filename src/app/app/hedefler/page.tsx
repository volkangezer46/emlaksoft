import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Gauge, Rocket, Trash2, TrendingUp, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { now } from "@/lib/clock";
import { deleteTarget, listTargets } from "@/app/actions/targets-openhouse-sources";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { TargetFormDialog, type TargetFormValues } from "./target-form-dialog";

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

function pct(actual: number, target: number) {
  if (!target) return 0;
  return Math.min(100, Math.round((actual / target) * 100));
}

/** Dönemin yüzde kaçı geçti (0–100). Dönem henüz başlamadıysa 0, bittiyse 100. */
function elapsedPct(periodStart: string, period: string) {
  const start = new Date(periodStart);
  const end = new Date(start);
  end.setMonth(end.getMonth() + (period === "yearly" ? 12 : period === "quarterly" ? 3 : 1));
  const total = end.getTime() - start.getTime();
  if (total <= 0) return 100;
  const elapsed = now() - start.getTime();
  return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
}

/**
 * İlerleme halkası — sunucuda çizilen SVG donut. Renk duruma göre:
 * hedef tamam → mint, tempo geride → amber, aksi halde brand.
 */
function ProgressRing({ value, tone, size = 64 }: { value: number; tone: "mint" | "amber" | "brand"; size?: number }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(100, Math.max(0, value)) / 100);
  const color = tone === "mint" ? "var(--mint-500)" : tone === "amber" ? "var(--amber-400)" : "var(--brand-600)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`İlerleme %${value}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          style={{ transition: "stroke-dashoffset 600ms ease" }}
        />
      </svg>
      <span className="numeric absolute inset-0 grid place-items-center font-display text-sm font-extrabold text-ink-950">
        %{value}
      </span>
    </div>
  );
}

/** "Bu hızla dönem sonunda ~X" projeksiyonu; dönem başlamadıysa/bittiyse null. */
function paceProjection(actual: number, elapsed: number) {
  if (elapsed <= 0 || elapsed >= 100 || actual <= 0) return null;
  return actual / (elapsed / 100);
}

function profileLabel(p: { id: string; full_name: string } | { id: string; full_name: string }[] | null) {
  if (!p) return "Ofis geneli";
  return Array.isArray(p) ? p[0]?.full_name ?? "—" : p.full_name;
}

export default async function HedeflerPage() {
  const ctx = await requireModulePage("targets");
  const canCreate = (ctx.perms.targets ?? []).includes("create");
  const canEdit   = (ctx.perms.targets ?? []).includes("edit");
  const canDelete = (ctx.perms.targets ?? []).includes("delete");

  const supabase = await createClient();
  const [targets, { data: members }] = await Promise.all([
    listTargets(),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);
  const memberList = (members ?? []) as { id: string; full_name: string }[];

  // Kart hesapları tek yerde: özet KPI'lar, takım kıyası ve kartlar aynı sayıları okur.
  const enriched = targets.map((t) => {
    const dealPct = pct(t.actual_deals, t.target_deals);
    const revPct = pct(Number(t.actual_revenue), Number(t.target_revenue));
    const elapsed = elapsedPct(t.period_start, t.period);
    const progress = Math.max(dealPct, revPct);
    const done = progress >= 100;
    const behind = !done && elapsed > 0 && elapsed < 100 && progress < elapsed - 10;
    return { t, dealPct, revPct, elapsed, progress, done, behind };
  });
  const doneCount = enriched.filter((e) => e.done).length;
  const behindCount = enriched.filter((e) => e.behind).length;
  const onTrackCount = enriched.length - doneCount - behindCount;

  // Takım kıyası: en güncel dönemdeki (aynı period + period_start) kişi hedefleri
  const latest = enriched[0]?.t ?? null;
  const race = latest
    ? enriched.filter((e) => e.t.period === latest.period && e.t.period_start === latest.period_start)
    : [];
  const showRace = race.length >= 2;
  const raceSorted = [...race].sort((a, b) => b.progress - a.progress);
  const racePeriodLabel = latest
    ? new Date(latest.period_start).toLocaleDateString("tr-TR", { month: "long", year: "numeric" })
    : "";

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-brand-500/25 blur-[80px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
              <TrendingUp className="h-4 w-4" /> Performans hedefleri
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Hedefler &amp; Kota</h1>
            <p className="mt-1 text-sm text-white/75">Danışman ve ofis bazında satış hedeflerini takip edin.</p>
          </div>
          {canCreate ? <TargetFormDialog members={memberList} triggerVariant="hero" /> : null}
        </div>
        {targets.length > 0 ? (
          <div className="relative mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Tanımlı hedef", value: targets.length, icon: Gauge, tone: "text-white", href: "#hedef-listesi" },
              { label: "Tamamlanan", value: doneCount, icon: Rocket, tone: "text-mint-300", href: "#hedef-listesi" },
              { label: "Yolunda", value: onTrackCount, icon: TrendingUp, tone: "text-cyan-300", href: "#hedef-listesi" },
              { label: "Tempo geride", value: behindCount, icon: AlertTriangle, tone: "text-amber-300", href: "#hedef-listesi" },
            ].map((k) => (
              <Link
                key={k.label}
                href={k.href}
                className="focus-ring press lift group block rounded-[14px] border border-white/10 bg-white/5 p-3.5 backdrop-blur transition hover:border-brand-300"
              >
                <div className="flex items-start justify-between">
                  <k.icon className={`h-4 w-4 ${k.tone}`} />
                  <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </div>
                <p className="numeric mt-2 font-display text-xl font-extrabold">{k.value}</p>
                <p className="text-[11px] text-white/50">{k.label}</p>
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      {/* Takım kıyası — aynı dönemdeki hedefler ilerlemeye göre yarış şeridinde */}
      {showRace ? (
        <section id="takim-kiyas" className="scroll-mt-24 rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display text-sm font-extrabold uppercase tracking-[0.08em] text-ink-950">
              <Users className="h-4 w-4 text-brand-600" /> Takım kıyası · {racePeriodLabel}
            </h2>
            <span className="text-[11px] text-text-faint">En iyi ilerleme yüzdesine göre</span>
          </div>
          <div className="mt-4 space-y-2.5">
            {raceSorted.map((e, i) => {
              const prof = Array.isArray(e.t.profile) ? e.t.profile[0] : e.t.profile;
              const pid = (prof as { id?: string } | null)?.id ?? null;
              const name = profileLabel(e.t.profile);
              return (
                <Link
                  key={e.t.id}
                  href={pid ? `/app/ekip/${pid}` : "/app/raporlar"}
                  className="focus-ring group flex items-center gap-3 rounded-[12px] px-1.5 py-1.5 transition hover:bg-canvas"
                >
                  <span
                    className={`numeric grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-extrabold ${
                      i === 0 ? "bg-amber-400/20 text-amber-600" : "bg-canvas text-text-muted"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="w-32 truncate text-xs font-semibold text-ink-950 group-hover:text-brand-600 sm:w-44">{name}</span>
                  <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-line">
                    <span
                      className={`block h-full rounded-full transition-all ${e.done ? "bg-mint-500" : e.behind ? "bg-amber-400" : "bg-brand-600"}`}
                      style={{ width: `${Math.max(2, e.progress)}%` }}
                    />
                  </span>
                  <span className="numeric w-12 shrink-0 text-right text-xs font-extrabold text-ink-950">%{e.progress}</span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {targets.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="Henüz hedef tanımlanmamış"
          description="Danışman veya ofis geneli için aylık, çeyreklik ya da yıllık satış hedefi tanımlayın; ilerleme halkaları ve tempo takibi burada canlanır."
          tone="brand"
          action={canCreate ? { node: <TargetFormDialog members={memberList} /> } : undefined}
        />
      ) : (
        <div id="hedef-listesi" className="grid scroll-mt-24 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {enriched.map(({ t, dealPct, revPct, elapsed, progress, done, behind }) => {
            const period     = new Date(t.period_start).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
            const prof       = Array.isArray(t.profile) ? t.profile[0] : t.profile;
            const profId     = (prof as { id?: string } | null)?.id ?? null;
            // Tempo projeksiyonu: "bu hızla dönem sonunda ~X" — clock.ts tabanlı elapsed
            const projDeals   = paceProjection(t.actual_deals, elapsed);
            const projRevenue = paceProjection(Number(t.actual_revenue), elapsed);
            const formValues: TargetFormValues = {
              id:             t.id,
              period:         t.period,
              period_start:   t.period_start,
              target_deals:   t.target_deals,
              target_revenue: Number(t.target_revenue),
              profile_id:     profId,
            };
            return (
              <div key={t.id} className="group relative rounded-[20px] border border-line bg-surface p-5 transition hover:border-brand-400/40">
                <Link
                  href={profId ? `/app/ekip/${profId}` : "/app/raporlar"}
                  className="absolute inset-0 rounded-[20px]"
                  aria-label={profId ? `${profileLabel(t.profile)} danışman detayı` : "Ofis geneli raporlar"}
                />
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {/* İlerleme halkası: hedef tamam mint, tempo geride amber, aksi brand */}
                    <ProgressRing value={progress} tone={done ? "mint" : behind ? "amber" : "brand"} size={56} />
                    <div>
                      <p className="text-xs font-semibold text-text-muted">{period}</p>
                      <p className="mt-0.5 font-display font-bold text-ink-950 group-hover:text-brand-600">{profileLabel(t.profile)}</p>
                      {done ? (
                        <p className="mt-0.5 text-[11px] font-bold text-mint-600">Hedef tamamlandı</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-full bg-brand-600/10 px-2 py-1 text-[11px] font-bold text-brand-600">
                      {t.period === "monthly" ? "Aylık" : t.period === "quarterly" ? "Çeyrek" : "Yıllık"}
                    </span>
                    {canEdit ? <TargetFormDialog members={memberList} target={formValues} /> : null}
                    {canDelete ? (
                      <ConfirmDialog
                        trigger={
                          <button
                            type="button"
                            aria-label="Hedefi sil"
                            className="focus-ring press relative z-10 grid h-8 w-8 place-items-center rounded-[9px] border border-hairline bg-surface text-danger-500 transition hover:border-danger-500/40"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        }
                        title="Hedef silinsin mi?"
                        description={`${profileLabel(t.profile)} · ${period} hedefi kalıcı olarak silinir.`}
                        confirmLabel="Hedefi sil"
                        formAction={deleteTarget}
                        hiddenFields={{ id: t.id }}
                      />
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {/* Anlaşma hedefi */}
                  <div>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-text-muted">Anlaşma</span>
                      <Link href="/app/anlasmalar" className="focus-ring relative z-10 rounded-[6px] font-semibold text-ink-950 hover:text-brand-600 hover:underline">
                        {t.actual_deals} / {t.target_deals}
                      </Link>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-line">
                      <div
                        className="h-full rounded-full bg-brand-600 transition-all"
                        style={{ width: `${dealPct}%` }}
                      />
                    </div>
                    <p className="mt-0.5 text-right text-[11px] text-text-faint">%{dealPct}</p>
                  </div>

                  {/* Gelir hedefi */}
                  <div>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-text-muted">Gelir</span>
                      <Link href="/app/anlasmalar" className="focus-ring relative z-10 rounded-[6px] font-semibold text-ink-950 hover:text-brand-600 hover:underline">
                        {money(Number(t.actual_revenue))} / {money(Number(t.target_revenue))}
                      </Link>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-line">
                      <div
                        className="h-full rounded-full bg-mint-500 transition-all"
                        style={{ width: `${revPct}%` }}
                      />
                    </div>
                    <p className="mt-0.5 text-right text-[11px] text-text-faint">%{revPct}</p>
                  </div>

                  {/* Tempo: dönemin geçen kısmı vs hedef ilerlemesi */}
                  <div className="border-t border-hairline pt-2.5">
                    <div className="mb-1 flex justify-between text-[11px]">
                      <span className="text-text-muted">Tempo · dönemin %{elapsed}&apos;i geçti</span>
                      <span className={`font-semibold ${behind ? "text-amber-600" : "text-mint-600"}`}>İlerleme %{progress}</span>
                    </div>
                    <div className="relative h-1.5 overflow-hidden rounded-full bg-line">
                      <div
                        className={`h-full rounded-full transition-all ${behind ? "bg-amber-400" : "bg-mint-500"}`}
                        style={{ width: `${progress}%` }}
                      />
                      {/* Dönemin geçen yüzdesini gösteren referans çizgisi */}
                      <div className="absolute inset-y-0 w-0.5 bg-ink-950/40" style={{ left: `${elapsed}%` }} />
                    </div>
                    {behind ? (
                      <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-amber-600">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Tempo geride: dönemin %{elapsed}&apos;i geçti, ilerleme %{progress}.
                      </p>
                    ) : null}
                    {projDeals != null || projRevenue != null ? (
                      <p className="mt-1.5 text-[11px] text-text-muted">
                        Bu hızla dönem sonunda{" "}
                        {projDeals != null ? (
                          <span className="font-bold text-ink-950">~{Math.round(projDeals)} anlaşma</span>
                        ) : null}
                        {projDeals != null && projRevenue != null ? " · " : null}
                        {projRevenue != null ? (
                          <span className="font-bold text-ink-950">~{money(Math.round(projRevenue))}</span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
