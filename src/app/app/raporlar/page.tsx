import { financePath } from "@/lib/finance/routes";
import { measureAll } from "@/lib/server-timing";
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
  ShieldCheck,
  Smile,
  Timer,
  Filter,
} from "lucide-react";
import { KpiCard, TrendPill, computeTrend } from "@/components/ui/premium";
import { RankBars } from "./rank-bars";
import { ReportScopeBar } from "./_parts/report-scope-bar";
import { PeriodOverview } from "./_parts/period-overview";
import { loadReportScopeContext } from "./_parts/report-scope";
import { NetBars } from "./net-bars";
import { hasNetData, netSeries } from "./report-math";
import { EmptyStateV3 } from "@/components/ui/empty-state";
import { createClient } from "@/lib/supabase/server";
import { aggregateSampleLabel, loadSampleKpiScope } from "@/lib/sample-scope";
import { SampleDataBadge } from "@/components/ui/sample-data-badge";
import { requireModulePage } from "@/lib/require-module-page";
import { InteractiveChart } from "@/components/app/interactive-chart";
import { computeOfficeScore, type OfficeScoreInputs } from "@/lib/office-score";
import { now as clockNow } from "@/lib/clock";
import { ICONS } from "@/lib/icons";
import { requireReportingData } from "@/lib/reporting/result";
import { getTenantReportingAggregates, getViewerReportingAggregates } from "@/lib/reporting/cache";
import { getSettings } from "@/lib/settings/read";
import { DEFAULT_COMMISSION_RATE } from "@/lib/commission";

export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).sekme;
  return { title: (Array.isArray(raw) ? raw[0] : raw) === "merkez" ? "Rapor merkezi · Raporlar" : "Raporlar" };
}

/** Ofis geneli (kullanıcıdan bağımsız, kiracı önbellekli) kısım — `tenant_reporting_aggregates` (20261016060000). */
type TenantReportingAggregate = {
  summary: {
    customers: number;
    demands: number;
    properties: number;
    live_portals: number;
    overdue_confirmations: number;
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
  /** 20261006000710 sonrası: örnek kayıtlar toplamlara dahil mi (yoksa undefined). */
  sample_included?: boolean;
};

/**
 * İzleyene göre değişen kısım — `tenant_reporting_viewer_aggregates` (önbelleksiz). Ay anahtarı `ym` (YYYY-MM, İstanbul
 * yerel ayı); `expense` yalnız expenses:view ile dolu, yoksa null. earnings_all yoksa gelir yalnız kullanıcının kendi komisyonu.
 */
type ViewerReportingAggregate = {
  month_ym: string;
  month_commission: number;
  monthly: { ym: string; month_start: string; income: number; expense: number | null }[];
  earnings_scope: "office" | "own";
  expense_visible: boolean;
};

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

/** Gelir/gider trend kutusundaki etiket bağlantısı: ::after ile tüm kutuyu tıklanır yapar (dl yapısı bozulmadan). */
const TREND_LINK =
  "focus-ring flex items-center gap-1.5 rounded-[var(--radius-control)] after:absolute after:inset-0 after:rounded-[var(--radius-control)] after:content-['']";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tenantId, role, userId } = await requireModulePage("reports", "/app/raporlar");
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
  // Ofis geneli toplulaştırma kısa TTL kiracı önbelleğinden; izleyene göre değişen komisyon/gider serisi önbelleksiz hafif
  // RPC'den (src/lib/reporting/cache.ts, B158). Dönem/kapsam seçicisi (OA1) aynı turda; dönem raporu aşağıda akıtılır.
  // Varsayılan komisyon oranı (kaçan komisyon tahmini) da aynı turda: eskiden sayfa ortasında ardışık bekleniyordu.
  const asOf = clockNow();
  const [aggregateResult, viewerResult, sample, lossRateSettings, scopeCtx] = await measureAll("raporlar-veri", [
    getTenantReportingAggregates(supabase, tenantId, asOf),
    getViewerReportingAggregates(supabase, asOf),
    loadSampleKpiScope(supabase, tenantId),
    getSettings(["office.commission.default_rate"], { tenantId: tenantId ?? undefined }),
    loadReportScopeContext(supabase, { sp, role, userId, tenantId, nowMs: asOf }),
  ]);
  const aggregate = requireReportingData(
    "tenant-reporting-aggregates",
    aggregateResult,
  ) as unknown as TenantReportingAggregate;
  const viewer = requireReportingData(
    "tenant-reporting-viewer-aggregates",
    viewerResult,
  ) as unknown as ViewerReportingAggregate;
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
  const commissionTotal = Number(viewer.month_commission);
  const expenseVisible = viewer.expense_visible === true;
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
    { label: "Canlı portal", value: livePortals, max: barMax, href: "/app/ilan-kontrol/portallar?durum=live" },
  ];

  // Gelir/gider karşılaştırma trendi — 12 aylık kova: son 6'sı görünen dönem,
  // ilk 6'sı "hayalet" önceki dönem serisi (aynı sıradaki ay ile kıyaslanır).
  // Ay anahtarı RPC'nin `ym` alanıdır (İstanbul yerel ayı, B077): konum ya da UTC dizgesi kullanılmaz; aynı ay iki satırda
  // gelirse toplanır (+=). Gider serisi expenses:view yoksa null gelir ve hiç çizilmez.
  const MONTH_LABELS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const monthMap = new Map<string, { key: string; label: string; income: number; expense: number }>();
  for (const row of viewer.monthly ?? []) {
    const key = String(row.ym ?? "");
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    const m = monthMap.get(key) ?? { key, label: MONTH_LABELS[Number(key.slice(5, 7)) - 1] ?? key, income: 0, expense: 0 };
    m.income += Number(row.income ?? 0);
    m.expense += expenseVisible ? Number(row.expense ?? 0) : 0;
    monthMap.set(key, m);
  }
  const allMonths = [...monthMap.values()].sort((a, b) => a.key.localeCompare(b.key));
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
  const showNet = expenseVisible && hasNetData(netPoints);
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
    value: b.value,
    valueText: String(b.value),
  }));
  // Tahmini kaçan komisyon: kaybedilen anlaşma tutarı × ofis varsayılan komisyon oranı (Ofis Tanımları; yoksa %3). TAHMİN.
  const lossRate = Number(lossRateSettings["office.commission.default_rate"] ?? DEFAULT_COMMISSION_RATE) || DEFAULT_COMMISSION_RATE;

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

      <ReportScopeBar path="/app/raporlar" ctx={scopeCtx} />

      <KpiGrid label="Öne çıkan göstergeler">
        <KpiCard
          label="Aylık komisyon"
          value={money(commissionTotal)}
          icon={ICONS.komisyon}
          tone="gold"
          href={financePath("komisyon")}
          trend={commissionMoM}
          previousText={`Önceki ay ${money(prevCommission)}${viewer.earnings_scope === "own" ? " · yalnız sizin kayıtlarınız" : ""}`}
          series={incomeSeries}
          chart="bars"
          seriesUnit="ay"
          seriesLabel="Son 6 ay gelir"
        />
        <KpiCard
          label="Kaçan komisyon"
          title="Kaçırılmış komisyonların tahmini toplamı"
          value={money(lost)}
          icon={ICONS.alarm}
          tone="danger"
          href="/app/ilan-kontrol/kapanis"
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
          href="/app/ilan-kontrol/portallar?durum=teyit"
          attention={overdue > 0}
          hint="Anlık durum · dönem karşılaştırması yok"
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
          <h2 className={H2}>{expenseVisible ? <>Gelir &amp; gider · son 6 ay</> : "Gelir · son 6 ay"}</h2>
          <div className="ml-auto flex items-center gap-4 text-xs text-text-muted">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--viz-pos)" }} /> Gelir</span>
            {expenseVisible ? (
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--viz-neg)" }} /> Gider</span>
            ) : null}
          </div>
        </div>

        {hasTrendData ? (
          <>
            {/* dl > div > dt + dd (geçerli tanım listesi). Kartın tamamı tıklanır: bağlantı dt içinde, ::after ile kutuyu kaplar. */}
            <dl className={`mt-3 grid divide-y divide-line/60 sm:divide-x sm:divide-y-0 ${expenseVisible ? "sm:grid-cols-3" : "sm:grid-cols-1"}`}>
              <div className="group relative min-h-10 rounded-[var(--radius-control)] px-3 py-2 transition hover:bg-surface-hover touch:min-h-11">
                <dt className="text-xs font-semibold text-text-muted">
                  <Link href={financePath("komisyon")} className={TREND_LINK}>
                    Toplam gelir
                    <ArrowUpRight className="ml-auto h-4 w-4 text-text-faint opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
                  </Link>
                </dt>
                <dd className={`mt-1 font-display text-lg font-extrabold tabular-nums ${POS}`}>
                  {money(trendIncomeTotal)}
                  {incomeVsPrevPeriod ? <TrendPill trend={incomeVsPrevPeriod} className="ml-2 align-middle" /> : null}
                </dd>
                {hasPrevPeriodData ? <dd className="text-xs tabular-nums text-text-faint">Önceki 6 ay {money(prevIncomeTotal)}</dd> : null}
              </div>
              {expenseVisible ? (
                <>
                  <div className="group relative min-h-10 rounded-[var(--radius-control)] px-3 py-2 transition hover:bg-surface-hover touch:min-h-11">
                    <dt className="text-xs font-semibold text-text-muted">
                      <Link href={financePath()} className={TREND_LINK}>
                        Toplam gider
                        <ArrowUpRight className="ml-auto h-4 w-4 text-text-faint opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
                      </Link>
                    </dt>
                    <dd className={`mt-1 font-display text-lg font-extrabold tabular-nums ${NEG}`}>{money(trendExpenseTotal)}</dd>
                  </div>
                  <div className="group relative min-h-10 rounded-[var(--radius-control)] px-3 py-2 transition hover:bg-surface-hover touch:min-h-11">
                    <dt className="text-xs font-semibold text-text-muted">
                      <Link href={financePath("komisyon")} className={TREND_LINK}>
                        Net
                        <ArrowUpRight className="ml-auto h-4 w-4 text-text-faint opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
                      </Link>
                    </dt>
                    <dd className={`mt-1 font-display text-lg font-extrabold tabular-nums ${trendNet >= 0 ? POS : NEG}`}>{money(trendNet)}</dd>
                  </div>
                </>
              ) : null}
            </dl>

            {/* Etkileşimli çizgi trend — crosshair + tooltip'te gelir/gider/net (a11y tablo + klavye bileşende) */}
            <InteractiveChart
              className="mt-5"
              data={trendMonths.map((m) => (expenseVisible ? { label: m.label, value: m.income, value2: m.expense } : { label: m.label, value: m.income }))}
              name="Gelir"
              name2={expenseVisible ? "Gider" : undefined}
              color="var(--viz-pos)"
              color2={expenseVisible ? "var(--viz-neg)" : undefined}
              format="money"
              height={200}
              diffLabel={expenseVisible ? "Net" : undefined}
              showLegend={false}
            />

            {showNet ? (
              <div className="mt-6 border-t border-line pt-4">
                <h3 className="text-xs font-semibold text-text-muted">
                  Net fark · gelir eksi gider
                  <span className="ml-1 font-normal text-text-faint">(sıfır çizgisinin üstü kâr, altı zarar)</span>
                </h3>
                <NetBars className="mt-3" points={netPoints} />
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
            title={expenseVisible ? "Henüz komisyon veya gider kaydı yok" : "Henüz komisyon kaydı yok"}
            description="Anlaşma kapatıp gider ekledikçe bu grafik dolacak."
            action={<Link href={financePath()} className="text-sm font-semibold text-accent-text hover:underline">Giderlere git</Link>}
          />
        )}
      </section>

      <section className={SECTION}>
        <h2 className={H2}>Hacim dağılımı</h2>
        <p className="mt-0.5 text-xs text-text-faint">Dört sayı ortak ölçekte; satıra tıklayınca liste açılır.</p>
        <RankBars className="mt-3" items={volumeItems} ariaLabel="Hacim dağılımı" seriesLabel="Adet" />
      </section>

      <Suspense fallback={<SkeletonCard height={640} label="Dönem raporu yükleniyor" />}>
        <PeriodOverview ctx={scopeCtx} lossRate={lossRate} />
      </Suspense>

      <nav aria-label="İlgili raporlar" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { href: "/app/raporlar/huni", icon: Filter, title: "Satış hunisi", sub: "Müşteri → randevu → teklif → kazanılan; kaynak ROI" },
          { href: "/app/raporlar/satis-hizi", icon: Timer, title: "Satış hızı", sub: "Aşamada geçen gün, dönüşüm ve kapanış süresi" },
          { href: "/app/raporlar/talep-arz", icon: MapIcon, title: "Talep-Arz Haritası", sub: "İlçe bazlı talep-arz dengesi" },
          { href: "/app/anketler?sekme=sonuc", icon: Smile, title: "Memnuniyet (NPS)", sub: "Kapanış sonrası anket skoru" },
          { href: "/app/raporlar/lead-hizi", icon: Gauge, title: "Yanıt Hızı", sub: "İlk temasa geçen süre ve hedef uyumu" },
          { href: "/app/raporlar/yetki-uyum", icon: ShieldCheck, title: "Yetki uyum raporu", sub: "EİDS iptali sonrası kaldırma süresi" },
          { href: "/app/ilan-kontrol/kapanis", icon: ICONS.alarm, title: "Kaçan komisyonlar", sub: "Teyit ve kapanış analizi" },
          { href: "/app/talepler?sekme=eslesme", icon: ICONS.eslestirme, title: "Eşleştirme", sub: "Talep × portföy skorları" },
          { href: "/app/degerleme", icon: Gauge, title: "Değerleme", sub: "Emsal · EmlakFiyati endeksi" },
          { href: "/app/musteriler", icon: ICONS.musteri, title: "Müşteri merkezi", sub: "360 görünüm" },
          { href: "/app/franchise", icon: ICONS.sube, title: "Şube karşılaştırma", sub: "Şube bazlı konsolide" },
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
