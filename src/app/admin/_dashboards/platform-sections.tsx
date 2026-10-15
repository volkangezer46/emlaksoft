import { HEALTH_DEFAULT_RISK_THRESHOLD } from "@/lib/admin/health-score";
import { CRM_SETTING_KEYS } from "@/lib/settings/registry/crm";
import { getSetting } from "@/lib/settings/read";
import { cache } from "react";
import Link from "@/components/ui/smart-link";
import {
  BrainCircuit,
  Building2,
  Crown,
  FlaskConical,
  Gauge,
  MessageSquareWarning,
  PieChart,
  Plus,
  Rocket,
  ShieldAlert,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { daysAgoIso, now, trMonthStartIso, trParts } from "@/lib/clock";
import { monthlyUsageFromSums, parseDashboardRollups } from "@/lib/admin/dashboard-rollups";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { EmptyState } from "@/components/ui/empty-state";
import { computeTrend, type Period } from "@/components/ui/premium";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { ChartCard } from "@/components/ui/chart-frame";
import { AreaTrend, AreaTrendChart, BarCompare } from "@/components/ui/viz/server-charts";
import { AttentionList } from "@/components/ui/attention-list";
import { StackedBar } from "@/components/admin/admin-bars";
import { getAdminHealth, liveOpenTickets } from "@/lib/admin-badges";
import { ADMIN_DASHBOARD_TAG } from "@/lib/admin/counter-tags";
import { TICKET_OPEN_STATUSES } from "@/lib/support/ticket-contract";
import { getPlatformInsights } from "@/lib/insights/platform-read";
import { PlatformInsightList } from "../_components/platform-insight-list";
import { readLatestEfReconciliation } from "@/lib/ef-credits/reconcile-reader";
import {
  attentionLevel,
  buildAttentionQueue,
  buildChurnRows,
  type AttentionInput,
  type AttentionRow,
  ATTENTION_LIMIT,
  type ChurnLevel,
  type ChurnSignal,
} from "@/lib/admin/dashboard-layout";
import { arpaSeries, linearForecast, nextMonthLabels } from "@/lib/admin/platform-metrics";
import { platformCanAccess, type PlatformAccessSubject } from "@/lib/platform-access";
import { relativeTimeTR } from "@/lib/admin-format";
import { formatTry } from "@/lib/format";
import { getPlanDefinitions } from "@/lib/billing/plan-definitions";
import { exactArr, exactMrr, exactTrendMrr, priceMapOf, type PlatformReportingAggregate } from "@/lib/reporting/platform";
import { requireReportingCount, requireReportingData } from "@/lib/reporting/result";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

/**
 * Platform panel bölümleri (sunucu; /admin ve /admin/raporlar ortak). /admin yalnız dikkat kuyruğu + 4 özet göstergeyi,
 * /admin/raporlar analiz bölümlerini (MRR, churn, aktivasyon, birim ekonomisi, tüketim, iptal nedenleri, büyüme,
 * gelir kompozisyonu) çizer; bölüm listesi `platformReportSections` (dashboard-layout.ts).
 * Kontrol paneli (tasarım sistemi v4 referans uygulaması). KPI'lar tam kapsamlı SQL aggregate
 * (anlık görüntü). Dönem seçici (?donem=7|30|90) "yeni ofis / yeni destek" sayımlarını, aktivasyon
 * hunisi kohortunu ve deneme→ücretli penceresini etkiler; hepsi `created_at` / `trial_ends_at`
 * aralığıyla ayrı sorgulardır. Hepsi paralel, 60 sn `unstable_cache` (argüman = dönem).
 *
 * Ek okumalar (okunamayan `null` kalır; sıfır gibi GÖSTERİLMEZ): ödeme mutabakatı, riskli ofis
 * listesi + son 14 gün denetim hareketi, aktivasyon (örnek veri hariç gömülü sayım), ücretli aktif
 * abonelikler, iptal nedenleri, AI/değerleme/EF analiz bakiyesi harcama defteri (6 ay).
 * Hesaplar saf modüllerde: `dashboard-layout.ts`, `platform-metrics.ts` (testli).
 */
const LEDGER_UNITS = ["ai", "valuation", "ef"] as const;

const getAdminDashboardData = unstable_cache(
  async (period: number) => {
    const admin = createAdminClient();
    const fromIso = daysAgoIso(period);
    const prevIso = daysAgoIso(period * 2);
    const nowIso = daysAgoIso(0);
    const [
      aggregateResult,
      newTenants,
      prevTenants,
      refundRes,
      manualRes,
      churnTenants,
      rollupsRes,
      healthRes,
    ] = await Promise.all([
      admin.rpc("platform_reporting_aggregates", { p_from: null, p_to: null, p_as_of: nowIso }),
      admin.from("tenants").select("id", { count: "exact", head: true }).gte("created_at", fromIso),
      admin.from("tenants").select("id", { count: "exact", head: true }).gte("created_at", prevIso).lt("created_at", fromIso),
      admin.from("billing_payment_captures").select("id", { count: "exact", head: true }).eq("status", "refund_required"),
      admin.from("billing_payment_captures").select("id", { count: "exact", head: true }).eq("status", "manual_review"),
      // Aşağıdaki sayım/toplam kaynakları PostgREST 1000 satır sınırına takılmasın diye sayfalı okunur.
      fetchAllRows((from, to) =>
        admin.from("tenants").select("id, name, status, trial_ends_at").in("status", ["active", "trial", "past_due", "suspended"]).order("id", { ascending: true }).range(from, to),
      ),
      // Etkinlik (14 gün), aktivasyon hunisi, deneme dönüşümü, iptal nedenleri ve 6 aylık defter toplamları:
      // satır çekip JS'te saymak yerine tek SQL toplulaştırması (service_role RPC; hata → paneller "okunamadı").
      admin.rpc("platform_dashboard_rollups", {
        p_from: fromIso,
        p_now: nowIso,
        p_activity_from: daysAgoIso(14),
        p_ledger_from: trMonthStartIso(now(), -5),
        p_units: [...LEDGER_UNITS],
      }),
      // Ofis CRM (AD5): son günlük sağlık skoru. Tablo yoksa (migration bekliyor) hata → skor sinyali yok (uydurulmaz).
      fetchAllRows<{ tenant_id: string; health_score: number }>((from, to) =>
        admin.from("platform_tenant_crm").select("tenant_id, health_score").not("health_score", "is", null).order("tenant_id", { ascending: true }).range(from, to),
      ),
    ]);
    const rollups = rollupsRes.error ? null : parseDashboardRollups(rollupsRes.data);
    const activity: Record<string, number> = {};
    const lastActivity: Record<string, string> = {};
    for (const a of rollups?.activity ?? []) {
      activity[a.officeId] = a.events;
      lastActivity[a.officeId] = a.lastAt;
    }
    const healthScores: Record<string, number> = {};
    if (!healthRes.error) for (const h of healthRes.data) healthScores[h.tenant_id] = h.health_score;
    return {
      aggregate: requireReportingData("platform-dashboard-aggregates", aggregateResult) as unknown as PlatformReportingAggregate,
      newTenants: requireReportingCount("platform-new-tenants", newTenants),
      prevTenants: requireReportingCount("platform-prev-tenants", prevTenants),
      refundRequired: refundRes.error ? null : (refundRes.count ?? 0),
      manualReview: manualRes.error ? null : (manualRes.count ?? 0),
      churnTenants: churnTenants.error ? [] : (churnTenants.data ?? []),
      activity,
      lastActivity,
      healthScores,
      funnel: rollups?.funnel ?? null,
      trialConv: rollups?.trial ?? null,
      cancelReasons: rollups ? rollups.cancelReasons : null,
      ledger: rollups ? rollups.ledgerMonths : null,
    };
  },
  ["admin-dashboard-v7"],
  // B011: 10 sn (eskiden 60). Talep/fatura eylemleri `bustAdminCounters()` ile etiketi anında düşürür; açık ve acil
  // talep sayıları bu önbellekte DEĞİL (`liveTicketCounts`, önbelleksiz).
  { revalidate: 10, tags: [ADMIN_DASHBOARD_TAG] },
);

/**
 * Açık ve acil talep sayıları: önbellek DIŞINDA iki HEAD sayımı (paralel, istek içinde bir kez). Talep açılınca/çözülünce
 * Dikkat kuyruğu ve hero bir sonraki tazelemede (canlı olayla <1 sn) doğru sayıyı gösterir; rozetle aynı kaynak
 * (`liveOpenTickets`). Okunamazsa null (satır gizlenir; sıfır gibi gösterilmez).
 */
const liveTicketCounts = cache(async (): Promise<{ open: number | null; urgent: number | null }> => {
  const [open, urgentRes] = await Promise.all([
    liveOpenTickets(),
    createAdminClient()
      .from("support_tickets")
      .select("id", { count: "exact", head: true })
      .in("status", [...TICKET_OPEN_STATUSES])
      .eq("priority", "urgent"),
  ]);
  if (urgentRes.error) console.error("admin dashboard urgent tickets", urgentRes.error.code);
  return { open, urgent: urgentRes.error ? null : (urgentRes.count ?? 0) };
});

/** Aynı istek içinde tüm bölümler tek yükü paylaşır. */
const loadDashboard = cache(async (period: number) => {
  const [data, planDefs] = await Promise.all([getAdminDashboardData(period), getPlanDefinitions()]);
  return { ...data, planDefs };
});

/** Sistem sağlığı + EF mutabakat: dikkat kuyruğu ve sağlık kartı aynı okumayı paylaşır; okunamazsa null. */
const loadSystemSignals = cache(async (includeEf: boolean) => {
  const [health, ef] = await Promise.all([
    getAdminHealth().catch(() => null),
    includeEf ? readLatestEfReconciliation().catch(() => null) : Promise.resolve(null),
  ]);
  return { health, ef };
});


type Data = Awaited<ReturnType<typeof loadDashboard>>;

function derive(data: Data) {
  const { aggregate } = data;
  const summary = aggregate.summary;
  return {
    summary,
    active: Number(summary.active_count),
    trial: Number(summary.trial_count),
    totalTenants: Number(summary.tenant_count),
    risk: Number(summary.risk_count),
    soon: Number(summary.trials_ending_7d),
    members: Number(summary.member_count),
    mrr: exactMrr(aggregate.plan_stats, priceMapOf(data.planDefs)),
  };
}

/** Dikkat kuyruğu tek okuma (hero özeti + kart). Riskli ofis sayısı kuyrukta satırdır (churn listesi Raporlar'da). */
const loadAttention = cache(async (period: Period, role: PlatformAccessSubject) => {
  const data = await loadDashboard(period);
  const d = derive(data);
  const canBilling = platformCanAccess(role, "billing");
  const canTickets = platformCanAccess(role, "tickets");
  const [sys, expiredActive, tickets] = await Promise.all([
    loadSystemSignals(canBilling),
    canBilling ? countExpiredActive() : Promise.resolve(null),
    canTickets ? liveTicketCounts() : Promise.resolve({ open: null, urgent: null }),
  ]);
  const input: AttentionInput = {
    refundRequired: data.refundRequired,
    manualReview: data.manualReview,
    cronErrors: sys.health ? sys.health.cronErrors : null,
    efReconciliation: sys.ef ? sys.ef.status : null,
    urgentTickets: tickets.urgent,
    openTickets: tickets.open,
    risk: d.risk,
    trialsEnding: d.soon,
    newTrials: data.newTenants,
    readiness: sys.health?.readiness ?? null,
  };
  const queue = buildAttentionQueue(input, role);
  if (!expiredActive) return queue;
  // Dönemi bitmiş ama 'active' abonelik (status='active' AND current_period_end < şimdi): ödenmemiş dönem gelir
  // sayılıyor. Satır eylemleri Ofis 360 > Yönetim'de (Ödenmedi / Dönemi uzat; gerekçe + denetim izi).
  const row: AttentionRow = {
    id: "expired-active",
    label: `Dönemi bitmiş ama aktif: ${expiredActive}`,
    hint: "Ödenmiş dönemi geçmiş, durumu hâlâ aktif",
    count: expiredActive,
    href: "/admin/tenants?durum=donemi-bitmis",
    tone: "danger",
    severity: 75,
    module: "billing",
  };
  return [...queue, row].sort((a, b) => b.severity - a.severity || b.count - a.count).slice(0, ATTENTION_LIMIT);
});

/**
 * Dönemi bitmiş aktif abonelik sayısı (tek HEAD sayımı, önbelleksiz); okunamazsa null (satır gizlenir).
 * Aday tanımı isExpiredActive ile aynı: duraklatılmış ve dönem sonu iptali bekleyen sayılmaz.
 */
async function countExpiredActive(): Promise<number | null> {
  const { count, error } = await createAdminClient()
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .lt("current_period_end", new Date(now()).toISOString())
    .is("pause_started_at", null)
    .eq("cancel_at_period_end", false);
  return error ? null : (count ?? 0);
}

const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const monthLabel = (iso: string) => MONTHS_SHORT[trParts(iso).month] ?? "";
const weekLabel = (iso: string) => {
  const p = trParts(iso);
  return `${p.day} ${MONTHS_SHORT[p.month] ?? ""}`;
};

/** Hero özeti: KPI'ları TEKRARLAMAZ; en öncelikli işi adıyla ve bağlantısıyla söyler. */
export async function HeroSummary({ period, role }: { period: Period; role: PlatformAccessSubject }) {
  const queue = await loadAttention(period, role);
  const top = queue[0];
  if (!top) return <p>Platform sakin: bekleyen öncelikli iş yok.</p>;
  return (
    <p>
      En öncelikli iş:{" "}
      <Link href={top.href} className="focus-ring rounded-sm font-semibold text-accent-text underline-offset-2 hover:underline">
        {top.label.toLocaleLowerCase("tr-TR")}
      </Link>
      .
    </p>
  );
}

/** Kontrol panelinin 4 özet göstergesi (ofis, aktif abone, deneme, dönemde yeni ofis); ayrıntı Raporlar'da. */
export async function KpiStrip({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const d = derive(data);
  const conv = data.trialConv;
  const convText =
    conv === null ? "Dönüşüm okunamadı" : conv.rate === null ? "Biten deneme yok" : `Deneme dönüşümü %${conv.rate}`;
  return (
    <KpiGrid label="Platform özet göstergeleri">
      <KpiCard
        layout="inline"
        label="Toplam ofis"
        value={d.totalTenants}
        href="/admin/tenants"
        icon={Building2}
        tone="brand"
        trend={computeTrend(d.totalTenants, Math.max(0, d.totalTenants - data.newTenants))}
        hint={data.newTenants > 0 ? `Son ${period} günde +${data.newTenants}` : "Dönemde yeni ofis yok"}
      />
      <KpiCard layout="inline" label="Aktif abone" value={d.active} href="/admin/tenants?durum=active" icon={Crown} tone="gold" hint={convText} />
      <KpiCard layout="inline" label="Deneme" value={d.trial} href="/admin/tenants?durum=trial" icon={FlaskConical} tone="neutral" hint="Süreçte olan ofis" />
      <KpiCard
        layout="inline"
        tinted
        label={`Yeni ofis · ${period} gün`}
        value={data.newTenants}
        href={`/admin/tenants?yeni=${period}`}
        icon={Plus}
        tone="success"
        trend={computeTrend(data.newTenants, data.prevTenants)}
        hint={data.prevTenants > 0 ? `Geçen dönem ${data.prevTenants}` : "Geçen dönem —"}
      />
    </KpiGrid>
  );
}

/** DİKKAT GEREKTİRENLER: rol filtreli, önem sırasına göre iş kuyruğu + platform içgörüleri. */
export async function AttentionSection({ period, role }: { period: Period; role: PlatformAccessSubject }) {
  const [queue, insights] = await Promise.all([loadAttention(period, role), getPlatformInsights({ limit: 3 })]);
  return (
    <AttentionList
      items={queue.map((q) => ({ id: q.id, label: q.label, hint: q.hint, href: q.href, count: q.count, level: attentionLevel(q.severity) }))}
      emptyTitle={insights.length === 0 ? "Şu an bekleyen iş yok" : "Kuyruk temiz"}
    >
      {/* ATTENTION_INSIGHT_SLOT: gerçek platform içgörüleri (platform_insights, RLS'li okuyucu). Satır yoksa hiçbir şey çizilmez; içgörü UYDURULMAZ. */}
      <PlatformInsightList insights={insights} />
    </AttentionList>
  );
}

/** MRR odak metriği + 12 ay eğrisi + ETİKETLİ 3 ay doğrusal tahmin (en az 3 gerçek ay varsa). */
export async function MrrSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const d = derive(data);
  const prices = priceMapOf(data.planDefs);
  const series = data.aggregate.mrr_trend.map((r) => ({ label: monthLabel(r.month_start), value: exactTrendMrr(r, prices) }));
  const last = series.length >= 2 ? series[series.length - 1]!.value : null;
  const prev = series.length >= 2 ? series[series.length - 2]!.value : null;
  const trend = last !== null && prev !== null ? computeTrend(last, prev) : null;
  const hasCurve = series.length >= 2 && series.some((s) => s.value > 0);
  const forecast = linearForecast(series.map((s) => s.value), 2);
  const points = [
    ...series.map((s, i) => ({ label: s.label, value: s.value, forecast: forecast && i === series.length - 1 ? s.value : null })),
    ...(forecast ? nextMonthLabels(now(), forecast.values.length).map((label, i) => ({ label, value: null, forecast: forecast.values[i]! })) : []),
  ];
  const arpa = d.active > 0 ? Math.round(d.mrr / d.active) : null;
  const trendTone = trend ? (trend.dir === "new" ? "gold" : trend.good === null ? "neutral" : trend.good ? "success" : "danger") : "neutral";
  return (
    <ChartCard
      as="h2"
      title="Aylık yinelenen gelir"
      subtitle="Düzenli gelir performansı ve trendi"
      icon={Wallet}
      tone="gold"
      href="/admin/billing"
      hrefLabel="Gelir ayrıntısı"
      height={0}
      className="flex h-full flex-col"
      bodyClassName="flex flex-1 flex-col"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/admin/billing" className="focus-ring flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-control)]">
            <span className="ds-num ds-money">{formatTry(d.mrr)}</span>
            {trend ? (
              <span className={`ds-pill pm-t-${trendTone}`}>
                <span aria-hidden="true">{trend.label}</span>
                <span className="sr-only">{trend.sr}</span>
              </span>
            ) : null}
          </Link>
          <p className="mt-1.5 text-sm tabular-nums text-text-muted">
            Yıllık {formatTry(exactArr(d.mrr))}
            {prev !== null ? ` · önceki ay sonu ${formatTry(prev)}` : ""}
          </p>
        </div>
        {arpa !== null ? (
          <Link href="/admin/tenants?durum=active" className="ds-tile ds-lift focus-ring pm-t-gold min-w-40">
            <span className="text-xs text-text-muted">Ofis başı gelir (ARPA)</span>
            <span className="ds-num text-lg">{formatTry(arpa)}</span>
          </Link>
        ) : null}
      </div>
      <div className="relative mt-4 min-h-60 flex-1">
        {hasCurve ? (
          <div className="absolute inset-0">
          <AreaTrendChart
            data={points}
            tone="gold"
            format="money"
            name="MRR"
            forecastName="Tahmin"
            ariaLabel={`Son ${series.length} ay aylık yinelenen gelir${forecast ? " ve 2 aylık doğrusal tahmin" : ""}`}
          />
          </div>
        ) : (
          <EmptyState variant="compact" illustration="rapor" title="Gelir eğrisi için veri birikiyor" description="En az iki aylık abonelik kaydı oluşunca eğri burada çizilir." action={{ href: "/admin/billing", label: "Faturalamayı aç" }} />
        )}
      </div>
      {forecast ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <span className="ds-pill pm-t-gold">Tahmin</span>
          Kesikli çizgi son {forecast.basis} ayın doğrusal eğilimidir; kesin değildir.
        </p>
      ) : null}
    </ChartCard>
  );
}

const SIGNAL_TONE: Record<ChurnSignal["key"], string> = { past_due: "danger", suspended: "danger", inactive: "warn", quiet: "gold", low_health: "danger" };
const LEVEL_PILL: Record<ChurnLevel, { label: string; tone: string }> = {
  yuksek: { label: "Yüksek", tone: "danger" },
  orta: { label: "Orta", tone: "warn" },
  dusuk: { label: "Düşük", tone: "neutral" },
};

/** Riskli ofisler + churn sinyalleri: TEK liste (eski "Riskli ofis" satırı ve churn tablosu birleşti). */
export async function ChurnSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const d = derive(data);
  const riskThreshold = await getSetting<number>(CRM_SETTING_KEYS.riskThreshold).catch(() => HEALTH_DEFAULT_RISK_THRESHOLD);
  const rows = buildChurnRows(data.churnTenants, new Map(Object.entries(data.activity)), now(), 8, new Map(Object.entries(data.lastActivity)), {
    scores: new Map(Object.entries(data.healthScores)),
    threshold: riskThreshold,
  });
  return (
    <ChartCard
      as="h2"
      title="Riskli ofisler ve kayıp riski"
      subtitle="Gecikmiş, askıda, az kullanan ya da sağlığı düşük ofisler"
      icon={ShieldAlert}
      tone="danger"
      href="/admin/tenants?durum=risk"
      hrefLabel={d.risk > 0 ? `Gecikmiş + askıda: ${d.risk}` : "Tüm riskli ofisler"}
      height={0}
      className="h-full"
    >
      {rows.length === 0 ? (
        <EmptyState variant="compact" illustration="basari" title="Risk sinyali olan ofis yok" description="Ödeme gecikmesi, askıya alma, 14 gündür düşük kullanım ya da eşiğin altında sağlık skoru olursa burada listelenir." action={{ href: "/admin/tenants", label: "Ofisleri gör" }} />
      ) : (
        <div className="-mx-1.5 overflow-x-auto">
          <Table className="pm-tbl min-w-[34rem]">
            <caption className="sr-only">Riskli ofisler, sinyalleri, son hareket ve risk düzeyi</caption>
            <THead>
              <TR>
                <TH scope="col" className="pm-l">Ofis</TH>
                <TH scope="col" className="pm-l">Sinyaller</TH>
                <TH scope="col">Son hareket</TH>
                <TH scope="col">Risk</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TH scope="row">
                    <Link href={r.href} className="focus-ring inline-flex items-center gap-2 rounded-[var(--radius-control)]">
                      <Building2 className="h-4 w-4 shrink-0 text-text-faint" aria-hidden />
                      <span className="truncate">{r.name}</span>
                    </Link>
                  </TH>
                  <TD className="pm-l pm-wrap">
                    <span className="flex flex-wrap gap-1.5">
                      {r.signals.map((s) =>
                        s.key === "low_health" ? (
                          <Link key={s.key} href="/admin/tenants?skor=riskli" className={`ds-pill pm-t-${SIGNAL_TONE[s.key]} focus-ring`} title="Sağlık skoru riskli eşiğin altındaki tüm ofisler">
                            {s.label}
                          </Link>
                        ) : (
                          <span key={s.key} className={`ds-pill pm-t-${SIGNAL_TONE[s.key]}`}>
                            {s.label}
                          </span>
                        ),
                      )}
                    </span>
                  </TD>
                  <TD className="text-text-muted">{r.lastActivityAt ? relativeTimeTR(r.lastActivityAt) : "14+ gün"}</TD>
                  <TD>
                    <span className={`ds-pill pm-t-${LEVEL_PILL[r.level].tone}`}>{LEVEL_PILL[r.level].label}</span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </ChartCard>
  );
}

/** Aktivasyon hunisi (kayıt → ilk portföy → ilk anlaşma) + GERÇEK deneme → ücretli dönüşüm. */
export async function ActivationSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const funnel = data.funnel;
  const conv = data.trialConv;
  const cohort = `/admin/tenants?yeni=${period}`;
  return (
    <ChartCard
      as="h2"
      title="Aktivasyon ve dönüşüm"
      subtitle={`Son ${period} günde kayıt olan ofisler · örnek veri hariç`}
      icon={Rocket}
      tone="success"
      href={cohort}
      hrefLabel="Kohort"
      height={0}
      className="h-full"
    >
      {funnel === null ? (
        <EmptyState variant="compact" illustration="hata" title="Aktivasyon verisi okunamadı" description="Gömülü sayım sorgusu yanıt vermedi; ofis listesinden kohortu inceleyebilirsiniz." action={{ href: "/admin/tenants", label: "Ofisleri gör" }} />
      ) : (
        funnel.registered === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">{`Son ${period} günde yeni kayıt yok`}</p>
        ) : (
          <>
            <div className="h-36" role="group" aria-label={`Son ${period} gün aktivasyon hunisi`}>
              <BarCompare
                layout="horizontal"
                hrefKey="href"
                hint="Kohortu aç"
                data={[
                  { aşama: "Kayıt", ofis: funnel.registered, href: cohort },
                  { aşama: "İlk portföy", ofis: funnel.withProperty, href: cohort },
                  { aşama: "İlk anlaşma", ofis: funnel.withDeal, href: cohort },
                ]}
                xKey="aşama"
                series={[{ key: "ofis", label: "Ofis", color: "var(--viz-1)" }]}
              />
            </div>
            <p className="mt-2 text-xs tabular-nums text-text-muted">
              Kayıttan ilk portföye %{Math.round((funnel.withProperty / funnel.registered) * 100)}
              {funnel.withProperty > 0 ? ` · portföyden ilk anlaşmaya %${Math.round((funnel.withDeal / funnel.withProperty) * 100)}` : ""} · örnek veri hariç
            </p>
          </>
        )
      )}
      <div className="mt-4 border-t border-hairline pt-3">
        {conv === null ? (
          <p className="text-sm text-text-muted">Deneme → ücretli dönüşüm okunamadı.</p>
        ) : conv.rate === null ? (
          <p className="text-sm text-text-muted">Son {period} günde denemesi biten ofis yok; dönüşüm oranı oluşmadı.</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="ds-eyebrow">Deneme → ücretli · son {period} gün</p>
              <p className="mt-1 text-sm text-text-muted">
                <Link href={`/admin/tenants?deneme=bitti&gun=${period}&durum=active`} className="focus-ring font-semibold text-accent-text hover:underline">
                  {conv.converted} ofis
                </Link>{" "}
                ücretli aboneliğe geçti /{" "}
                <Link href={`/admin/tenants?deneme=bitti&gun=${period}`} className="focus-ring font-semibold text-accent-text hover:underline">
                  {conv.ended} biten deneme
                </Link>
              </p>
            </div>
            <Link href={`/admin/tenants?deneme=bitti&gun=${period}`} className="ds-num focus-ring rounded-[var(--radius-control)] text-3xl">
              %{conv.rate}
            </Link>
          </div>
        )}
      </div>
    </ChartCard>
  );
}

/** Birim ekonomisi: ARPA trendi (gerçek). NRR dürüstçe "hesaplanamıyor" (dönemsel gelir anlık görüntüsü yok). */
export async function UnitEconomicsSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const prices = priceMapOf(data.planDefs);
  const points = arpaSeries(
    data.aggregate.mrr_trend.map((r) => ({
      label: monthLabel(r.month_start),
      mrr: exactTrendMrr(r, prices),
      offices: Number(r.advisor_count) + Number(r.office_count) + Number(r.professional_count) + Number(r.enterprise_count),
    })),
  );
  const real = points.filter((p) => p.arpa !== null);
  return (
    <ChartCard as="h2" title="Birim ekonomisi" subtitle="Ofis başına aylık gelir · 12 ay" icon={TrendingUp} tone="brand" href="/admin/raporlar" hrefLabel="Raporlar" height={0} className="h-full">
      <div className="h-48">
        {real.length >= 2 ? (
          <AreaTrendChart data={points.map((p) => ({ label: p.label, value: p.arpa }))} tone="brand" format="money" name="ARPA" ariaLabel="Son 12 ay aktif ofis başına aylık gelir" />
        ) : (
          <EmptyState variant="compact" illustration="rapor" title="ARPA eğrisi için veri birikiyor" description="En az iki ay aktif ofis ve gelir oluşunca çizilir." action={{ href: "/admin/billing", label: "Faturalamayı aç" }} />
        )}
      </div>
      <p className="mt-3 rounded-[var(--radius-control)] bg-[var(--surface-sunken)] px-3 py-2 text-xs leading-5 text-text-muted">
        <span className="font-semibold text-text">Net gelir tutma (NRR): hesaplanamıyor.</span> Doğru NRR için her ayın başı/sonu ofis bazlı gelir anlık
        görüntüsü gerekir; bugün yalnız güncel abonelik durumu tutuluyor. Tahmini sayı gösterilmez.
      </p>
    </ChartCard>
  );
}

/** AI kredisi, değerleme raporu ve EmlakFiyati analiz bakiyesi tüketimi (son 6 TR ayı, harcama defteri). */
export async function UsageSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const usage = data.ledger ? monthlyUsageFromSums(data.ledger, LEDGER_UNITS, now()) : null;
  const rows = usage ? usage.months.map((m, i) => ({ ay: m.label, ai: usage.byUnit.ai![i]!, valuation: usage.byUnit.valuation![i]!, ef: usage.byUnit.ef![i]! })) : [];
  return (
    <ChartCard as="h2" title="AI ve analiz bakiyesi tüketimi" subtitle="Son 6 ay · harcanan birim" icon={BrainCircuit} tone="gold" href="/admin/ai-kullanim" hrefLabel="AI kullanımı" height={0} className="h-full">
      {usage === null ? (
        <EmptyState variant="compact" illustration="rapor" title="Tüketim defteri okunamadı" description="Kredi defteri bu ortamda etkin değil veya sorgu yanıt vermedi." action={{ href: "/admin/ai-kullanim", label: "AI kullanımını aç" }} />
      ) : usage.total === 0 ? (
        <EmptyState variant="compact" illustration="rapor" title="Son 6 ayda tüketim yok" description="Ofisler AI asistanı, değerleme raporu veya EmlakFiyati analiz bakiyesi kullandıkça burada görünür." action={{ href: "/admin/ai-kullanim", label: "AI kullanımını aç" }} />
      ) : (
        <div className="h-52">
          <BarCompare
            data={rows}
            xKey="ay"
            series={[
              { key: "ai", label: "AI kredisi", color: "var(--viz-1)" },
              { key: "valuation", label: "Değerleme raporu", color: "var(--viz-2)" },
              { key: "ef", label: "EF analiz bakiyesi", color: "var(--viz-5)" },
            ]}
          />
        </div>
      )}
    </ChartCard>
  );
}

/** Abonelik iptal taleplerindeki gerekçeler (serbest metin, normalize edilip gruplanır). */
export async function ChurnReasonsSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const reasons = data.cancelReasons ? data.cancelReasons.slice(0, 5) : null;
  const max = reasons && reasons.length ? Math.max(...reasons.map((r) => r.count)) : 1;
  return (
    <ChartCard
      as="h2"
      title="İptal nedenleri"
      subtitle="Abonelik iptal taleplerindeki gerekçeler"
      icon={MessageSquareWarning}
      tone="warn"
      href="/admin/tenants?durum=cancelled"
      hrefLabel="İptal edilenler"
      height={0}
      className="h-full"
    >
      {reasons === null ? (
        <EmptyState variant="compact" illustration="hata" title="İptal nedeni kaydı okunamadı" description="İptal talebi alanları bu ortamda etkin değil veya sorgu yanıt vermedi." action={{ href: "/admin/tenants?durum=cancelled", label: "İptal eden ofisler" }} />
      ) : reasons.length === 0 ? (
        <EmptyState variant="compact" illustration="basari" title="Henüz iptal talebi yok" description="Bir ofis aboneliğini iptal ederken neden yazarsa burada gruplanır." action={{ href: "/admin/tenants", label: "Ofisleri gör" }} />
      ) : (
        <ul className="space-y-2.5">
          {reasons.map((r) => (
            <li key={r.reason}>
              <Link href="/admin/tenants?durum=cancelled" className="focus-ring group block rounded-[var(--radius-control)]">
                <span className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-text group-hover:text-accent-text" title={r.reason}>
                    {r.reason}
                  </span>
                  <span className="ds-num shrink-0 text-sm">{r.count}</span>
                </span>
                <span className="ds-bar pm-t-warn mt-1.5">
                  <span className="motion-progress-fill" style={{ width: `${Math.max((r.count / max) * 100, 4)}%` }} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

/** Büyüme (ikincil): haftalık yeni ofis ve yeni aktif abonelik, sunucu SVG AreaTrend (lejant, nokta başına değer, toplam). */
export async function GrowthSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const weekly = data.aggregate.weekly;
  const offices = weekly.map((w) => Number(w.tenants));
  const subs = weekly.map((w) => Number(w.active_subscriptions));
  const hasData = weekly.length >= 2 && (offices.some((v) => v > 0) || subs.some((v) => v > 0));
  return (
    <ChartCard
      as="h2"
      title="Büyüme"
      subtitle="Yeni ofis ve abonelik · son 8 hafta"
      icon={Gauge}
      tone="success"
      href="/admin/tenants?yeni=90"
      hrefLabel="Son 90 gün kayıtlar"
      height={260}
      empty={!hasData}
      emptyText="Yeni ofis ve abonelikler geldikçe eğri burada çizilir."
      className="h-full"
    >
      <AreaTrend
        data={weekly.map((w, i) => ({ hafta: weekLabel(w.week_start), ofis: offices[i] ?? 0, abonelik: subs[i] ?? 0 }))}
        xKey="hafta"
        series={[
          { key: "ofis", label: "Yeni ofis", color: "var(--viz-1)" },
          { key: "abonelik", label: "Yeni aktif abonelik", color: "var(--viz-2)" },
        ]}
        granularity="week"
        summary="total"
      />
    </ChartCard>
  );
}

/** Gelir kompozisyonu: plan bazında MRR payı, tek yığılmış çubuk. */
export async function CompositionSection({ period }: { period: Period }) {
  const data = await loadDashboard(period);
  const { aggregate } = data;
  // Gizli planlar (örn. Business) dahil: bu planda ofisi olan hiçbir satır sessizce düşmez.
  const shownPlans = data.planDefs.filter((p) => !p.hidden || Number(aggregate.plan_stats.find((r) => r.plan === p.id)?.tenant_count ?? 0) > 0);
  // Plan bazında MRR: yalnız gerçek abonelik MRR'ı (plan_stats.subscription_mrr). Aboneliği eksik aktif ofis 0 ekler;
  // katalog fiyatı yedeği YOK (exactMrr ile aynı kural; eksik abonelik billing-home'da ayrı uyarıdır).
  const rows = shownPlans.map((plan) => {
    const row = aggregate.plan_stats.find((r) => r.plan === plan.id);
    const mrr = Number(row?.subscription_mrr);
    return {
      label: plan.name,
      value: Number.isFinite(mrr) ? Math.round(mrr) : 0,
      hint: `${row ? Number(row.tenant_count) : 0} ofis`,
      href: `/admin/tenants?plan=${plan.id}`,
    };
  });
  const total = rows.reduce((n, r) => n + r.value, 0);
  return (
    <ChartCard as="h2" title="Gelir kompozisyonu" subtitle="Plan bazında aylık yinelenen gelir" icon={PieChart} tone="gold" href="/admin/billing" hrefLabel="Faturalama" height={0} className="h-full">
      {total > 0 ? (
        <StackedBar rows={rows} format={formatTry} ariaLabel="Plan bazında aylık yinelenen gelir payı" />
      ) : (
        <EmptyState variant="compact" illustration="komisyon" title="Henüz gelir getiren plan yok" description="Aktif abonelikler oluştukça plan bazında dağılım burada görünür." action={{ href: "/admin/billing/planlar", label: "Planları aç" }} />
      )}
    </ChartCard>
  );
}
