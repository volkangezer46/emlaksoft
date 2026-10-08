import { batchAll } from "@/lib/supabase/query-batch";
import {
  ArrowUpRight,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ReceiptText,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Link from "@/components/ui/smart-link";
import { createClient } from "@/lib/supabase/server";
import { now as nowMs } from "@/lib/clock";
import { requireModulePage } from "@/lib/require-module-page";
import { getSettings } from "@/lib/settings/read";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { summarizeAdvisorEarning, type ShareRow } from "@/lib/team/advisor-share";
import { trMonthContext } from "@/lib/team/scorecard";
import { ChartFrame } from "@/app/app/_ui/lazy-chart";
import { InteractiveChart } from "@/components/app/interactive-chart";
import { listSavedViews } from "@/app/actions/saved-views";
import { SavedViews } from "@/components/app/saved-views";
import { CommissionSimulator } from "./commission-simulator";
import { CommissionActions } from "./commission-actions";
import { CommissionSplitEditor } from "./commission-split-editor";
import { BulkCollectBar, BulkCollectCheckbox, BulkCollectProvider } from "./bulk-collect";
import { requireReportingCount, requireReportingData } from "@/lib/reporting/result";

import { ListHero, ListPage } from "@/components/ui/list-page";
import { HelpTip } from "@/components/ui/help-tip";
import { MoneyValue } from "@/components/ui/money-value";
import { DashCard, SectionHeader, KpiGrid } from "@/components/ui/dashboard-grid";
import { KpiTile } from "@/components/ui/premium/kpi-card";
import { Progress } from "@/components/ui/progress";
import { Illustration } from "@/components/ui/illustrations";
import { shareOfMax } from "@/app/app/raporlar/report-math";
import { statusShares } from "./commission-math";
import { StatusStackBar } from "./status-stack-bar";
import { PipelineForecastCard } from "./pipeline-forecast";
import { DiscountAnalysisCard } from "./discount-analysis";
import { Suspense } from "react";
import { SkeletonCard } from "@/components/ui/viz";

export const metadata = { title: "Komisyon" };
type CommissionRow = {
  id: string;
  gross_amount: number;
  vat_amount: number;
  status: string;
  splits: { label?: string; amount?: number; rate?: number }[] | null;
  created_at: string;
  deal_id: string | null;
  deal: {
    id: string;
    deal_value: number | null;
    stage: string;
    property: { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null;
  } | {
    id: string;
    deal_value: number | null;
    stage: string;
    property: { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null;
  }[] | null;
};

type CommissionAggregate = {
  total: number;
  paid: number;
  pending: number;
  record_count: number;
  month_total: number;
  month_paid: number;
  month_pending: number;
  month_record_count: number;
  monthly: { month_start: string; accrued: number; paid: number }[];
  advisors: { label: string; pay: number; record_count: number }[];
};

function money(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(value);
}

function dealOf(value: CommissionRow["deal"]) {
  return Array.isArray(value) ? value[0] : value;
}

/** ?durum= değerleri: bekleyen = tahsil edilmemiş, tahsil = paid/collected. */
const DURUM_FILTERS = ["bekleyen", "tahsil"] as const;
type DurumFilter = (typeof DURUM_FILTERS)[number];

const PAGE_SIZE = 50;
/** Kendi payım toplamı için okunan en fazla satır (aşılırsa uyarı gösterilir). */
const OWN_ROWS_LIMIT = 2000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// UTC getter'lar kullanılır: bu yardımcı yalnız aşağıdaki istanbulMonthUtc/istanbulTodayUtc
// ile Date.UTC(...) üzerinden kurulan tarihleri biçimlendirir — sunucunun yerel saat
// dilimine (Vercel'de tipik olarak UTC) bağımlı olmadan tutarlı kalır.
function fmtDate(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Verilen anın İstanbul yerel takvim bileşenleri (yıl, ay [0-indeksli], gün). */
function istanbulDateParts(ms: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month") - 1, day: get("day") };
}

/** İstanbul takvimine göre ayın 1'i (UTC-getter'larla okunacak şekilde Date.UTC ile kurulur). */
function istanbulMonthUtc(year: number, month: number, day = 1) {
  return new Date(Date.UTC(year, month, day));
}

/** `to` günü dahil olsun diye timestamptz karşılaştırmasında ertesi gün (hariç) kullanılır. */
function nextDay(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Boş olmayan paramlardan query string üretir — mevcut filtreler korunur. */
function qs(params: Record<string, string | null | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default async function CommissionPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; from?: string; to?: string; sayfa?: string }>;
}) {
  const { perms, userId, tenantId, role } = await requireModulePage("commissions");
  // Ofis Tanımları Merkezi: simülatör başlangıç oranı/payı (ayar yoksa kod varsayılanları 3 / 60).
  // Kayıtlı görünümlerle aynı turda beklenir (aşağıda).
  const simDefaultsPromise = tenantId
    ? getSettings(["office.commission.simulator_rate", "office.commission.simulator_advisor_share"], { tenantId })
    : Promise.resolve({} as Record<string, unknown>);
  const canEdit = (perms.commissions ?? []).includes("edit");
  // Kazanç gizliliği: danışman bazlı pay dağılımı ve split etiketleri başkasının kazancını gösterir.
  const seeAllEarnings = canSeeAllEarnings(perms);
  const params = (await searchParams) ?? {};
  const durum: DurumFilter | null = DURUM_FILTERS.includes(params.durum as DurumFilter)
    ? (params.durum as DurumFilter)
    : null;
  const from = ISO_DATE.test(params.from ?? "") ? params.from! : null;
  const to = ISO_DATE.test(params.to ?? "") ? params.to! : null;
  const sayfa = Math.max(1, Number.parseInt(params.sayfa ?? "1", 10) || 1);

  // Hızlı tarih çipleri — İstanbul takvimine göre hesaplanır (sunucu UTC olabilir,
  // ayın ilk saatlerinde "bu ay" yanlış aya kaymasın diye bkz. istanbulDateParts).
  const now = new Date(nowMs());
  const istNow = istanbulDateParts(nowMs());
  const istToday = istanbulMonthUtc(istNow.year, istNow.month, istNow.day);
  const presets = [
    { label: "Bu ay", from: fmtDate(istanbulMonthUtc(istNow.year, istNow.month)), to: fmtDate(istToday) },
    { label: "Geçen ay", from: fmtDate(istanbulMonthUtc(istNow.year, istNow.month - 1)), to: fmtDate(istanbulMonthUtc(istNow.year, istNow.month, 0)) },
    { label: "Son 3 ay", from: fmtDate(istanbulMonthUtc(istNow.year, istNow.month - 2)), to: fmtDate(istToday) },
  ];

  const supabase = await createClient();
  // Ayar + kayıtlı görünümler defter sorgularıyla AYNI turda beklenir (eskiden ardışık tur).
  const defaultsP = Promise.all([simDefaultsPromise, listSavedViews("/app/komisyon")]);
  // Onay merkezi rozeti — tek head-count sorgusu (bkz. /app/onaylar).
  // Kayıtlı görünümler için aktif filtre paramları (sayfa hariç)
  const savedViewParams: Record<string, string> = {};
  if (durum) savedViewParams.durum = durum;
  if (from) savedViewParams.from = from;
  if (to) savedViewParams.to = to;
  // B1: earnings_all yoksa defter yalnız kendi anlaşmalarının komisyonlarıdır (inner join + atanan filtresi).
  const dealJoin = seeAllEarnings ? "deals!commissions_deal_id_fkey" : "deals!commissions_deal_id_fkey!inner";
  let ledgerQuery = supabase
    .from("commissions")
    .select(
      `id, gross_amount, vat_amount, status, splits, created_at, deal_id, deal:${dealJoin}(id,deal_value,stage,property:properties!deals_property_id_fkey(id,property_code,title))`,
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range((sayfa - 1) * PAGE_SIZE, sayfa * PAGE_SIZE - 1);
  if (!seeAllEarnings) ledgerQuery = ledgerQuery.eq("deal.assigned_to", userId);
  if (durum === "tahsil") ledgerQuery = ledgerQuery.in("status", ["paid", "collected"]);
  else if (durum === "bekleyen") ledgerQuery = ledgerQuery.not("status", "in", "(paid,collected)");
  // Gün sınırları Türkiye saatiyle (sunucu UTC: ham tarih dizgesi 3 saat kayar).
  if (from) ledgerQuery = ledgerQuery.gte("created_at", `${from}T00:00:00+03:00`);
  if (to) ledgerQuery = ledgerQuery.lt("created_at", `${nextDay(to)}T00:00:00+03:00`);

  // Kazanç gizliliği: ofis geneli toplam (RPC) yalnız earnings_all ile okunur; diğer roller kendi paylarını görür.
  const ownRowsQuery = seeAllEarnings
    ? null
    : supabase
        .from("commissions")
        .select("gross_amount, status, splits, created_at, deal:deals!commissions_deal_id_fkey!inner(assigned_to)")
        .eq("deal.assigned_to", userId)
        .order("created_at", { ascending: false })
        .limit(OWN_ROWS_LIMIT);
  const [[simDefaults, savedViews], [ledgerResult, aggregateResult, memberResult, approvalResult, ownRowsResult]] = await Promise.all([defaultsP, batchAll("Komisyon", [], [
    ledgerQuery,
    // Sayfalama dışı KPI, dağılım ve aylık seri tam kapsamlı SQL aggregate'tir.
    seeAllEarnings ? supabase.rpc("tenant_commission_aggregates", { p_as_of: now.toISOString() }) : Promise.resolve(null),
    // Split etiketini danışman profiline bağlamak için ad → id eşlemesi.
    supabase.from("profiles").select("id, full_name").eq("is_active", true),
    supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("status", "bekliyor"),
    ownRowsQuery ?? Promise.resolve(null),
  ])]);
  const simRate = Number(simDefaults["office.commission.simulator_rate"] ?? 3);
  const simShare = Number(simDefaults["office.commission.simulator_advisor_share"] ?? 60);

  const rows = requireReportingData("commission-ledger", ledgerResult) as CommissionRow[];
  const commissionTotal = requireReportingCount("commission-ledger-count", ledgerResult);
  const memberRows = requireReportingData("commission-members", memberResult);
  const bekleyenOnay = requireReportingCount("pending-approvals", approvalResult);

  // Üst KPI kaynağı: earnings_all varsa ofis toplamı (RPC); yoksa yalnız kendi payım (advisor-share.ts).
  let aggregate: CommissionAggregate;
  let ownTruncated = false;
  if (seeAllEarnings && aggregateResult) {
    aggregate = requireReportingData("tenant-commission-aggregates", aggregateResult) as unknown as CommissionAggregate;
  } else {
    const ownRows = (requireReportingData("commission-own-rows", ownRowsResult!) ?? []) as unknown as (ShareRow & { created_at: string })[];
    ownTruncated = ownRows.length >= OWN_ROWS_LIMIT;
    const myName = (memberRows ?? []).find((m) => m.id === userId)?.full_name ?? null;
    const monthStartMs = Date.parse(trMonthContext(nowMs()).monthStartIso);
    const all = summarizeAdvisorEarning(ownRows, myName, userId);
    const month = summarizeAdvisorEarning(
      ownRows.filter((r) => Date.parse(r.created_at) >= monthStartMs),
      myName,
      userId,
    );
    aggregate = {
      total: all.collected + all.pending,
      paid: all.collected,
      pending: all.pending,
      record_count: all.count,
      month_total: month.collected + month.pending,
      month_paid: month.collected,
      month_pending: month.pending,
      month_record_count: month.count,
      monthly: [],
      advisors: [],
    };
  }
  const total = Number(aggregate.total);
  const paid = Number(aggregate.paid);
  const pending = Number(aggregate.pending);
  const kpiScopeLabel = seeAllEarnings ? "Ofis geneli" : "Yalnız sizin payınız";
  const kpiEmpty = !seeAllEarnings && aggregate.record_count === 0;

  // Dönem (bu ay) KPI şeridi — filtrelerden bağımsız, ayın 1'inden bugüne (İstanbul takvimi)
  const donemLabel = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(now);
  const donemToplam = Number(aggregate.month_total);
  const donemTahsil = Number(aggregate.month_paid);
  const donemBekleyen = Number(aggregate.month_pending);

  // Danışman bazlı dağılım — split etiketlerine göre pay (brüt × oran)
  const advisorDist = (seeAllEarnings ? aggregate.advisors : []).map((row) => ({
    label: row.label,
    pay: Number(row.pay),
    adet: Number(row.record_count),
  }));
  const advisorMax = Math.max(1, ...advisorDist.map((a) => a.pay));

  // Beklenen vs tahsil edilen — son 6 ay, çift seri (tahakkuk / tahsilat), İstanbul takvimi
  const kpiAyFmt = new Intl.DateTimeFormat("tr-TR", { month: "short", timeZone: "Europe/Istanbul" });
  const aylikSeri = Array.from({ length: 6 }, (_, i) => {
    const d = istanbulMonthUtc(istNow.year, istNow.month - (5 - i));
    return {
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      label: kpiAyFmt.format(d),
      value: 0,
      value2: 0,
    };
  });
  const seriIndex = new Map(aylikSeri.map((m, i) => [m.key, i]));
  for (const r of aggregate.monthly) {
    // month_start artık İstanbul ay başlangıcının doğru UTC anı — UTC dizgesinin
    // ilk 7 karakteri (ör. +03:00 farkı yüzünden) yanlış aya kayabilir, bu yüzden
    // İstanbul takvim bileşenleriyle yeniden hesaplanır (aylikSeri anahtarıyla aynı yöntem).
    const rParts = istanbulDateParts(new Date(r.month_start).getTime());
    const idx = seriIndex.get(`${rParts.year}-${String(rParts.month + 1).padStart(2, "0")}`);
    if (idx === undefined) continue;
    aylikSeri[idx].value = Number(r.accrued);
    aylikSeri[idx].value2 = Number(r.paid);
  }
  const hasAylikSeri = aylikSeri.some((m) => m.value > 0);
  // Durum yığını (para = altın, durum tonları) ve bağlamlı KPI ipuçları — saf hesap: commission-math.ts
  const allShares = statusShares(paid, pending);
  const donemShares = statusShares(donemTahsil, donemBekleyen);
  const prevMonthAccrued = aylikSeri[4]?.value ?? 0;

  const totalCount = commissionTotal;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  // Sayfa dışındaki paramları koruyarak link üretir; sayfa değişince filtreler kalır
  const pageHref = (p: number) => `/app/komisyon${qs({ durum: durum ?? undefined, from, to, sayfa: p > 1 ? String(p) : undefined })}`;
  // Filtre değişince sayfa 1'e döner (sayfa paramı atılır)
  const filterHref = (next: { durum?: DurumFilter | null; from?: string | null; to?: string | null }) =>
    `/app/komisyon${qs({
      durum: (next.durum === undefined ? durum : next.durum) ?? undefined,
      from: next.from === undefined ? from : next.from,
      to: next.to === undefined ? to : next.to,
    })}`;

  // Toplu tahsil için bu sayfadaki bekleyen kayıtlar
  const pendingIds = rows
    .filter((r) => r.status !== "paid" && r.status !== "collected")
    .map((r) => r.id);

  /*
   * Split satırları serbest metin etiket taşır ({label, rate}); danışman id'si
   * YOK. Etiket bir ekip üyesinin adıyla birebir eşleşiyorsa profiline link
   * verilir — eşleşmeyen etiketler (Ofis, Referans…) düz metin kalır.
   */
  const memberIdByName = new Map(
    (memberRows ?? []).map((m) => [m.full_name as string, m.id as string]),
  );

  return (
    <ListPage>
      <ListHero
        art="komisyon"
        title="Komisyon & hakediş"
        eyebrow="Finans merkezi"
        freshness
        description={<>Komisyon paylaşımı, KDV ve tahsilat durumu tek defterde. <HelpTip topic="komisyon-payi" /></>}
        actions={
          <Link
            href="/app/onaylar?durum=bekliyor"
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-line-strong hover:text-text"
          >
            Onaylar
            {bekleyenOnay > 0 ? <span className="numeric rounded-full bg-[color-mix(in_srgb,var(--viz-5)_18%,transparent)] px-1.5 py-0.5 text-xs font-bold text-[color:var(--pm-warn-text)]">{bekleyenOnay}</span> : null}
            <ArrowUpRight className="h-3.5 w-3.5 opacity-60" aria-hidden />
          </Link>
        }
      />
      {seeAllEarnings && tenantId ? (
        <Suspense fallback={<SkeletonCard height={220} label="Tahmin yükleniyor" />}>
          <PipelineForecastCard tenantId={tenantId} />
        </Suspense>
      ) : null}
      {seeAllEarnings && tenantId ? (
        <Suspense fallback={<SkeletonCard height={360} label="İndirim analizi yükleniyor" />}>
          {/* Danışman bazlı kırılım yalnız ofis sahibi / genel müdür (kazanç gizliliği). */}
          <DiscountAnalysisCard tenantId={tenantId} userId={userId} showAdvisors={role === "owner" || role === "gm"} />
        </Suspense>
      ) : null}
<p className="text-xs font-semibold text-text-muted">{kpiScopeLabel}</p>
      {kpiEmpty ? (
        <p className="rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm text-text-muted">
          Size atanmış bir anlaşmadan doğan komisyon kaydı henüz yok. Anlaşmanız tahsile ulaştığında payınız burada görünür.
        </p>
      ) : null}
      {ownTruncated ? (
        <p className="text-xs text-[color:var(--pm-warn-text)]">Son {OWN_ROWS_LIMIT} kayıt üzerinden hesaplandı; daha eski kayıtlar toplamda yoktur.</p>
      ) : null}
      <div className={kpiEmpty ? "hidden" : undefined}>
      <KpiGrid count={3} label="Toplam komisyon göstergeleri">
        {/* KPI kartları defter filtresine bağlı: tıklayınca ?durum= uygulanır (tarih aralığı korunur) */}
        {[
          { label: seeAllEarnings ? "Toplam komisyon" : "Payım (toplam)", value: <MoneyValue amount={total} />, icon: Wallet, tone: "gold" as const, href: filterHref({ durum: null }), active: durum === null, hint: `${Number(aggregate.record_count).toLocaleString("tr-TR")} kayıt`, series: undefined },
          { label: "Tahsil edilen", value: <MoneyValue amount={paid} />, icon: CheckCircle2, tone: "success" as const, href: filterHref({ durum: "tahsil" }), active: durum === "tahsil", hint: allShares.collectionRate === null ? undefined : `Toplamın %${allShares.collectionRate}'i tahsil edildi`, series: hasAylikSeri ? aylikSeri.map((m) => m.value2) : undefined },
          { label: "Bekleyen", value: <MoneyValue amount={pending} />, icon: Clock3, tone: "warn" as const, href: filterHref({ durum: "bekleyen" }), active: durum === "bekleyen", hint: allShares.collectionRate === null ? undefined : `Toplamın %${100 - allShares.collectionRate}'i bekliyor`, series: undefined },
        ].map((item) => (
          <KpiTile
            key={item.label}
            label={item.label}
            value={item.value}
            icon={item.icon}
            tone={item.tone}
            href={item.href}
            hint={item.hint}
            series={item.series}
            chart="bars"
            seriesUnit="ay"
            seriesLabel="Son 6 ay tahsilat"
            attention={item.active}
            className={item.active ? "!border-[var(--accent)]" : undefined}
          />
        ))}
      </KpiGrid>
      </div>

      {/* Dönem KPI şeridi — bu ayın tahakkuk/tahsilat özeti; kartlar defteri
          ilgili tarih aralığı + durumla süzer (?from/?to/?durum). */}
      <DashCard style={{ boxShadow: "var(--elev-3)" }}>
        <SectionHeader as="h2" title={`Dönem özeti · ${donemLabel} · ${kpiScopeLabel}`} icon={<CalendarRange />} />
        <div className={kpiEmpty ? "hidden" : undefined}>
        <KpiGrid count={4} label="Dönem özeti göstergeleri">
          {[
            { label: "Dönem komisyonu", value: <MoneyValue amount={donemToplam} />, href: filterHref({ durum: null, from: presets[0].from, to: presets[0].to }), tone: "gold" as const, hint: seeAllEarnings ? `Geçen ay tamamı ${money(prevMonthAccrued)}` : undefined },
            { label: "Tahsil edilen", value: <MoneyValue amount={donemTahsil} />, href: filterHref({ durum: "tahsil", from: presets[0].from, to: presets[0].to }), tone: "success" as const, hint: donemShares.collectionRate === null ? undefined : `Dönemin %${donemShares.collectionRate}'i` },
            { label: "Bekleyen", value: <MoneyValue amount={donemBekleyen} />, href: filterHref({ durum: "bekleyen", from: presets[0].from, to: presets[0].to }), tone: "warn" as const, hint: donemShares.collectionRate === null ? undefined : `Dönemin %${100 - donemShares.collectionRate}'i` },
            { label: "Kayıt", value: Number(aggregate.month_record_count).toLocaleString("tr-TR"), href: filterHref({ durum: null, from: presets[0].from, to: presets[0].to }), tone: "neutral" as const, hint: "Bu ay oluşan kayıtlar" },
          ].map((k) => (
            <KpiTile key={k.label} label={k.label} value={k.value} href={k.href} tone={k.tone} hint={k.hint} className="!shadow-none" />
          ))}
        </KpiGrid>
        </div>
        {!kpiEmpty && allShares.total > 0 ? (
          <StatusStackBar
            className="mt-4"
            title="Tüm zamanlar · tahsilat durumu"
            paid={paid}
            pending={pending}
            paidHref={filterHref({ durum: "tahsil", from: null, to: null })}
            pendingHref={filterHref({ durum: "bekleyen", from: null, to: null })}
          />
        ) : null}
        {donemToplam > 0 ? (
          <StatusStackBar
            className="mt-4"
            title="Dönem tahsilat durumu"
            paid={donemTahsil}
            pending={donemBekleyen}
            paidHref={filterHref({ durum: "tahsil", from: presets[0].from, to: presets[0].to })}
            pendingHref={filterHref({ durum: "bekleyen", from: presets[0].from, to: presets[0].to })}
          />
        ) : null}
      </DashCard>

      {/* Danışman bazlı dağılım + beklenen vs tahsil edilen trend */}
      {advisorDist.length > 0 || hasAylikSeri ? (
        <div className="grid items-stretch gap-4 lg:grid-cols-2">
          {advisorDist.length > 0 ? (
            <section className="flex flex-col rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <p className="flex items-center gap-2 text-xs font-semibold text-accent-text"><Wallet className="h-4 w-4" /> Paylaşım analizi</p>
              <h2 className="mt-1 font-display font-bold text-text">Danışman bazlı dağılım</h2>
              <p className="mt-0.5 text-xs text-text-muted">Tüm defterden hesaplanan en yüksek 8 danışman payı</p>
              <ul className="mt-4 mb-4 space-y-3">
                {advisorDist.map((a) => {
                  const memberId = memberIdByName.get(a.label);
                  return (
                    <li key={a.label}>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        {memberId ? (
                          <Link href={`/app/ekip/${memberId}`} className="focus-ring rounded-[4px] font-semibold text-accent-text hover:underline">
                            {a.label}
                          </Link>
                        ) : (
                          <span className="font-semibold text-text">{a.label}</span>
                        )}
                        <span className="numeric font-display text-sm font-bold text-text">{money(a.pay)}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <Progress className="flex-1" value={shareOfMax(a.pay, advisorMax)} label={`${a.label} payı`} />
                        <span className="numeric w-14 shrink-0 text-right text-xs font-semibold tabular-nums text-text-muted">{a.adet} kayıt</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Link
                href={filterHref({})}
                className="focus-ring mt-auto flex items-center justify-between gap-2 rounded-[var(--radius-control)] border-t border-line pt-3 text-xs font-semibold text-text-muted hover:text-text"
              >
                <span>{advisorDist.length} danışman · toplam pay</span>
                <span className="numeric font-display text-sm font-bold text-text">{money(advisorDist.reduce((t, a) => t + a.pay, 0))}</span>
              </Link>
            </section>
          ) : null}
          {hasAylikSeri ? (
            <ChartFrame
              title="Beklenen vs tahsil edilen"
              subtitle="Son 6 ay · tahakkuk eden brüt komisyon ve tahsilatı"
              height={advisorDist.length > 0 ? 300 : 260}
            >
              <InteractiveChart
                data={aylikSeri.map((m) => ({ label: m.label, value: Math.round(m.value), value2: Math.round(m.value2) }))}
                name="Tahakkuk"
                name2="Tahsil edilen"
                color="var(--viz-gold)"
                color2="var(--viz-pos)"
                diffLabel="Bekleyen"
                format="money"
                height={210}
              />
            </ChartFrame>
          ) : null}
        </div>
      ) : null}

      <CommissionSimulator defaultRate={simRate} defaultAdvisorShare={simShare} />

      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div><p className="flex items-center gap-2 text-xs font-semibold text-accent-text"><ReceiptText className="h-4 w-4" /> Gerçek kayıtlar</p><h2 className="mt-1 font-display font-bold text-text">Komisyon defteri</h2></div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-accent-subtle px-2.5 py-1 text-xs font-bold text-accent-text">{totalCount} kayıt</span>
          </div>
        </div>
        {/* Durum filtre çipleri — sunucu filtresi (?durum=), tarih aralığı korunur */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          {[
            { value: null, label: "Tümü" },
            { value: "bekleyen" as const, label: "Bekleyen" },
            { value: "tahsil" as const, label: "Tahsil edilen" },
          ].map((f) => (
            <Link
              key={f.label}
              href={filterHref({ durum: f.value })}
              className={`rounded-[var(--radius-control)] border px-3.5 py-1.5 text-xs font-semibold transition ${
                durum === f.value
                  ? "border-accent bg-accent-subtle text-accent-text"
                  : "border-line bg-surface text-text hover:border-border-interactive"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        {/* Tarih aralığı — GET formu (?from=&to=) + hızlı seçim çipleri; ?durum= korunur */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-text-muted"><CalendarRange className="h-3.5 w-3.5" /> Tarih:</span>
          {presets.map((p) => {
            const active = from === p.from && to === p.to;
            return (
              <Link
                key={p.label}
                href={filterHref({ from: p.from, to: p.to })}
                aria-current={active ? "page" : undefined}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  active
                    ? "border-accent bg-accent-subtle text-accent-text"
                    : "border-line bg-surface text-text-muted hover:border-border-interactive hover:text-accent-text"
                }`}
              >
                {p.label}
              </Link>
            );
          })}
          <form action="/app/komisyon" className="flex flex-wrap items-center gap-2">
            {durum ? <input type="hidden" name="durum" value={durum} /> : null}
            <input
              name="from"
              type="date"
              defaultValue={from ?? ""}
              aria-label="Başlangıç tarihi"
              className="rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-xs outline-none focus:border-accent"
            />
            <span className="text-xs text-text-faint">—</span>
            <input
              name="to"
              type="date"
              defaultValue={to ?? ""}
              aria-label="Bitiş tarihi"
              className="rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-xs outline-none focus:border-accent"
            />
            <button type="submit" className="rounded-[var(--radius-control)] bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover">
              Filtrele
            </button>
            {from || to ? (
              <Link href={filterHref({ from: null, to: null })} className="text-xs font-semibold text-text-muted hover:text-[color:var(--viz-neg)]">
                Tarihi temizle
              </Link>
            ) : null}
          </form>
        </div>
        {/* Kayıtlı görünümler — aktif filtre kombinasyonu adlandırılıp saklanır */}
        <SavedViews
          route="/app/komisyon"
          views={savedViews}
          currentParams={savedViewParams}
          className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3"
        />
        {/* key: sayfa/filtre değişince seçim sıfırlanır — önceki sayfadan
            kalan bayat id'ler "tahsil edildi" işaretlenmesin */}
        <BulkCollectProvider key={`${durum ?? ""}|${from ?? ""}|${to ?? ""}|${sayfa}`}>
          {canEdit ? <BulkCollectBar allIds={pendingIds} /> : null}
          {rows.length === 0 ? (
            <div className="grid place-items-center px-6 py-14 text-center">
              <Illustration kind="komisyon" tone="amber" size={96} />
              <h3 className="mt-4 font-display text-lg font-bold text-text">
                {durum || from || to || sayfa > 1
                  ? "Bu filtrelerle eşleşen komisyon kaydı yok"
                  : "Henüz komisyon kaydı yok"}
              </h3>
              {durum || from || to || sayfa > 1 ? (
                <>
                  <p className="mt-1 max-w-md text-sm text-text-muted">Kapanan anlaşmalardan oluşan komisyon ve hakediş kayıtları burada izlenir.</p>
                  <Link href="/app/komisyon" className="mt-3 text-sm font-semibold text-accent-text hover:underline">
                    Filtreleri temizle
                  </Link>
                </>
              ) : (
                <>
                  <p className="mt-1 max-w-md text-sm text-text-muted">
                    Komisyon elle girilmez; bir anlaşma kazanıldığında otomatik oluşur. Böylece her komisyon bir
                    anlaşmaya ve portföye bağlı kalır, kayıt dışı kalmaz. İlk anlaşmanızı ekleyip kazanıldı olarak
                    kapatın, komisyonunuz burada görünsün.
                  </p>
                  <Link
                    href="/app/anlasmalar/yeni"
                    className="focus-ring btn-shine mt-4 inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover"
                  >
                    Anlaşma ekle
                  </Link>
                </>
              )}
            </div>
          ) : (
            <div className="divide-y divide-line">
              {rows.map((row) => {
                const deal = dealOf(row.deal);
                const property = deal ? (Array.isArray(deal.property) ? deal.property[0] : deal.property) : null;
                const rowPaid = row.status === "paid" || row.status === "collected";
                return (
                  <article
                    key={row.id}
                    className={`group relative grid min-h-10 gap-3 px-5 py-3 transition hover:bg-surface-hover md:items-center ${
                      canEdit ? "md:grid-cols-[auto_1.4fr_.7fr_.7fr_auto]" : "md:grid-cols-[1.4fr_.7fr_.7fr_auto]"
                    }`}
                  >
                    {/* Örtü link: portföylü kayıt portföye, portföysüz kayıt bağlı
                        anlaşmaya gider — para satırı çıkmaz sokak olmasın. */}
                    {property?.id ? (
                      <Link href={`/app/portfoyler/${property.id}`} className="absolute inset-0" aria-label={`${property.title ?? property.property_code ?? "Komisyon"} portföyü`} />
                    ) : row.deal_id ? (
                      <Link href={`/app/anlasmalar/${row.deal_id}`} className="absolute inset-0" aria-label="Bağlı anlaşmayı aç" />
                    ) : null}
                    {canEdit ? (
                      <div className="relative z-10 flex items-center">
                        {!rowPaid ? (
                          <BulkCollectCheckbox id={row.id} label={`${property?.title ?? "Komisyon kaydı"} seç`} />
                        ) : (
                          <span className="inline-block h-4 w-4" aria-hidden />
                        )}
                      </div>
                    ) : null}
                    <div><p className="text-sm font-semibold text-text">{property?.title ?? "Komisyon kaydı"}</p><p className="mt-0.5 text-xs text-text-muted">{property?.property_code ?? (row.deal_id ? "Portföysüz anlaşma" : "Genel işlem")} · {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(row.created_at))}</p></div>
                    <div>
                      <p className="text-xs text-text-faint">Brüt komisyon</p>
                      <p className="font-display text-sm font-bold text-text">{money(Number(row.gross_amount))}</p>
                      {seeAllEarnings && Array.isArray(row.splits) && row.splits.some((s) => s.rate != null && Number.isFinite(Number(s.rate))) ? (
                        <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-text-muted">
                          {row.splits.filter((s) => s.rate != null && Number.isFinite(Number(s.rate))).map((s, i, arr) => {
                            const memberId = s.label ? memberIdByName.get(s.label) : undefined;
                            return (
                              <span key={i}>
                                {memberId ? (
                                  <Link
                                    href={`/app/ekip/${memberId}`}
                                    className="focus-ring relative z-10 rounded-[4px] font-semibold text-accent-text hover:underline"
                                  >
                                    {s.label}
                                  </Link>
                                ) : (
                                  s.label || "Pay"
                                )}
                                {" "}%{s.rate}{i < arr.length - 1 ? " ·" : ""}
                              </span>
                            );
                          })}
                        </p>
                      ) : null}
                    </div>
                    <div><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${rowPaid ? "bg-[color-mix(in_srgb,var(--viz-pos)_13%,transparent)] text-[color:var(--viz-pos)]" : "bg-[color-mix(in_srgb,var(--viz-5)_16%,transparent)] text-[color:var(--pm-warn-text)]"}`}>{rowPaid ? "Tahsil edildi" : "Hesaplandı"}</span></div>
                    {canEdit ? (
                      <div className="relative z-10 flex flex-col items-end gap-1.5">
                        {seeAllEarnings ? (
                          <CommissionSplitEditor commissionId={row.id} gross={Number(row.gross_amount)} initial={row.splits} />
                        ) : null}
                        <CommissionActions commissionId={row.id} amount={Number(row.gross_amount)} status={row.status} />
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </BulkCollectProvider>
        {/* Sayfalama — ?sayfa=, filtreler korunur */}
        {totalPages > 1 ? (
          <nav aria-label="Sayfalama" className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
            <span className="numeric text-xs font-medium text-text-muted">
              Sayfa {sayfa} / {totalPages} · toplam {totalCount.toLocaleString("tr-TR")} kayıt
            </span>
            <div className="flex items-center gap-2">
              {sayfa > 1 ? (
                <Link href={pageHref(sayfa - 1)} className="focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text transition hover:border-border-interactive">
                  <ChevronLeft className="h-3.5 w-3.5" /> Önceki
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">
                  <ChevronLeft className="h-3.5 w-3.5" /> Önceki
                </span>
              )}
              {sayfa < totalPages ? (
                <Link href={pageHref(sayfa + 1)} className="focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text transition hover:border-border-interactive">
                  Sonraki <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">
                  Sonraki <ChevronRight className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          </nav>
        ) : null}
        <div className="flex items-center gap-2 border-t border-line bg-canvas/60 px-5 py-3 text-xs font-semibold text-[color:var(--viz-pos)]"><TrendingUp className="h-3.5 w-3.5" /> Tüm hesaplamalar denetim iziyle saklanır</div>
      </section>
    </ListPage>
  );
}
