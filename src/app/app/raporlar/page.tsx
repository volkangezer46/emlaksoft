import Link from "next/link";
import {
  BarChart3,
  Building2,
  Crosshair,
  Gauge,
  PieChart,
  Siren,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { computeOfficeScore, loadOfficeScoreInputs } from "@/lib/office-score";

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

export default async function ReportsPage() {
  await requireModulePage("reports");
  const supabase = await createClient();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [
    scoreInputs,
    { count: customers },
    { count: demands },
    { count: properties },
    { data: commissions },
    { data: closures },
    { data: portals },
    { data: customerSources },
  ] = await Promise.all([
    loadOfficeScoreInputs(supabase),
    supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("customer_demands").select("id", { count: "exact", head: true }).in("status", ["new", "active", "matched"]),
    supabase.from("properties").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("commissions").select("gross_amount, status, created_at").gte("created_at", monthStart.toISOString()).limit(200),
    supabase.from("listing_closures").select("estimated_lost_commission").gte("created_at", monthStart.toISOString()).limit(100),
    supabase.from("portal_listings").select("status, last_confirmed_at").eq("status", "live").limit(200),
    // Müşteri kaynak dağılımı
    supabase.from("customers").select("source").is("deleted_at", null).not("source", "is", null).limit(1000),
  ]);

  const office = computeOfficeScore(scoreInputs);
  const commissionTotal = (commissions ?? []).reduce((s, c) => s + Number(c.gross_amount || 0), 0);
  const lost = (closures ?? []).reduce((s, c) => s + Number(c.estimated_lost_commission || 0), 0);
  const overdue = (portals ?? []).filter((p) => {
    if (!p.last_confirmed_at) return true;
    return Date.now() - new Date(p.last_confirmed_at).getTime() > 7 * 86_400_000;
  }).length;

  const bars = [
    { label: "Müşteri", value: customers ?? 0, max: Math.max(10, customers ?? 0) },
    { label: "Talep", value: demands ?? 0, max: Math.max(10, demands ?? 0) },
    { label: "Portföy", value: properties ?? 0, max: Math.max(10, properties ?? 0) },
    { label: "Canlı portal", value: portals?.length ?? 0, max: Math.max(10, portals?.length ?? 0) },
  ];

  // Müşteri kaynak dağılımı
  const sourceMap = new Map<string, number>();
  for (const row of customerSources ?? []) {
    const src = (row.source as string | null) ?? "Belirtilmedi";
    sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1);
  }
  const sourceBars = [...sourceMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, count]) => ({ label, count }));
  const sourceTotal = Math.max(1, sourceBars.reduce((s, b) => s + b.count, 0));
  const sourceMax = Math.max(1, ...sourceBars.map((b) => b.count));

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-400">
              <BarChart3 className="h-3.5 w-3.5" /> Rapor merkezi
            </p>
            <h1 className="mt-2 font-display text-3xl font-extrabold">Ofis sağlık & performans</h1>
            <p className="mt-2 text-sm text-white/60">Gerçek aggregate · sahte pipeline yok.</p>
          </div>
          <div className="rounded-[16px] border border-white/10 bg-white/5 px-5 py-4 text-center">
            <p className="font-display text-3xl font-extrabold text-mint-400">{office.score}</p>
            <p className="text-xs text-white/55">{office.label} ofis skoru</p>
          </div>
        </div>
        <div className="relative mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Aylık komisyon", value: money(commissionTotal), icon: Wallet, tone: "text-amber-300" },
            { label: "Tahmini kayıp", value: money(lost), icon: Siren, tone: "text-danger-400" },
            { label: "Gecikmiş teyit", value: String(overdue), icon: Building2, tone: "text-warn-400" },
            { label: "Açık talep", value: String(demands ?? 0), icon: Target, tone: "text-mint-300" },
          ].map((k) => (
            <div key={k.label} className="rounded-[14px] border border-white/10 bg-white/5 p-4">
              <k.icon className={`h-4 w-4 ${k.tone}`} />
              <p className="mt-2 font-display text-xl font-extrabold">{k.value}</p>
              <p className="text-[11px] text-white/45">{k.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <h2 className="font-display font-bold text-ink-950">Hacim dağılımı</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-4">
          {bars.map((b, i) => (
            <div key={b.label}>
              <div className="flex h-36 items-end rounded-[12px] bg-canvas px-3 pb-2 pt-4">
                <div
                  className="bar-live w-full rounded-t-[8px] bg-[image:var(--grad-brand)]"
                  style={{ height: `${Math.max(8, (b.value / b.max) * 100)}%`, animationDelay: `${i * 80}ms` }}
                />
              </div>
              <p className="mt-2 text-center text-xs font-semibold text-ink-950">{b.label}</p>
              <p className="text-center font-display text-lg font-extrabold text-brand-600">{b.value}</p>
            </div>
          ))}
        </div>
      </section>

      {sourceBars.length > 0 ? (
        <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <div className="flex items-center gap-2">
            <PieChart className="h-4 w-4 text-brand-600" />
            <h2 className="font-display font-bold text-ink-950">Müşteri kaynak dağılımı</h2>
            <span className="ml-auto text-xs text-text-muted">{sourceTotal} müşteri</span>
          </div>
          <div className="mt-5 space-y-3">
            {sourceBars.map((b, i) => (
              <div key={b.label}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink-950">{b.label}</span>
                  <span className="tabular-nums text-text-muted">
                    {b.count} · %{Math.round((b.count / sourceTotal) * 100)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-canvas">
                  <div
                    className="bar-live h-full rounded-full bg-[image:var(--grad-brand)]"
                    style={{
                      width: `${Math.max((b.count / sourceMax) * 100, 4)}%`,
                      animationDelay: `${i * 60}ms`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Link href="/app/kayip-kacak" className="lift rounded-[16px] border border-line bg-surface p-4 hover:border-brand-400">
          <Siren className="h-4 w-4 text-danger-500" />
          <p className="mt-2 font-display font-bold">Kayıp-kaçak</p>
          <p className="text-xs text-text-muted">Teyit ve kapanış analizi</p>
        </Link>
        <Link href="/app/eslestirme" className="lift rounded-[16px] border border-line bg-surface p-4 hover:border-brand-400">
          <Crosshair className="h-4 w-4 text-brand-600" />
          <p className="mt-2 font-display font-bold">Eşleştirme</p>
          <p className="text-xs text-text-muted">Talep × portföy skorları</p>
        </Link>
        <Link href="/app/degerleme" className="lift rounded-[16px] border border-line bg-surface p-4 hover:border-brand-400">
          <Gauge className="h-4 w-4 text-violet-600" />
          <p className="mt-2 font-display font-bold">Değerleme</p>
          <p className="text-xs text-text-muted">Endeksa · Tapusor</p>
        </Link>
        <Link href="/app/musteriler" className="lift rounded-[16px] border border-line bg-surface p-4 hover:border-brand-400">
          <Users className="h-4 w-4 text-mint-600" />
          <p className="mt-2 font-display font-bold">Müşteri merkezi</p>
          <p className="text-xs text-text-muted">360 görünüm</p>
        </Link>
        <Link href="/app/franchise" className="lift rounded-[16px] border border-line bg-surface p-4 hover:border-brand-400">
          <Building2 className="h-4 w-4 text-amber-500" />
          <p className="mt-2 font-display font-bold">Şube analitiği</p>
          <p className="text-xs text-text-muted">Şube bazlı konsolide</p>
        </Link>
      </div>
    </div>
  );
}
