import { Tv, TrendingUp, Layers, Trophy, Building2, Gauge } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { now } from "@/lib/clock";
import { currentMonthPeriod, loadAdvisorMetrics } from "@/lib/team/advisor-metrics";
import { getOfficeScoreCached } from "@/lib/office-score";
import { TvLive } from "./tv-live";

export const metadata = { title: "Ofis Panosu · TV" };

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const money = (n: number) => `₺${nf.format(Math.round(n))}`;
const compact = (n: number) =>
  n >= 1_000_000 ? `₺${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `₺${(n / 1_000).toFixed(0)}B` : `₺${nf.format(n)}`;

export default async function PanoTvPage() {
  const { tenantId, userId, role, perms } = await requireModulePage("reports", "/app/pano-tv");
  const supabase = await createClient();
  const nowMs = now();

  // Sayılar TEK KAYNAK (loadAdvisorMetrics): Danışman KPI / Lig / Kıyas / Kazanç ile aynı tanım, içinde bulunulan TR ayı.
  // Gelir (komisyon payı) ve Ofis komisyonu (brüt) yalnız earnings_all ile gelir; yetkisiz hesapta sunucudan hiç
  // çekilmez ve pano satış adedine göre sıralar.
  const [metrics, { data: openDeals }, { data: recentProps }, score] = await Promise.all([
    loadAdvisorMetrics(supabase, {
      viewer: { userId, role, perms },
      tenantId,
      period: currentMonthPeriod(nowMs),
      nowMs,
    }),
    supabase.from("deals").select("deal_value").not("stage", "in", "(won,lost)"),
    supabase
      .from("properties")
      .select("property_code, title, list_price, created_at, status")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(6),
    getOfficeScoreCached(tenantId).catch(() => null),
  ]);

  const open = (openDeals ?? []) as { deal_value: number | null }[];
  const seeRevenue = metrics.seeAllEarnings;
  const grossCollected = metrics.office.commissionGrossCollected ?? 0;
  const wonCount = metrics.totals.dealCount;
  const pipelineValue = open.reduce((s, d) => s + Number(d.deal_value ?? 0), 0);
  const pipelineCount = open.length;

  // Lig: gelir görünüyorsa tahsil edilen komisyon payına, aksi halde satış (kabul edilen teklif) adedine göre
  const lig = metrics.rows
    .map((m) => ({ id: m.id, name: m.fullName, value: seeRevenue ? (m.revenue ?? 0) : m.dealCount, count: m.dealCount }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "tr"))
    .slice(0, 5);
  const maxLig = lig[0]?.value || 1;

  const props = (recentProps ?? []) as { property_code: string; title: string; list_price: number | null; status: string }[];

  const stats = [
    seeRevenue
      ? { icon: TrendingUp, label: "Ofis komisyonu (brüt) · bu ay", value: compact(grossCollected), sub: `${wonCount} kabul edilen teklif`, tone: "text-mint-300" }
      : { icon: TrendingUp, label: "Satış · bu ay", value: String(wonCount), sub: "kabul edilen teklif", tone: "text-mint-300" },
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
            <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-white/10 text-cyan-300">
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
            <div key={s.label} className="rounded-[var(--radius-panel)] border border-white/10 bg-white/[0.06] p-6">
              <s.icon className={`h-6 w-6 ${s.tone}`} />
              <p className="mt-4 font-display text-4xl font-extrabold leading-none tracking-tight md:text-5xl">{s.value}</p>
              <p className="mt-2 text-sm font-semibold text-white/80">{s.label}</p>
              <p className="text-xs text-white/50">{s.sub}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          {/* Lig */}
          <section className="rounded-[var(--radius-panel)] border border-white/10 bg-white/[0.05] p-6">
            <h2 className="flex items-center gap-2 text-sm font-bold text-white/80">
              <Trophy className="h-5 w-5 text-amber-300" /> Danışman Ligi · bu ay · {seeRevenue ? "komisyon payı" : "satış adedi"}
            </h2>
            {lig.length === 0 ? (
              <p className="mt-6 text-center text-sm text-white/50">Bu ay henüz kayıt yok.</p>
            ) : (
              <ol className="mt-5 space-y-3">
                {lig.map((a, i) => (
                  <li key={a.id} className="flex items-center gap-3">
                    <span
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] font-display text-lg font-extrabold ${
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
                      <p className="font-display text-lg font-extrabold tabular-nums text-mint-300">{seeRevenue ? compact(a.value) : a.value}</p>
                      <p className="text-xs text-white/50">{a.count} satış</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Yeni portföy akışı */}
          <section className="rounded-[var(--radius-panel)] border border-white/10 bg-white/[0.05] p-6">
            <h2 className="flex items-center gap-2 text-sm font-bold text-white/80">
              <Building2 className="h-5 w-5 text-cyan-300" /> Yeni Portföy Akışı
            </h2>
            {props.length === 0 ? (
              <p className="mt-6 text-center text-sm text-white/50">Henüz portföy yok.</p>
            ) : (
              <ul className="mt-5 space-y-2.5">
                {props.map((p) => (
                  <li key={p.property_code} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-white/8 bg-white/[0.04] px-4 py-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-white/10 text-cyan-300">
                      <Building2 className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{p.title}</p>
                      <p className="text-xs text-white/50">{p.property_code}</p>
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
