import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Gauge,
  Map as MapIcon,
  PieChart,
  Smile,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { EmptyStateV3 } from "@/components/ui/empty-state-v3";
import { createClient } from "@/lib/supabase/server";
import { getDefinitionsOrDefault, toLabelMap } from "@/lib/definitions";
import { defaultLabelMap } from "@/lib/definition-defaults";
import { requireModulePage } from "@/lib/require-module-page";
import { InteractiveChart } from "@/components/app/interactive-chart";
import { computeOfficeScore, type OfficeScoreInputs } from "@/lib/office-score";
import { now as clockNow } from "@/lib/clock";
import { ICONS } from "@/lib/icons";
import { requireReportingData } from "@/lib/reporting/result";
import { getTenantReportingAggregates } from "@/lib/reporting/cache";

type TenantReportingAggregate = {
  summary: {
    customers: number;
    demands: number;
    properties: number;
    live_portals: number;
    overdue_confirmations: number;
    month_commission: number;
    month_lost: number;
    prev_month_lost: number;
    month_new_demands: number;
    prev_month_new_demands: number;
    closures_30d: number;
    appointments_7d: number;
    calls_7d: number;
  };
  customer_sources: { source: string; customer_count: number }[];
  loss_reasons: { reason: string; deal_count: number; deal_value: number }[];
  roi: { source: string; customers: number; won_count: number; won_value: number }[];
  monthly: { month_start: string; income: number; expense: number }[];
};

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

/** Verilen anın İstanbul yerel takvim bileşenleri (yıl, ay [0-indeksli]) —
 *  tenant_reporting_aggregates artık ay sınırlarını İstanbul takvimine göre
 *  döndürüyor; UTC dizgesi doğrudan dilimlenirse (+03:00 farkı yüzünden)
 *  yanlış aya kayabilir. */
function istanbulYearMonth(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month") - 1 };
}

type TrendInfo = { label: string; dir: "up" | "down" | "flat" | "new"; good?: boolean };

/**
 * Dönem karşılaştırma rozeti — "%+12" / "%-8" / "%0"; önceki dönem 0 ise
 * oran anlamsız olduğundan "yeni" döner. `invert` kayıp gibi "artışı kötü"
 * metriklerde iyi/kötü rengini çevirir (dashboard'daki desenin kopyası).
 */
function calcTrend(current: number, previous: number, invert = false): TrendInfo {
  if (previous <= 0) {
    return current > 0 ? { label: "yeni", dir: "new" } : { label: "%0", dir: "flat" };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { label: "%0", dir: "flat" };
  const up = pct > 0;
  return {
    label: `%${up ? "+" : "-"}${Math.abs(pct)}`,
    dir: up ? "up" : "down",
    good: invert ? !up : up,
  };
}

/** Rozetin karanlık hero üzerindeki varyantı (dashboard TrendBadge deseni). */
function TrendBadge({ trend }: { trend: TrendInfo }) {
  const Icon = trend.dir === "down" ? TrendingDown : trend.dir === "flat" ? ArrowRight : TrendingUp;
  const cls =
    trend.dir === "new" || trend.dir === "flat"
      ? "text-white/60"
      : trend.good
        ? "text-mint-300"
        : "text-danger-400";
  return (
    <span className={`flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold tabular-nums ${cls}`}>
      <Icon className="h-3 w-3" /> {trend.label}
    </span>
  );
}

export default async function ReportsPage() {
  const { tenantId } = await requireModulePage("reports", "/app/raporlar");
  const supabase = await createClient();
  // Tanımlar RPC ile paralel başlar (eskiden RPC'den SONRA seri bekleniyordu).
  const sourceDefsPromise = getDefinitionsOrDefault("customer_source");
  // Ağır toplulaştırma: kısa TTL tenant-tag cache (src/lib/reporting/cache.ts).
  const [aggregateResult, sourceDefs] = await Promise.all([
    getTenantReportingAggregates(supabase, tenantId, clockNow()),
    sourceDefsPromise,
  ]);
  const aggregate = requireReportingData(
    "tenant-reporting-aggregates",
    aggregateResult,
  ) as unknown as TenantReportingAggregate;
  const summary = aggregate.summary;
  const scoreInputs: OfficeScoreInputs = {
    openDemands: Number(summary.demands),
    livePortals: Number(summary.live_portals),
    overdueConfirmations: Number(summary.overdue_confirmations),
    closures30d: Number(summary.closures_30d),
    appointments7d: Number(summary.appointments_7d),
    calls7d: Number(summary.calls_7d),
  };

  const office = computeOfficeScore(scoreInputs);
  // Skor bileşenleri — computeOfficeScore ile aynı formüller (baz 42 puan)
  const scoreFactors = [
    { label: "Açık talep", input: scoreInputs.openDemands, points: Math.min(18, scoreInputs.openDemands * 4), note: "+4/adet · maks 18" },
    { label: "Canlı portal ilanı", input: scoreInputs.livePortals, points: Math.min(16, scoreInputs.livePortals * 3), note: "+3/adet · maks 16" },
    { label: "Randevu (7 gün)", input: scoreInputs.appointments7d, points: Math.min(12, scoreInputs.appointments7d * 3), note: "+3/adet · maks 12" },
    { label: "Çağrı (7 gün)", input: scoreInputs.calls7d, points: Math.min(10, scoreInputs.calls7d * 2), note: "+2/adet · maks 10" },
    { label: "Kapanış (30 gün)", input: scoreInputs.closures30d, points: Math.min(12, scoreInputs.closures30d * 4), note: "+4/adet · maks 12" },
    { label: "Gecikmiş teyit cezası", input: scoreInputs.overdueConfirmations, points: -Math.min(28, scoreInputs.overdueConfirmations * 7), note: "−7/adet · maks −28" },
  ];
  const commissionTotal = Number(summary.month_commission);
  const lost = Number(summary.month_lost);
  const overdue = Number(summary.overdue_confirmations);

  // Ortak ölçek: her bar kendi değerine göre değil, en büyük değere göre ölçeklenir —
  // aksi halde tüm barlar %100 görünür ve grafik anlamsızlaşır.
  const customers = Number(summary.customers);
  const demands = Number(summary.demands);
  const properties = Number(summary.properties);
  const livePortals = Number(summary.live_portals);
  const barMax = Math.max(10, customers, demands, properties, livePortals);
  const bars = [
    { label: "Müşteri", value: customers, max: barMax, href: "/app/musteriler" },
    { label: "Talep", value: demands, max: barMax, href: "/app/talepler" },
    { label: "Portföy", value: properties, max: barMax, href: "/app/portfoyler" },
    { label: "Canlı portal", value: livePortals, max: barMax, href: "/app/portallar?durum=live" },
  ];

  // Müşteri kaynak dağılımı
  const sourceBars = aggregate.customer_sources
    .map((row) => ({ label: row.source, count: Number(row.customer_count) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    // value: müşteriler sayfasının ?source= filtresine giden ham DB değeri
    .map(({ label, count }) => ({ label, count, value: label === "Belirtilmedi" ? null : label }));
  const sourceTotal = Math.max(1, customers);
  const sourceMax = Math.max(1, ...sourceBars.map((b) => b.count));

  // Kayıp nedeni raporu — neden × adet + kaybedilen toplam değer
  const allLossRows = aggregate.loss_reasons.map((row) => ({
    reason: row.reason,
    count: Number(row.deal_count),
    value: Number(row.deal_value),
  }));
  const lostCount = allLossRows.reduce((sum, row) => sum + row.count, 0);
  const lostValue = allLossRows.reduce((sum, row) => sum + row.value, 0);
  const lossRows = allLossRows
    .sort((a, b) => b.count - a.count || b.value - a.value)
    .slice(0, 8);
  const lossMax = Math.max(1, ...lossRows.map((r) => r.count));

  // Kaynak ROI — customers.source × kazanılan anlaşmalar (customer_id join)
  // Etiketler: tek sabit kaynak (eski/yeni değerler) üstüne ofisin tanımları
  const SOURCE_LABELS: Record<string, string> = { ...defaultLabelMap("customer_source"), ...toLabelMap(sourceDefs) };
  const sourceLabel = (s: string) => SOURCE_LABELS[s] ?? s;
  const allRoiRows = aggregate.roi.map((row) => ({
    source: row.source,
    customers: Number(row.customers),
    wonCount: Number(row.won_count),
    wonValue: Number(row.won_value),
  }));
  const roiWonCount = allRoiRows.reduce((sum, row) => sum + row.wonCount, 0);
  const roiWonValue = allRoiRows.reduce((sum, row) => sum + row.wonValue, 0);
  const roiRows = allRoiRows
    .sort((a, b) => b.wonValue - a.wonValue || b.wonCount - a.wonCount || b.customers - a.customers)
    .slice(0, 8);
  const roiValueMax = Math.max(1, ...roiRows.map((r) => r.wonValue));
  // En değerli kaynak: kazanılan değeri sıfırdan büyük ilk satır
  const bestSource = roiRows.length > 0 && roiRows[0].wonValue > 0 ? roiRows[0].source : null;

  // Gelir/gider karşılaştırma trendi — 12 aylık kova: son 6'sı görünen dönem,
  // ilk 6'sı "hayalet" önceki dönem serisi (aynı sıradaki ay ile kıyaslanır).
  const MONTH_LABELS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const allMonths = aggregate.monthly.map((row) => {
    const { year, month } = istanbulYearMonth(row.month_start);
    return {
      key: `${year}-${String(month + 1).padStart(2, "0")}`,
      label: MONTH_LABELS[month],
      income: Number(row.income),
      expense: Number(row.expense),
    };
  });
  const prevPeriodMonths = allMonths.slice(0, 6);
  const trendMonths = allMonths.slice(6);
  const trendIncomeTotal = trendMonths.reduce((s, m) => s + m.income, 0);
  const trendExpenseTotal = trendMonths.reduce((s, m) => s + m.expense, 0);
  const trendNet = trendIncomeTotal - trendExpenseTotal;
  const hasTrendData = trendIncomeTotal > 0 || trendExpenseTotal > 0;
  const prevIncomeTotal = prevPeriodMonths.reduce((s, m) => s + m.income, 0);
  const hasPrevPeriodData = prevIncomeTotal > 0;

  // Hero KPI dönem rozetleri aynı tam-kapsamlı aggregate snapshot'tan gelir.
  const prevLost = Number(summary.prev_month_lost);
  const commissionMoM = calcTrend(trendMonths[5]?.income ?? 0, trendMonths[4]?.income ?? 0);
  const lostMoM = calcTrend(lost, prevLost, true);
  const demandFlowMoM = calcTrend(Number(summary.month_new_demands), Number(summary.prev_month_new_demands));

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-cyan-400">
              <BarChart3 className="h-3.5 w-3.5" /> Rapor merkezi
            </p>
            <h1 className="mt-2 font-display text-3xl font-extrabold">Ofis sağlık & performans</h1>
            <p className="mt-2 text-sm text-white/60">Gerçek toplulaştırma · sahte satış hattı yok.</p>
          </div>
          <details className="rounded-[var(--radius-card)] border border-white/10 bg-white/5">
            <summary className="focus-ring cursor-pointer list-none rounded-[var(--radius-card)] px-5 py-4 text-center transition hover:bg-white/5 [&::-webkit-details-marker]:hidden">
              <p className="font-display text-3xl font-extrabold text-mint-400">{office.score}</p>
              <p className="text-xs text-white/55">{office.label} ofis skoru · bileşenler ▾</p>
            </summary>
            <div className="border-t border-white/10 px-5 py-4 text-left">
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-white/45">
                Skor nasıl hesaplanır? Baz 42 puan
              </p>
              <ul className="mt-2 space-y-1.5 text-xs">
                {scoreFactors.map((f) => (
                  <li key={f.label} className="flex items-center justify-between gap-6">
                    <span className="text-white/70">
                      {f.label} <span className="text-white/40">({f.input} · {f.note})</span>
                    </span>
                    <span className={`numeric font-bold ${f.points >= 0 ? "text-mint-400" : "text-danger-400"}`}>
                      {f.points >= 0 ? "+" : ""}{f.points}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </div>
        <div className="stagger-grid relative mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Aylık komisyon", value: money(commissionTotal), icon: ICONS.komisyon, tone: "text-amber-300", href: "/app/komisyon", trend: commissionMoM, trendTitle: "Geçen aya göre" },
            { label: "Tahmini kayıp", value: money(lost), icon: ICONS.alarm, tone: "text-danger-400", href: "/app/kayip-kacak", trend: lostMoM, trendTitle: "Geçen aya göre" },
            // Gecikmiş teyit anlık (stok) bir metrik; geçmiş anlık görüntüsü
            // tutulmadığından dürüst bir dönem kıyası üretilemiyor — rozetsiz.
            // İkonografi: "Gecikmiş teyit" /app/portallar'a gidiyor ama Building2
            // (portföy ikonu) ile çiziliyordu — portal kavramı ICONS.portal.
            { label: "Gecikmiş teyit", value: String(overdue), icon: ICONS.portal, tone: "text-warn-400", href: "/app/portallar?durum=teyit", trend: undefined as TrendInfo | undefined, trendTitle: "" },
            { label: "Açık talep", value: String(demands), icon: ICONS.talep, tone: "text-mint-300", href: "/app/talepler", trend: demandFlowMoM, trendTitle: "Yeni talep akışı, geçen aya göre" },
          ].map((k) => (
            <Link
              key={k.label}
              href={k.href}
              className="focus-ring press lift group block rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4 hover:border-white/30"
            >
              <span className="flex items-start justify-between">
                <k.icon className={`h-4 w-4 ${k.tone}`} />
                <span className="flex items-center gap-1.5">
                  {k.trend ? (
                    <span title={k.trendTitle}>
                      <TrendBadge trend={k.trend} />
                    </span>
                  ) : null}
                  <ArrowUpRight className="hover-action h-4 w-4 text-white/30 opacity-0 transition group-hover:text-white group-hover:opacity-100" />
                </span>
              </span>
              <p className="mt-2 font-display text-xl font-extrabold">{k.value}</p>
              <p className="text-xs text-white/45">{k.label}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <h2 className="font-display font-bold text-ink-950">Hacim dağılımı</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-4">
          {bars.map((b, i) => (
            <Link key={b.label} href={b.href} className="focus-ring press group block rounded-[var(--radius-card)] p-1 -m-1">
              <div className="flex h-36 items-end rounded-[var(--radius-card)] bg-canvas px-3 pb-2 pt-4 transition group-hover:ring-1 group-hover:ring-brand-300">
                <div
                  className="bar-live w-full rounded-t-[var(--radius-control)] bg-[image:var(--grad-brand)]"
                  style={{ height: `${Math.max(8, (b.value / b.max) * 100)}%`, animationDelay: `${i * 80}ms` }}
                />
              </div>
              <p className="mt-2 flex items-center justify-center gap-1 text-center text-xs font-semibold text-ink-950">
                {b.label}
                <ArrowUpRight className="hover-action h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
              </p>
              <p className="text-center font-display text-lg font-extrabold text-brand-600">{b.value}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center gap-2">
          <ICONS.komisyon className="h-4 w-4 text-brand-600" />
          <h2 className="font-display font-bold text-ink-950">Gelir & gider · son 6 ay</h2>
          <div className="ml-auto flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-mint-500" /> Gelir</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-danger-500" /> Gider</span>
          </div>
        </div>

        {hasTrendData ? (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Link href="/app/komisyon" className="focus-ring press lift group block rounded-[var(--radius-card)] border border-line bg-canvas p-3 hover:border-brand-300">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                  <TrendingUp className="h-3.5 w-3.5 text-mint-600" /> Toplam gelir
                  <ArrowUpRight className="hover-action ml-auto h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </p>
                <p className="mt-1 font-display text-lg font-extrabold text-mint-600">{money(trendIncomeTotal)}</p>
              </Link>
              <Link href="/app/giderler" className="focus-ring press lift group block rounded-[var(--radius-card)] border border-line bg-canvas p-3 hover:border-brand-300">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                  <TrendingDown className="h-3.5 w-3.5 text-danger-500" /> Toplam gider
                  <ArrowUpRight className="hover-action ml-auto h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </p>
                <p className="mt-1 font-display text-lg font-extrabold text-danger-500">{money(trendExpenseTotal)}</p>
              </Link>
              <Link href="/app/komisyon" className="focus-ring press lift group block rounded-[var(--radius-card)] border border-line bg-canvas p-3 hover:border-brand-300">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                  <ICONS.komisyon className="h-3.5 w-3.5 text-brand-600" /> Net
                  <ArrowUpRight className="hover-action ml-auto h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </p>
                <p className={`mt-1 font-display text-lg font-extrabold ${trendNet >= 0 ? "text-mint-600" : "text-danger-500"}`}>{money(trendNet)}</p>
              </Link>
            </div>

            {/* Etkileşimli çizgi trend — crosshair + tooltip'te gelir/gider/net */}
            <InteractiveChart
              className="mt-5"
              data={trendMonths.map((m) => ({ label: m.label, value: m.income, value2: m.expense }))}
              name="Gelir"
              name2="Gider"
              color="var(--mint-500)"
              color2="var(--danger-500)"
              format="money"
              height={200}
              diffLabel="Net"
              showLegend={false}
            />

            {/* Önceki dönem "hayaleti" — gelir serisinin 6 ay önceki karşılığı
                aynı eksende soluk ikinci seri olarak (InteractiveChart'ın
                mevcut çift seri desteği; üstteki grafikte iki slot da
                gelir/gider tarafından dolu olduğundan kıyas ayrı çizgide). */}
            {hasPrevPeriodData ? (
              <div className="mt-6 border-t border-line pt-4">
                <p className="text-xs font-semibold text-text-muted">
                  Gelir · önceki dönemle karşılaştırma
                  <span className="ml-1 font-normal text-text-faint">(aynı sıradaki ay, 6 ay öncesi)</span>
                </p>
                <InteractiveChart
                  className="mt-3"
                  data={trendMonths.map((m, i) => ({
                    label: m.label,
                    value: m.income,
                    value2: prevPeriodMonths[i]?.income ?? 0,
                  }))}
                  name="Gelir"
                  name2="Önceki dönem"
                  color="var(--mint-500)"
                  color2="var(--text-faint)"
                  format="money"
                  height={160}
                  diffLabel="Fark"
                  showLegend
                />
              </div>
            ) : null}
          </>
        ) : (
          <p className="py-10 text-center text-sm text-text-muted">
            Henüz komisyon veya gider kaydı yok. Anlaşma kapatıp gider ekledikçe bu grafik dolacak.
          </p>
        )}
      </section>

      {sourceBars.length > 0 ? (
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <div className="flex items-center gap-2">
            <PieChart className="h-4 w-4 text-brand-600" />
            <h2 className="font-display font-bold text-ink-950">Müşteri kaynak dağılımı</h2>
            <span className="ml-auto text-xs text-text-muted">{sourceTotal} müşteri · en yüksek 8 kaynak</span>
          </div>
          <div className="mt-5 space-y-3">
            {sourceBars.map((b, i) => (
              <Link
                key={b.label}
                href={b.value ? `/app/musteriler?source=${encodeURIComponent(b.value)}` : "/app/musteriler"}
                className="focus-ring group block rounded-[var(--radius-control)] p-1 -m-1"
              >
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 font-semibold text-ink-950">
                    {b.label}
                    <ArrowUpRight className="hover-action h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                  </span>
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
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Kaynak ROI — hangi kaynak gerçekten kazandırıyor? */}
      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center gap-2">
          <Trophy className="h-4 w-4 text-brand-600" />
          <h2 className="font-display font-bold text-ink-950">Kaynak ROI · kazanılan anlaşmalar</h2>
          {roiRows.length > 0 ? (
            <span className="ml-auto text-xs text-text-muted">
              {roiWonCount} kazanılan · {money(roiWonValue)} · en yüksek 8 kaynak
            </span>
          ) : null}
        </div>
        {roiRows.length === 0 ? (
          <EmptyStateV3
            icon={<BarChart3 />}
            title="Henüz kaynak verisi yok"
            description="Müşterilere kaynak girip anlaşma kazandıkça kaynakların getirisi burada karşılaştırılır."
            action={<Link href="/app/musteriler" className="text-sm font-semibold text-brand-600 hover:underline">Müşterilere git</Link>}
          />
        ) : (
          <div className="mt-5 space-y-3">
            {roiRows.map((r, i) => {
              const best = r.source === bestSource;
              return (
                <div
                  key={r.source}
                  className={`rounded-[var(--radius-card)] p-2 ${best ? "bg-brand-600/[0.05] ring-1 ring-brand-400/40" : ""}`}
                >
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs">
                    <span className="flex items-center gap-1.5 font-semibold text-ink-950">
                      {sourceLabel(r.source)}
                      {best ? (
                        <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-bold text-brand-600">
                          En değerli kaynak
                        </span>
                      ) : null}
                    </span>
                    <span className="tabular-nums text-text-muted">
                      {r.customers} müşteri · {r.wonCount} kazanılan ·{" "}
                      <span className="font-semibold text-ink-950">{money(r.wonValue)}</span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-canvas">
                    <div
                      className={`bar-live h-full rounded-full ${best ? "bg-[image:var(--grad-brand)]" : "bg-mint-500"}`}
                      style={{
                        width: `${Math.max((r.wonValue / roiValueMax) * 100, 4)}%`,
                        animationDelay: `${i * 60}ms`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Kayıp nedeni raporu — kaybedilen anlaşmaların neden dağılımı */}
      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center gap-2">
          <TrendingDown className="h-4 w-4 text-danger-500" />
          <h2 className="font-display font-bold text-ink-950">Kayıp nedeni analizi</h2>
          {lostCount > 0 ? (
            <span className="ml-auto text-xs text-text-muted">
              {lostCount} kayıp · {money(lostValue)} kaybedilen değer · en yüksek 8 neden
            </span>
          ) : null}
        </div>
        {lossRows.length === 0 ? (
          <EmptyStateV3
            icon={<BarChart3 />}
            title="Henüz kaybedilen anlaşma yok"
            description="Anlaşma tahtasında “Kaybedildi”ye taşınan kartlar nedenleriyle burada toplanır."
            action={<Link href="/app/anlasmalar" className="text-sm font-semibold text-brand-600 hover:underline">Anlaşma tahtasına git</Link>}
          />
        ) : (
          <div className="mt-5 space-y-3">
            {lossRows.map((r, i) => (
              <Link
                key={r.reason}
                href="/app/anlasmalar"
                className="focus-ring group block rounded-[var(--radius-control)] p-1 -m-1"
              >
                <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                  <span className="flex min-w-0 items-center gap-1 font-semibold text-ink-950">
                    <span className="truncate">{r.reason}</span>
                    <ArrowUpRight className="hover-action h-3.5 w-3.5 shrink-0 text-text-faint opacity-0 transition group-hover:text-danger-500 group-hover:opacity-100" />
                  </span>
                  <span className="shrink-0 tabular-nums text-text-muted">
                    {r.count} · %{Math.round((r.count / Math.max(1, lostCount)) * 100)} · {money(r.value)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-canvas">
                  <div
                    className="bar-live h-full rounded-full bg-danger-500"
                    style={{
                      width: `${Math.max((r.count / lossMax) * 100, 4)}%`,
                      animationDelay: `${i * 60}ms`,
                    }}
                  />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/app/raporlar/talep-arz" className="lift rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-brand-400">
          <MapIcon className="h-4 w-4 text-brand-600" />
          <p className="mt-2 font-display font-bold">Talep-Arz Haritası</p>
          <p className="text-xs text-text-muted">İlçe bazlı talep-arz dengesi</p>
        </Link>
        <Link href="/app/raporlar/memnuniyet" className="lift rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-brand-400">
          <Smile className="h-4 w-4 text-mint-600" />
          <p className="mt-2 font-display font-bold">Memnuniyet (NPS)</p>
          <p className="text-xs text-text-muted">Kapanış sonrası anket skoru</p>
        </Link>
        <Link href="/app/kayip-kacak" className="lift rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-brand-400">
          <ICONS.alarm className="h-4 w-4 text-danger-500" />
          <p className="mt-2 font-display font-bold">Kayıp-kaçak</p>
          <p className="text-xs text-text-muted">Teyit ve kapanış analizi</p>
        </Link>
        <Link href="/app/eslestirme" className="lift rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-brand-400">
          <ICONS.eslestirme className="h-4 w-4 text-brand-600" />
          <p className="mt-2 font-display font-bold">Eşleştirme</p>
          <p className="text-xs text-text-muted">Talep × portföy skorları</p>
        </Link>
        <Link href="/app/degerleme" className="lift rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-brand-400">
          <Gauge className="h-4 w-4 text-cyan-600" />
          <p className="mt-2 font-display font-bold">Değerleme</p>
          <p className="text-xs text-text-muted">Endeksa · Tapusor</p>
        </Link>
        <Link href="/app/musteriler" className="lift rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-brand-400">
          <ICONS.musteri className="h-4 w-4 text-mint-600" />
          <p className="mt-2 font-display font-bold">Müşteri merkezi</p>
          <p className="text-xs text-text-muted">360 görünüm</p>
        </Link>
        <Link href="/app/franchise" className="lift rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-brand-400">
          {/* İkonografi: şube/franchise, portföy binası (Building2) ile aynı
              ikonu paylaşıyordu; ayrı kavram → ICONS.sube. */}
          <ICONS.sube className="h-4 w-4 text-amber-500" />
          <p className="mt-2 font-display font-bold">Şube analitiği</p>
          <p className="text-xs text-text-muted">Şube bazlı konsolide</p>
        </Link>
      </div>
    </div>
  );
}
