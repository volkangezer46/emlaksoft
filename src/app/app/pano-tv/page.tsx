import { Tv, TrendingUp, Layers, Trophy, Building2, Gauge } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { daysAgoIso } from "@/lib/clock";
import { getOfficeScoreCached } from "@/lib/office-score";
import { TvLive } from "./tv-live";

export const metadata = { title: "Ofis Panosu · TV" };

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const money = (n: number) => `₺${nf.format(Math.round(n))}`;
const compact = (n: number) =>
  n >= 1_000_000 ? `₺${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `₺${(n / 1_000).toFixed(0)}B` : `₺${nf.format(n)}`;

export default async function PanoTvPage() {
  const { tenantId } = await requireModulePage("reports");
  const supabase = await createClient();
  const since = daysAgoIso(30);

  const [{ data: wonDeals }, { data: openDeals }, { data: recentProps }, { data: profiles }, score] =
    await Promise.all([
      supabase.from("deals").select("deal_value, assigned_to, updated_at").eq("stage", "won").gte("updated_at", since),
      supabase.from("deals").select("deal_value").not("stage", "in", "(won,lost)"),
      supabase
        .from("properties")
        .select("property_code, title, list_price, created_at, status")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(6),
      supabase.from("profiles").select("id, full_name").eq("is_active", true),
      getOfficeScoreCached(tenantId).catch(() => null),
    ]);

  const won = (wonDeals ?? []) as { deal_value: number | null; assigned_to: string | null }[];
  const open = (openDeals ?? []) as { deal_value: number | null }[];
  const nameOf = new Map(((profiles ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));

  const ciro = won.reduce((s, d) => s + Number(d.deal_value ?? 0), 0);
  const wonCount = won.length;
  const pipelineValue = open.reduce((s, d) => s + Number(d.deal_value ?? 0), 0);
  const pipelineCount = open.length;

  // Lig — son 30 günde kapatılan anlaşma cirosuna göre danışman sıralaması
  const byAdvisor = new Map<string, { name: string; value: number; count: number }>();
  for (const d of won) {
    const id = d.assigned_to ?? "—";
    const cur = byAdvisor.get(id) ?? { name: nameOf.get(id) ?? "Atanmamış", value: 0, count: 0 };
    cur.value += Number(d.deal_value ?? 0);
    cur.count += 1;
    byAdvisor.set(id, cur);
  }
  const lig = [...byAdvisor.values()].sort((a, b) => b.value - a.value).slice(0, 5);
  const maxLig = lig[0]?.value || 1;

  const props = (recentProps ?? []) as { property_code: string; title: string; list_price: number | null; status: string }[];

  const stats = [
    { icon: TrendingUp, label: "Ciro · son 30 gün", value: compact(ciro), sub: `${wonCount} kapanan anlaşma`, tone: "text-mint-300" },
    { icon: Layers, label: "Açık pipeline", value: compact(pipelineValue), sub: `${pipelineCount} fırsat`, tone: "text-cyan-300" },
    { icon: Gauge, label: "Ofis skoru", value: score ? String(score.score) : "—", sub: score?.label ?? "hesaplanıyor", tone: "text-brand-300" },
    { icon: Building2, label: "Yeni portföy akışı", value: String(props.length), sub: "son eklenenler", tone: "text-amber-300" },
  ];

  return (
    <div className="theme-dark -m-4 min-h-[calc(100vh-4.25rem)] bg-[image:var(--grad-ink)] p-6 text-white md:-m-6 md:p-8 lg:-m-8">
      <div className="pointer-events-none fixed inset-0 grid-overlay-dark opacity-20" />
      <div className="relative">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-white/10 text-cyan-300">
              <Tv className="h-6 w-6" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">Ofis Dijital İkizi</p>
              <h1 className="font-display text-2xl font-extrabold md:text-3xl">Canlı Ofis Panosu</h1>
            </div>
          </div>
          <TvLive intervalSec={45} />
        </header>

        {/* Dev KPI'lar */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-[20px] border border-white/10 bg-white/[0.06] p-6">
              <s.icon className={`h-6 w-6 ${s.tone}`} />
              <p className="mt-4 font-display text-4xl font-extrabold leading-none tracking-tight md:text-5xl">{s.value}</p>
              <p className="mt-2 text-sm font-semibold text-white/80">{s.label}</p>
              <p className="text-xs text-white/50">{s.sub}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          {/* Lig */}
          <section className="rounded-[20px] border border-white/10 bg-white/[0.05] p-6">
            <h2 className="flex items-center gap-2 text-sm font-bold text-white/80">
              <Trophy className="h-5 w-5 text-amber-300" /> Danışman Ligi · son 30 gün
            </h2>
            {lig.length === 0 ? (
              <p className="mt-6 text-center text-sm text-white/50">Bu dönemde kapanan anlaşma yok.</p>
            ) : (
              <ol className="mt-5 space-y-3">
                {lig.map((a, i) => (
                  <li key={a.name} className="flex items-center gap-3">
                    <span
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-[11px] font-display text-lg font-extrabold ${
                        i === 0 ? "bg-amber-400 text-ink-950" : i === 1 ? "bg-white/25" : i === 2 ? "bg-amber-700/50" : "bg-white/10"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-bold">{a.name}</p>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-[image:var(--grad-brand)]" style={{ width: `${Math.max(6, (a.value / maxLig) * 100)}%` }} />
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-display text-lg font-extrabold tabular-nums text-mint-300">{compact(a.value)}</p>
                      <p className="text-[11px] text-white/50">{a.count} anlaşma</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Yeni portföy akışı */}
          <section className="rounded-[20px] border border-white/10 bg-white/[0.05] p-6">
            <h2 className="flex items-center gap-2 text-sm font-bold text-white/80">
              <Building2 className="h-5 w-5 text-cyan-300" /> Yeni Portföy Akışı
            </h2>
            {props.length === 0 ? (
              <p className="mt-6 text-center text-sm text-white/50">Henüz portföy yok.</p>
            ) : (
              <ul className="mt-5 space-y-2.5">
                {props.map((p) => (
                  <li key={p.property_code} className="flex items-center gap-3 rounded-[13px] border border-white/8 bg-white/[0.04] px-4 py-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-white/10 text-cyan-300">
                      <Building2 className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{p.title}</p>
                      <p className="text-[11px] text-white/50">{p.property_code}</p>
                    </div>
                    <p className="shrink-0 font-display text-base font-bold tabular-nums text-white/90">
                      {p.list_price != null ? money(Number(p.list_price)) : "—"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
