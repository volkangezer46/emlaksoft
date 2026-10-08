import { Suspense } from "react";
import { SkeletonCard } from "@/components/ui/viz";
import { KpiGrid } from "@/components/ui/dashboard-grid";
import { PageHeader } from "@/components/ui/page-header";
import { ReportCenter, ReportCenterEntry } from "@/components/report-center/report-center";
import { ReportTabs } from "@/components/report-center/report-tabs";
import Link from "@/components/ui/smart-link";
import {
  ArrowUpRight,
  BarChart3,
  Gauge,
  Map as MapIcon,
  PieChart,
  Smile,
  Trophy,
} from "lucide-react";
import { KpiCard, TrendPill, computeTrend } from "@/components/ui/premium";
import { HBarList } from "./hbar-list";
import { NetDiffChart } from "./net-diff-chart";
import { hasNetData, netSeries, shareOfMax, shareOfTotal } from "./report-math";
import { EmptyStateV3 } from "@/components/ui/empty-state";
import { createClient } from "@/lib/supabase/server";
import { aggregateSampleLabel, loadSampleKpiScope } from "@/lib/sample-scope";
import { SampleDataBadge } from "@/components/ui/sample-data-badge";
import { getDefinitionsOrDefault, getLossReasonOptions, toLabelMap } from "@/lib/definitions";
import { lossReasonGroupLabel, lossReasonLabels } from "@/lib/loss-reason";
import { defaultLabelMap } from "@/lib/definition-defaults";
import { requireModulePage } from "@/lib/require-module-page";
import { InteractiveChart } from "@/components/app/interactive-chart";
import { computeOfficeScore, type OfficeScoreInputs } from "@/lib/office-score";
import { now as clockNow } from "@/lib/clock";
import { ICONS } from "@/lib/icons";
import { requireReportingData } from "@/lib/reporting/result";
import { getTenantReportingAggregates } from "@/lib/reporting/cache";
import { getSettings } from "@/lib/settings/read";
import { DEFAULT_COMMISSION_RATE } from "@/lib/commission";

export const metadata = { title: "Raporlar" };

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
  /** 20261006000710 sonrası: örnek kayıtlar toplamlara dahil mi (yoksa undefined). */
  sample_included?: boolean;
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

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tenantId } = await requireModulePage("reports", "/app/raporlar");
  const sp = await searchParams;
  // Rapor merkezi sekmesi (?sekme=merkez): tüm dışa aktarma (Excel / PDF / CSV) burada; dashboard sorguları çalışmaz.
  if ((Array.isArray(sp.sekme) ? sp.sekme[0] : sp.sekme) === "merkez") {
    return (
      <div className="space-y-5">
        <ReportTabs scope="tenant" active="merkez" overviewLabel="Ofis sağlık & performans" />
        {/* Sekmeler anında gelir; katalog/önizleme akıtılır (sabit yükseklikli iskelet, düzen kaymaz). */}
        <Suspense fallback={<SkeletonCard height={480} label="Rapor merkezi yükleniyor" />}>
          <ReportCenter scope="tenant" params={sp} />
        </Suspense>
      </div>
    );
  }
  const supabase = await createClient();
  // Tanımlar RPC ile paralel başlar (eskiden RPC'den SONRA seri bekleniyordu).
  const sourceDefsPromise = getDefinitionsOrDefault("customer_source");
  // Ağır toplulaştırma: kısa TTL tenant-tag cache (src/lib/reporting/cache.ts).
  // Varsayılan komisyon oranı (kaçan komisyon tahmini) da aynı turda: eskiden sayfa ortasında ardışık bekleniyordu.
  const [aggregateResult, sourceDefs, lossOptions, sample, lossRateSettings] = await Promise.all([
    getTenantReportingAggregates(supabase, tenantId, clockNow()),
    sourceDefsPromise,
    getLossReasonOptions(),
    loadSampleKpiScope(supabase, tenantId),
    getSettings(["office.commission.default_rate"], { tenantId: tenantId ?? undefined }),
  ]);
  const aggregate = requireReportingData(
    "tenant-reporting-aggregates",
    aggregateResult,
  ) as unknown as TenantReportingAggregate;
  // Rapor özetleri SQL'de toplanır; örnek veri eşik kararını RPC verir (20261006000710, `sample_included`).
  // Migration yoksa RPC is_sample süzmez ve yüklü örnek veri her zaman etiketlenir.
  const sampleLabel = aggregateSampleLabel(sample.seeded, aggregate.sample_included);
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
  // Nedenler `loss_reason` tanımına bağlanır: "<değer>" ve "<değer> | not" aynı etiket altında toplanır;
  // eski serbest metin kayıtlar kendi adıyla ayrı satırda görünmeye devam eder.
  const lossLabels = lossReasonLabels(lossOptions);
  const lossGroups = new Map<string, { reason: string; count: number; value: number }>();
  for (const row of aggregate.loss_reasons) {
    const reason = lossReasonGroupLabel(row.reason, lossLabels);
    const g = lossGroups.get(reason) ?? { reason, count: 0, value: 0 };
    g.count += Number(row.deal_count);
    g.value += Number(row.deal_value);
    lossGroups.set(reason, g);
  }
  const allLossRows = [...lossGroups.values()];
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
  const commissionMoM = computeTrend(trendMonths[5]?.income ?? 0, trendMonths[4]?.income ?? 0);
  const lostMoM = computeTrend(lost, prevLost, true);
  const demandFlowMoM = computeTrend(Number(summary.month_new_demands), Number(summary.prev_month_new_demands));

  const netPoints = netSeries(trendMonths);
  const showNet = hasNetData(netPoints);
  const incomeSeries = trendMonths.map((m) => m.income);
  const prevCommission = trendMonths[4]?.income ?? 0;
  const incomeVsPrevPeriod = hasPrevPeriodData ? computeTrend(trendIncomeTotal, prevIncomeTotal) : undefined;

  const SECTION = "surface-card rounded-[var(--radius-panel)] p-5";
  const H2 = "font-display text-base font-bold tracking-[-0.015em] text-text";
  const ICON_ACCENT = "h-4 w-4 text-accent-text";
  const POS = "text-[color:var(--viz-pos)]";
  const NEG = "text-[color:var(--viz-neg)]";

  const volumeItems = bars.map((b) => ({
    key: b.label,
    label: b.label,
    href: b.href,
    pct: shareOfMax(b.value, b.max),
    valueText: String(b.value),
  }));
  const sourceItems = sourceBars.map((b) => ({
    key: b.label,
    label: b.value ? sourceLabel(b.value) : b.label,
    href: b.value ? `/app/musteriler?source=${encodeURIComponent(b.value)}` : "/app/musteriler",
    pct: shareOfMax(b.count, sourceMax),
    valueText: `${b.count} · %${shareOfTotal(b.count, sourceTotal)}`,
  }));
  const roiItems = roiRows.map((r) => ({
    key: r.source,
    label: sourceLabel(r.source),
    href: `/app/musteriler?source=${encodeURIComponent(r.source)}`,
    pct: shareOfMax(r.wonValue, roiValueMax),
    valueText: money(r.wonValue),
    sub: `${r.customers} müşteri · ${r.wonCount} kazanılan`,
    highlight: r.source === bestSource,
  }));
  // Tahmini kaçan komisyon: kaybedilen anlaşma tutarı × ofis varsayılan komisyon oranı (Ofis Tanımları; yoksa %3). TAHMİN.
  const lossRate = Number(lossRateSettings["office.commission.default_rate"] ?? DEFAULT_COMMISSION_RATE) || DEFAULT_COMMISSION_RATE;
  const lostCommission = (v: number) => Math.round(v * (lossRate / 100));
  const lossItems = lossRows.map((r) => ({
    key: r.reason,
    label: r.reason,
    href: "/app/anlasmalar?gorunum=liste&asama=lost",
    pct: shareOfMax(r.count, lossMax),
    valueText: `${r.count} · %${shareOfTotal(r.count, lostCount)} · ${money(r.value)}${r.value > 0 ? ` · ≈ ${money(lostCommission(r.value))} komisyon` : ""}`,
  }));

  return (
    <div className="space-y-6">
      <ReportTabs scope="tenant" active="ozet" overviewLabel="Ofis sağlık & performans" />
      <Suspense fallback={<SkeletonCard height={168} label="Rapor merkezi yükleniyor" />}>
        <ReportCenterEntry scope="tenant" />
      </Suspense>
      <PageHeader
        eyebrow="Raporlar"
        freshness
        title="Ofis sağlık & performans"
        meta={<SampleDataBadge label={sampleLabel} />}
        description="Gerçek toplulaştırma · sahte satış hattı yok."
        actions={
          <details className="surface-card rounded-[var(--radius-card)]">
            <summary className="focus-ring cursor-pointer list-none rounded-[var(--radius-card)] px-5 py-3 text-center transition hover:bg-surface-hover [&::-webkit-details-marker]:hidden">
              <p className={`font-display text-2xl font-extrabold tabular-nums ${POS}`}>{office.score}</p>
              <p className="text-xs text-text-muted">{office.label} ofis skoru · bileşenler ▾</p>
            </summary>
            <div className="border-t border-line px-5 py-4 text-left">
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-text-muted">
                Skor nasıl hesaplanır? Baz 42 puan
              </p>
              <ul className="mt-2 space-y-1.5 text-xs">
                {scoreFactors.map((f) => (
                  <li key={f.label} className="flex items-center justify-between gap-6">
                    <span className="text-text">
                      {f.label} <span className="text-text-muted">({f.input} · {f.note})</span>
                    </span>
                    <span className={`numeric font-bold tabular-nums ${f.points >= 0 ? POS : NEG}`}>
                      {f.points >= 0 ? "+" : ""}{f.points}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        }
      />

      <KpiGrid label="Öne çıkan göstergeler">
        <KpiCard
          label="Aylık komisyon"
          value={money(commissionTotal)}
          icon={ICONS.komisyon}
          tone="gold"
          href="/app/komisyon"
          trend={commissionMoM}
          previousText={`Önceki ay ${money(prevCommission)}`}
          series={incomeSeries}
          chart="bars"
          seriesUnit="ay"
          seriesLabel="Son 6 ay gelir"
        />
        <KpiCard
          label="Kaçan komisyon (tahmini)"
          value={money(lost)}
          icon={ICONS.alarm}
          tone="danger"
          href="/app/kayip-kacak"
          trend={lostMoM}
          previousText={`Önceki ay ${money(prevLost)}`}
        />
        {/* Gecikmiş teyit anlık (stok) bir metrik; geçmiş anlık görüntüsü tutulmadığından
            dürüst bir dönem kıyası yok: trend/seri çizilmez. */}
        <KpiCard
          label="Gecikmiş teyit"
          value={String(overdue)}
          icon={ICONS.portal}
          tone="warn"
          href="/app/portallar?durum=teyit"
          attention={overdue > 0}
          hint="Anlık durum · dönem kıyası yok"
        />
        <KpiCard
          label="Açık talep"
          value={String(demands)}
          icon={ICONS.talep}
          tone="success"
          href="/app/talepler"
          trend={demandFlowMoM}
          previousText={`Bu ay yeni ${summary.month_new_demands} · önceki ay ${summary.prev_month_new_demands}`}
        />
      </KpiGrid>

      <section className={SECTION} style={{ boxShadow: "var(--elev-3)" }}>
        <div className="flex flex-wrap items-center gap-2">
          <ICONS.komisyon className={ICON_ACCENT} aria-hidden="true" />
          <h2 className={H2}>Gelir &amp; gider · son 6 ay</h2>
          <div className="ml-auto flex items-center gap-4 text-xs text-text-muted">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--viz-pos)" }} /> Gelir</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--viz-neg)" }} /> Gider</span>
          </div>
        </div>

        {hasTrendData ? (
          <>
            <dl className="mt-3 grid divide-y divide-line/60 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <Link href="/app/komisyon" className="focus-ring group block min-h-10 rounded-[var(--radius-control)] px-3 py-2 transition hover:bg-surface-hover">
                <dt className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                  Toplam gelir
                  <ArrowUpRight className="ml-auto h-4 w-4 text-text-faint opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
                </dt>
                <dd className={`mt-1 font-display text-lg font-extrabold tabular-nums ${POS}`}>
                  {money(trendIncomeTotal)}
                  {incomeVsPrevPeriod ? <TrendPill trend={incomeVsPrevPeriod} className="ml-2 align-middle" /> : null}
                </dd>
                {hasPrevPeriodData ? <p className="text-xs tabular-nums text-text-faint">Önceki 6 ay {money(prevIncomeTotal)}</p> : null}
              </Link>
              <Link href="/app/giderler" className="focus-ring group block min-h-10 rounded-[var(--radius-control)] px-3 py-2 transition hover:bg-surface-hover">
                <dt className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                  Toplam gider
                  <ArrowUpRight className="ml-auto h-4 w-4 text-text-faint opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
                </dt>
                <dd className={`mt-1 font-display text-lg font-extrabold tabular-nums ${NEG}`}>{money(trendExpenseTotal)}</dd>
              </Link>
              <Link href="/app/komisyon" className="focus-ring group block min-h-10 rounded-[var(--radius-control)] px-3 py-2 transition hover:bg-surface-hover">
                <dt className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                  Net
                  <ArrowUpRight className="ml-auto h-4 w-4 text-text-faint opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
                </dt>
                <dd className={`mt-1 font-display text-lg font-extrabold tabular-nums ${trendNet >= 0 ? POS : NEG}`}>{money(trendNet)}</dd>
              </Link>
            </dl>

            {/* Etkileşimli çizgi trend — crosshair + tooltip'te gelir/gider/net (a11y tablo + klavye bileşende) */}
            <InteractiveChart
              className="mt-5"
              data={trendMonths.map((m) => ({ label: m.label, value: m.income, value2: m.expense }))}
              name="Gelir"
              name2="Gider"
              color="var(--viz-pos)"
              color2="var(--viz-neg)"
              format="money"
              height={200}
              diffLabel="Net"
              showLegend={false}
            />

            {showNet ? (
              <div className="mt-6 border-t border-line pt-4">
                <h3 className="text-xs font-semibold text-text-muted">
                  Net fark · gelir eksi gider
                  <span className="ml-1 font-normal text-text-faint">(sıfır çizgisinin üstü kâr, altı zarar)</span>
                </h3>
                <NetDiffChart className="mt-3" points={netPoints} />
              </div>
            ) : null}

            {/* Önceki dönem "hayaleti" — gelir serisinin 6 ay önceki karşılığı (aynı sıradaki ay) */}
            {hasPrevPeriodData ? (
              <div className="mt-6 border-t border-line pt-4">
                <h3 className="text-xs font-semibold text-text-muted">
                  Gelir · önceki dönemle karşılaştırma
                  <span className="ml-1 font-normal text-text-faint">(aynı sıradaki ay, 6 ay öncesi)</span>
                </h3>
                <InteractiveChart
                  className="mt-3"
                  data={trendMonths.map((m, i) => ({
                    label: m.label,
                    value: m.income,
                    value2: prevPeriodMonths[i]?.income ?? 0,
                  }))}
                  name="Gelir"
                  name2="Önceki dönem"
                  color="var(--viz-pos)"
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
          <EmptyStateV3
            illustration="rapor"
            icon={<BarChart3 />}
            title="Henüz komisyon veya gider kaydı yok"
            description="Anlaşma kapatıp gider ekledikçe bu grafik dolacak."
            action={<Link href="/app/giderler" className="text-sm font-semibold text-accent-text hover:underline">Giderlere git</Link>}
          />
        )}
      </section>

      <section className={SECTION}>
        <h2 className={H2}>Hacim dağılımı</h2>
        <p className="mt-0.5 text-xs text-text-faint">Dört sayı ortak ölçekte; satıra tıklayınca liste açılır.</p>
        <HBarList className="mt-3" items={volumeItems} ariaLabel="Hacim dağılımı" />
      </section>

      {sourceItems.length > 0 ? (
        <section className={SECTION}>
          <div className="flex items-center gap-2">
            <PieChart className={ICON_ACCENT} aria-hidden="true" />
            <h2 className={H2}>Müşteri kaynak dağılımı</h2>
            <span className="ml-auto text-xs tabular-nums text-text-muted">{sourceTotal} müşteri · en yüksek 8 kaynak</span>
          </div>
          <HBarList className="mt-3" items={sourceItems} ariaLabel="Müşteri kaynak dağılımı" />
        </section>
      ) : null}

      {/* Kaynak ROI — hangi kaynak gerçekten kazandırıyor? */}
      <section className={SECTION}>
        <div className="flex flex-wrap items-center gap-2">
          <Trophy className={ICON_ACCENT} aria-hidden="true" />
          <h2 className={H2}>Kaynak ROI · kazanılan anlaşmalar</h2>
          {roiRows.length > 0 ? (
            <span className="ml-auto text-xs tabular-nums text-text-muted">
              {roiWonCount} kazanılan · {money(roiWonValue)} · en yüksek 8 kaynak
            </span>
          ) : null}
        </div>
        {roiRows.length === 0 ? (
          <EmptyStateV3
            illustration="rapor"
            icon={<BarChart3 />}
            title="Henüz kaynak verisi yok"
            description="Müşterilere kaynak girip anlaşma kazandıkça kaynakların getirisi burada karşılaştırılır."
            action={<Link href="/app/musteriler" className="text-sm font-semibold text-accent-text hover:underline">Müşterilere git</Link>}
          />
        ) : (
          <HBarList className="mt-3" items={roiItems} tone="success" ariaLabel="Kaynak bazında kazanılan değer" />
        )}
      </section>

      {/* Kayıp nedeni raporu — kaybedilen anlaşmaların neden dağılımı */}
      <section className={SECTION}>
        <div className="flex flex-wrap items-center gap-2">
          <ICONS.alarm className={`h-4 w-4 ${NEG}`} aria-hidden="true" />
          <h2 className={H2}>Kaybedilen anlaşmalar: kayıp nedeni analizi</h2>
          {lostCount > 0 ? (
            <span className="ml-auto text-xs tabular-nums text-text-muted">
              {lostCount} kaybedilen anlaşma · {money(lostValue)} kaybedilen değer · tahmini kaçan komisyon ≈ {money(lostCommission(lostValue))} (%{lossRate}) · en yüksek 8 neden
            </span>
          ) : null}
        </div>
        {lossRows.length === 0 ? (
          <EmptyStateV3
            illustration="rapor"
            icon={<BarChart3 />}
            title="Henüz kaybedilen anlaşma yok"
            description="Anlaşma tahtasında “Kaybedildi”ye taşınan kartlar nedenleriyle burada toplanır."
            action={<Link href="/app/anlasmalar" className="text-sm font-semibold text-accent-text hover:underline">Anlaşma tahtasına git</Link>}
          />
        ) : (
          <HBarList className="mt-3" items={lossItems} tone="danger" ariaLabel="Kayıp nedenleri" />
        )}
      </section>

      <nav aria-label="İlgili raporlar" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { href: "/app/raporlar/talep-arz", icon: MapIcon, title: "Talep-Arz Haritası", sub: "İlçe bazlı talep-arz dengesi" },
          { href: "/app/raporlar/memnuniyet", icon: Smile, title: "Memnuniyet (NPS)", sub: "Kapanış sonrası anket skoru" },
          { href: "/app/raporlar/lead-hizi", icon: Gauge, title: "Aday Hızı", sub: "İlk temasa geçen süre ve hedef uyumu" },
          { href: "/app/kayip-kacak", icon: ICONS.alarm, title: "Kaçan komisyonlar", sub: "Teyit ve kapanış analizi" },
          { href: "/app/eslestirme", icon: ICONS.eslestirme, title: "Eşleştirme", sub: "Talep × portföy skorları" },
          { href: "/app/degerleme", icon: Gauge, title: "Değerleme", sub: "Emsal · EmlakFiyati endeksi" },
          { href: "/app/musteriler", icon: ICONS.musteri, title: "Müşteri merkezi", sub: "360 görünüm" },
          { href: "/app/franchise", icon: ICONS.sube, title: "Şube analitiği", sub: "Şube bazlı konsolide" },
        ].map((l) => (
          <Link key={l.href} href={l.href} className="focus-ring lift surface-card flex min-h-14 items-center gap-3 rounded-[var(--radius-card)] p-3 transition hover:bg-surface-hover">
            <l.icon className={ICON_ACCENT} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block font-display text-sm font-bold text-text">{l.title}</span>
              <span className="block text-xs text-text-muted">{l.sub}</span>
            </span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
