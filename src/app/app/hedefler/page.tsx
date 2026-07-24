import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { listTargets } from "@/app/actions/targets-openhouse-sources";

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

function pct(actual: number, target: number) {
  if (!target) return 0;
  return Math.min(100, Math.round((actual / target) * 100));
}

function profileLabel(p: { id: string; full_name: string } | { id: string; full_name: string }[] | null) {
  if (!p) return "Ofis geneli";
  return Array.isArray(p) ? p[0]?.full_name ?? "—" : p.full_name;
}

export default async function HedeflerPage() {
  await requireModulePage("targets");
  const targets = await listTargets();

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
            <TrendingUp className="h-4 w-4" /> Performans hedefleri
          </span>
          <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Hedefler &amp; Kota</h1>
          <p className="mt-1 text-sm text-white/75">Danışman ve ofis bazında satış hedeflerini takip edin.</p>
        </div>
      </section>

      {targets.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-line-strong bg-surface py-16 text-center">
          <TrendingUp className="mx-auto h-10 w-10 text-text-faint" />
          <p className="mt-3 font-semibold text-ink-950">Henüz hedef tanımlanmamış</p>
          <p className="mt-1 text-sm text-text-muted">Danışman bazlı aylık satış hedefleri buraya gelecek.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {targets.map((t) => {
            const dealPct    = pct(t.actual_deals, t.target_deals);
            const revPct     = pct(Number(t.actual_revenue), Number(t.target_revenue));
            const period     = new Date(t.period_start).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
            const prof       = Array.isArray(t.profile) ? t.profile[0] : t.profile;
            const profId     = (prof as { id?: string } | null)?.id ?? null;
            return (
              <div key={t.id} className="group relative rounded-[20px] border border-line bg-surface p-5 transition hover:border-brand-400/40">
                {profId ? (
                  <Link href={`/app/ekip/${profId}`} className="absolute inset-0 rounded-[20px]" aria-label={`${profileLabel(t.profile)} danışman detayı`} />
                ) : null}
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold text-text-muted">{period}</p>
                    <p className="mt-0.5 font-display font-bold text-ink-950 group-hover:text-brand-600">{profileLabel(t.profile)}</p>
                  </div>
                  <span className="rounded-full bg-brand-600/10 px-2 py-1 text-[10px] font-bold text-brand-600">
                    {t.period === "monthly" ? "Aylık" : t.period === "quarterly" ? "Çeyrek" : "Yıllık"}
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  {/* Anlaşma hedefi */}
                  <div>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-text-muted">Anlaşma</span>
                      <span className="font-semibold text-ink-950">{t.actual_deals} / {t.target_deals}</span>
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
                      <span className="font-semibold text-ink-950">{money(Number(t.actual_revenue))} / {money(Number(t.target_revenue))}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-line">
                      <div
                        className="h-full rounded-full bg-mint-500 transition-all"
                        style={{ width: `${revPct}%` }}
                      />
                    </div>
                    <p className="mt-0.5 text-right text-[11px] text-text-faint">%{revPct}</p>
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
