import Link from "next/link";
import { AlertTriangle, Trash2, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { deleteTarget, listTargets } from "@/app/actions/targets-openhouse-sources";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  const elapsed = Date.now() - start.getTime();
  return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
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

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
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
      </section>

      {targets.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-line-strong bg-surface py-16 text-center">
          <TrendingUp className="mx-auto h-10 w-10 text-text-faint" />
          <p className="mt-3 font-semibold text-ink-950">Henüz hedef tanımlanmamış</p>
          <p className="mt-1 text-sm text-text-muted">Danışman bazlı aylık satış hedefleri buraya gelecek.</p>
          {canCreate ? (
            <div className="mt-5 flex justify-center">
              <TargetFormDialog members={memberList} />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {targets.map((t) => {
            const dealPct    = pct(t.actual_deals, t.target_deals);
            const revPct     = pct(Number(t.actual_revenue), Number(t.target_revenue));
            const period     = new Date(t.period_start).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
            const prof       = Array.isArray(t.profile) ? t.profile[0] : t.profile;
            const profId     = (prof as { id?: string } | null)?.id ?? null;
            const elapsed    = elapsedPct(t.period_start, t.period);
            // Tempo: dönemin geçen yüzdesi ile en iyi hedef ilerlemesi karşılaştırılır;
            // 10 puanlık tolerans aşılırsa "geride" uyarısı gösterilir
            const progress   = Math.max(dealPct, revPct);
            const behind     = elapsed > 0 && elapsed < 100 && progress < elapsed - 10;
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
                  <div>
                    <p className="text-xs font-semibold text-text-muted">{period}</p>
                    <p className="mt-0.5 font-display font-bold text-ink-950 group-hover:text-brand-600">{profileLabel(t.profile)}</p>
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
