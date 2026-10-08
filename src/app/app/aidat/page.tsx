import { batchAll } from "@/lib/supabase/query-batch";
import Link from "@/components/ui/smart-link";
import { Coins, TrendingUp, AlertTriangle, ArrowUpRight, CalendarRange, ChevronLeft, ChevronRight, Gauge, PieChart, X } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { msSince, now, DAY_MS, trDayKey, trMonthKey } from "@/lib/clock";
import { DuesClient } from "./dues-client";
import { DistributionCard, ListCharts, ListHero, ListPage } from "@/components/ui/list-page";
import { KpiStrip, type KpiItem } from "@/components/ui/list-kit";
import { DetailTabs, resolveTab, type DetailTabDef } from "@/components/app/detail-tabs";
import { Building2, Landmark, Scale } from "lucide-react";
import { loadBuildingChargesPage, loadBuildingKpi } from "@/lib/building-management/load";
import { BUILDING_STATUS_LABELS, deriveBuildingChargeStatus } from "@/lib/building-management/charges";
import { BinalarTab } from "./binalar-tab";
import { CariTab } from "./cari-tab";

export const metadata = { title: "Aidat & Bina Yönetimi" };

const TAB_IDS = ["genel", "binalar", "cari"] as const;
const UUID_PARAM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BUILDING_PAGE_SIZE = 15;

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

const DURUM_FILTERS = ["paid", "unpaid", "overdue"] as const;
type DurumFilter = (typeof DURUM_FILTERS)[number];

const DURUM_LABELS: Record<DurumFilter, string> = {
  paid: "Ödendi",
  unpaid: "Bekleyen",
  overdue: "Gecikmiş",
};

const DONEM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Sayfa başına aidat — gerçek sayfalama (300'lük dilim + bellek filtresi yerine). */
const PAGE_SIZE = 50;

const PAGER_BTN =
  "focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 shadow-[var(--elev-1)] transition hover:bg-canvas";
const PAGER_BTN_DISABLED =
  "inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 opacity-40";

/** ?donem=YYYY-MM için sonraki ayın ilk gününü döndürür (period aralığı için). */
function nextMonthFirst(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

/** Boş olmayan paramlardan query string üretir — mevcut filtreler korunur. */
function qs(params: Record<string, string | null | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

type DueLite = {
  id: string;
  title: string;
  amount: number;
  period: string;
  due_date: string | null;
  status: string;
  notes: string | null;
  property: { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null;
};

export default async function AidatPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; donem?: string; sayfa?: string; bsayfa?: string; sekme?: string; bina?: string; bolum?: string; daire?: string }>;
}) {
  const { perms, tenantId } = await requireModulePage("expenses", "/app/aidat");
  const params = (await searchParams) ?? {};
  const tab = resolveTab(params, TAB_IDS, "genel");
  const tabDefs: DetailTabDef[] = [
    { id: "genel", label: "Genel", icon: Landmark },
    { id: "binalar", label: "Binalar", icon: Building2 },
    { id: "cari", label: "Daire cari", icon: Scale },
  ];
  const tabStrip = <DetailTabs basePath="/app/aidat" tabs={tabDefs} active={tab} label="Aidat ve bina yönetimi sekmeleri" />;

  if (tab !== "genel") {
    const supabase = await createClient();
    const today = trDayKey(now());
    return (
      <ListPage>
        <ListHero
          eyebrow="Aidat & bina yönetimi"
          art="aidat"
          title="Bina & site yönetimi"
          description="Apartman ve siteleri komple yönetin: dairelere dönem aidatı, ortak gider paylaştırma, tahsilat ve daire cari tek yerde."
        />
        {tabStrip}
        {tab === "binalar" ? (
          <BinalarTab
            db={supabase}
            tenantId={tenantId ?? ""}
            today={today}
            binaId={UUID_PARAM.test(params.bina ?? "") ? params.bina! : ""}
            bolum={params.bolum ?? ""}
            perms={{
              canCreate: perms.expenses?.includes("create") ?? false,
              canEdit: perms.expenses?.includes("edit") ?? false,
              canDelete: perms.expenses?.includes("delete") ?? false,
              canOffset: perms.rentals?.includes("edit") ?? false,
            }}
          />
        ) : (
          <CariTab db={supabase} tenantId={tenantId ?? ""} daireId={UUID_PARAM.test(params.daire ?? "") ? params.daire! : ""} />
        )}
      </ListPage>
    );
  }

  const durumF = DURUM_FILTERS.includes(params.durum as DurumFilter) ? (params.durum as DurumFilter) : "";
  const donemF = DONEM_RE.test(params.donem ?? "") ? params.donem! : "";
  const canCreate = perms.expenses?.includes("create") ?? false;
  const canEdit = perms.expenses?.includes("edit") ?? false;
  const page = Math.max(1, Number.parseInt(params.sayfa ?? "", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Mevcut filtreleri koruyan link üretici (sayfa taşınmaz — filtre değişince 1. sayfaya döner)
  const href = (next: { durum?: string | null; donem?: string | null }) =>
    `/app/aidat${qs({
      durum: next.durum === undefined ? durumF || null : next.durum,
      donem: next.donem === undefined ? donemF || null : next.donem,
    })}`;

  // Sayfalama linki — mevcut filtreleri korur, yalnız ?sayfa değişir.
  const pageHref = (n: number) =>
    `/app/aidat${qs({ durum: durumF || null, donem: donemF || null, sayfa: n > 1 ? String(n) : null })}`;

  const supabase = await createClient();
  // Overdue = ödenmemiş + vadesi bugün ya da öncesi (isPast(due_date) semantiği).
  const todayStr = new Date(now()).toISOString().slice(0, 10);

  // ---- Sayfalanan liste: filtreler DB sorgusuna iner (eskiden 300 dilim +
  //      bellek filtresi → 300'ü aşan ofiste ?durum/?donem "kayıt yok" diyordu).
  let listQuery = supabase
    .from("property_dues")
    .select("id, title, amount, period, due_date, status, notes, property:properties!property_dues_property_id_fkey(id, property_code, title)", { count: "exact" });
  if (tenantId) listQuery = listQuery.eq("tenant_id", tenantId);
  if (donemF) listQuery = listQuery.gte("period", `${donemF}-01`).lt("period", nextMonthFirst(donemF));
  if (durumF === "paid") listQuery = listQuery.eq("status", "paid");
  else if (durumF === "unpaid") listQuery = listQuery.neq("status", "paid");
  else if (durumF === "overdue") listQuery = listQuery.neq("status", "paid").lte("due_date", todayStr);
  listQuery = listQuery
    .order("period", { ascending: false })
    .order("due_date", { ascending: true, nullsFirst: false })
    .range(offset, offset + PAGE_SIZE - 1);

  // ---- KPI toplamları: DB'de TAM SUM (aidat_kpi RPC) — önceki 2000-satır havuz
  //      yaklaşıktı ve büyük ofiste eksik sayardı. Geciken ŞERİDİ için ayrı odaklı
  //      sorgu (en yakın vadeli ilk 20 geciken); tüm havuzu çekmeye gerek yok.
  let overdueStripQuery = supabase
    .from("property_dues")
    .select("id, title, amount, period, due_date, status, property:properties!property_dues_property_id_fkey(id, property_code, title)")
    .neq("status", "paid")
    .lte("due_date", todayStr)
    .order("due_date", { ascending: true })
    .limit(20);
  if (tenantId) overdueStripQuery = overdueStripQuery.eq("tenant_id", tenantId);

  const [
    { data: listData, count: listCount, error: listError },
    kpiRes,
    { data: overdueStripData, error: overdueStripError },
    { data: propData, error: propertiesError },
  ] = await batchAll("Aidat", [], [
    listQuery,
    supabase.rpc("aidat_kpi"),
    overdueStripQuery,
    supabase
      .from("properties")
      .select("id, property_code, title")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  const readFailures = [listError, kpiRes.error, overdueStripError, propertiesError].filter(Boolean);
  if (readFailures.length > 0) {
    console.error("aidat page data load failed", {
      codes: readFailures.map((error) => error?.code || "unknown"),
    });
    throw new Error("Aidat verileri güvenli şekilde yüklenemedi.");
  }

  // ---- Bina aidatları (M2): KPI RPC + bu ay tekil mülk aidatı toplamları + bina tahakkuk listesi (aynı durum/dönem süzgeci).
  // Tablolar/RPC yoksa (migration uygulanmamış) null döner ve bölüm sessizce gizlenir; tekil mülk aidatı çalışmaya devam eder.
  const todayKey = trDayKey(now());
  const bHref = (n: number) => `/app/aidat${qs({ durum: durumF || null, donem: donemF || null, bsayfa: n > 1 ? String(n) : null })}`;
  const monthKey = donemF || trMonthKey(now());
  const monthStart = `${monthKey}-01`;
  const monthEnd = nextMonthFirst(monthKey);
  const bPage = Math.max(1, Number.parseInt(params.bsayfa ?? "", 10) || 1);
  const [bldKpi, bldList, monthChargedRes, monthPaidRes] = await Promise.all([
    loadBuildingKpi(supabase, monthStart),
    loadBuildingChargesPage(supabase, {
      tenantId: tenantId ?? "",
      today: todayKey,
      durum: durumF,
      donem: donemF,
      offset: (bPage - 1) * BUILDING_PAGE_SIZE,
      limit: BUILDING_PAGE_SIZE,
    }),
    supabase.from("property_dues").select("amount").eq("tenant_id", tenantId ?? "").gte("period", monthStart).lt("period", monthEnd).limit(5000),
    supabase.from("property_dues").select("amount").eq("tenant_id", tenantId ?? "").eq("status", "paid").gte("paid_at", `${monthStart}T00:00:00+03:00`).lt("paid_at", `${monthEnd}T00:00:00+03:00`).limit(5000),
  ]);
  const sumRows = (rows: { amount: number | string }[] | null) => Math.round((rows ?? []).reduce((s, r) => s + Number(r.amount) * 100, 0)) / 100;
  const duesMonthCharged = monthChargedRes.error ? 0 : sumRows(monthChargedRes.data as { amount: number | string }[] | null);
  const duesMonthPaid = monthPaidRes.error ? 0 : sumRows(monthPaidRes.data as { amount: number | string }[] | null);

  const filteredDues = (listData ?? []) as unknown as DueLite[];
  const properties = (propData ?? []).map((p) => ({ id: p.id as string, property_code: p.property_code as string, title: p.title as string | null }));

  // KPI'lar tüm kayıtlar üzerinden (RPC, filtreden bağımsız); ?durum=/?donem= listeyi süzer.
  const kpi = ((Array.isArray(kpiRes.data) ? kpiRes.data[0] : kpiRes.data) ?? {}) as {
    total?: number; unpaid?: number; overdue_count?: number; overdue_total?: number;
  };
  const total = Number(kpi.total ?? 0);
  const unpaid = Number(kpi.unpaid ?? 0);
  const paidAmount = total - unpaid;
  const overdue = Number(kpi.overdue_count ?? 0);
  const overdueTotal = Number(kpi.overdue_total ?? 0);
  const overdueDues = (overdueStripData ?? []) as unknown as DueLite[];

  // Sayfalama toplamları — count filtreye (durum/dönem) duyarlı gerçek toplam.
  const totalFiltered = listCount ?? filteredDues.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const rangeStart = totalFiltered === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + filteredDues.length, totalFiltered);

  const donemLabel = donemF
    ? new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(`${donemF}-01T00:00:00`))
    : "";

  // KPI şeridi: tekil mülk aidatları (aidat_kpi RPC) + bina aidatları (building_dues_kpi RPC) BİRLEŞİK; her kart ilgili süzgeçli listeye iner.
  const monthName = new Intl.DateTimeFormat("tr-TR", { month: "long" }).format(new Date(`${monthStart}T00:00:00`));
  const periodWord = donemF ? donemLabel : "Bu ay";
  const chargedMonth = Math.round((duesMonthCharged + (bldKpi?.chargedMonth ?? 0)) * 100) / 100;
  const collectedMonth = Math.round((duesMonthPaid + (bldKpi?.collectedMonth ?? 0)) * 100) / 100;
  const overdueAll = overdue + (bldKpi?.overdueCount ?? 0);
  const overdueAllTotal = Math.round((overdueTotal + (bldKpi?.overdueTotal ?? 0)) * 100) / 100;
  const debtAll = Math.round((unpaid + (bldKpi?.outstandingTotal ?? 0)) * 100) / 100;
  const kpis: KpiItem[] = [
    {
      label: `${periodWord} tahakkuk`,
      value: money(chargedMonth),
      icon: <TrendingUp />,
      tone: "info",
      href: href({ durum: null, donem: monthKey }),
      hint: bldKpi ? `tekil mülk + bina · ${monthName}` : `tekil mülk aidatı · ${monthName}`,
    },
    {
      label: `${periodWord} tahsil`,
      value: money(collectedMonth),
      icon: <Gauge />,
      tone: "success",
      href: href({ durum: "paid", donem: monthKey }),
      hint: chargedMonth > 0 ? `tahakkukun %${Math.min(100, Math.round((collectedMonth / chargedMonth) * 100))}'i` : "tahakkuk yok",
    },
    {
      label: "Geciken",
      value: overdueAll,
      icon: <AlertTriangle />,
      tone: "danger",
      attention: true,
      href: href({ durum: "overdue" }),
      hint: overdueAll > 0 ? money(overdueAllTotal) : "vadesi geçen yok",
    },
    { label: "Toplam borç", value: money(debtAll), icon: <Coins />, tone: "warning", href: href({ durum: "unpaid" }), hint: "ödenmemiş toplam tutar" },
  ];

  return (
    <ListPage>
      <ListHero
        eyebrow="Aidat & bina yönetimi"
        art="aidat"
        title="Bina & site yönetimi"
        description="Portföy aidatları ile yönettiğiniz bina/sitelerin aidat, gider paylaştırma ve tahsilat durumu tek yerde."
      />
      {tabStrip}

      <KpiStrip items={kpis} />

      {/* Tahsilat dağılımı (tutar bazlı, RPC toplamı): dilim = filtreli liste */}
      <ListCharts>
        <DistributionCard
          title="Tekil mülk aidatı tahsilatı"
          subtitle="Portföy aidatlarının ödenen ve bekleyen tutarı"
          icon={PieChart}
          tone="success"
          format="money"
          centerLabel="toplam"
          href={href({ durum: null })}
          slices={[
            { label: "Tahsil edildi", value: paidAmount, tone: "success", href: href({ durum: "paid" }) },
            { label: "Bekleyen", value: unpaid, tone: "warn", href: href({ durum: "unpaid" }) },
          ]}
        />
      </ListCharts>

      {/* Geciken ödemeler şeridi — vadesi geçmiş kayıtlar, en eski vade önce.
          Kart portföye (varsa) gider; başlık linki listeyi ?durum=overdue süzer. */}
      {overdue > 0 ? (
        <section className="overflow-hidden rounded-[var(--radius-panel)] border border-danger-500/25 bg-danger-50/60 shadow-[var(--shadow-xs)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-danger-500/15 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-bold text-danger-600">
              <AlertTriangle className="h-4 w-4" /> Geciken ödemeler
              <span className="rounded-full bg-danger-500/10 px-2 py-0.5 text-xs font-bold text-danger-600">
                {overdue} kayıt · {money(overdueTotal)}
              </span>
            </p>
            <Link
              href={href({ durum: "overdue" })}
              className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] text-xs font-semibold text-danger-600 transition hover:text-danger-700 hover:underline"
            >
              Tümünü listede gör <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto px-4 py-3">
            {overdueDues.slice(0, 8).map((d) => {
              const prop = Array.isArray(d.property) ? d.property[0] : d.property;
              const gecikmeGun = d.due_date ? Math.max(1, Math.floor(msSince(`${d.due_date}T00:00:00`) / DAY_MS)) : 0;
              const target = prop?.id ? `/app/portfoyler/${prop.id}` : href({ durum: "overdue" });
              return (
                <Link
                  key={d.id}
                  href={target}
                  className="focus-ring press lift group block min-w-[210px] shrink-0 rounded-[var(--radius-card)] border border-danger-500/20 bg-surface p-3 transition hover:border-danger-500/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-ink-950">{d.title}</p>
                    <ArrowUpRight className="hover-action h-3.5 w-3.5 shrink-0 text-text-faint opacity-0 transition group-hover:text-danger-500 group-hover:opacity-100" />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-text-muted">
                    {prop ? (prop.title ?? prop.property_code) : "Portföysüz kayıt"}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="numeric font-display text-sm font-extrabold text-ink-950">{money(Number(d.amount))}</span>
                    <span className="rounded-full bg-danger-500/10 px-2 py-0.5 text-xs font-bold text-danger-600">
                      {gecikmeGun} gün gecikti
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Dönem (ay) filtresi — GET formu (?donem=YYYY-MM); ?durum= korunur */}
      <form action="/app/aidat" className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
        {durumF ? <input type="hidden" name="durum" value={durumF} /> : null}
        <span className="flex items-center gap-1.5 text-xs font-semibold text-text-muted"><CalendarRange className="h-3.5 w-3.5" /> Dönem:</span>
        <input
          name="donem"
          type="month"
          defaultValue={donemF}
          aria-label="Dönem (ay) filtresi"
          className="rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
        />
        <button type="submit" className="rounded-[var(--radius-control)] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700">
          Filtrele
        </button>
        {donemF ? (
          <Link href={href({ donem: null })} className="text-xs font-semibold text-text-muted hover:text-danger-500">
            Dönemi temizle
          </Link>
        ) : null}
      </form>

      {/* Aktif filtre çipleri */}
      {durumF || donemF ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-muted">Filtre:</span>
          {durumF ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600/10 px-3 py-1 text-xs font-semibold text-brand-700">
              {DURUM_LABELS[durumF]}
              <Link href={href({ durum: null })} aria-label="Durum filtresini temizle" className="focus-ring rounded-full hover:text-brand-900">
                <X className="h-3.5 w-3.5" />
              </Link>
            </span>
          ) : null}
          {donemF ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600/10 px-3 py-1 text-xs font-semibold text-brand-700">
              {donemLabel}
              <Link href={href({ donem: null })} aria-label="Dönem filtresini temizle" className="focus-ring rounded-full hover:text-brand-900">
                <X className="h-3.5 w-3.5" />
              </Link>
            </span>
          ) : null}
          <span className="numeric text-xs text-text-faint">{totalFiltered.toLocaleString("tr-TR")} kayıt</span>
        </div>
      ) : null}

      {/* Bina aidatları — aynı durum/dönem süzgeciyle; satır ilgili binanın tahsilat ekranına gider. */}
      {bldList && bldList.count > 0 ? (
        <section className="space-y-2" aria-label="Bina aidatları">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Building2 className="h-4 w-4 text-brand-600" /> Bina aidatları
              <span className="numeric text-xs font-normal text-text-faint">{bldList.count.toLocaleString("tr-TR")} kayıt</span>
            </h2>
            <Link href="/app/aidat?sekme=binalar" className="text-xs font-semibold text-brand-600 hover:underline">Binalara git</Link>
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            {bldList.rows.map((r) => {
              const status = deriveBuildingChargeStatus({ amount: r.amount, paid: r.paid, dueDate: r.dueDate, today: todayKey });
              const tone = status === "paid" ? "bg-mint-500/12 text-mint-700" : status === "overdue" ? "bg-danger-500/10 text-danger-600" : status === "partial" ? "bg-brand-600/10 text-brand-700" : "bg-amber-400/15 text-amber-700";
              return (
                <li key={r.id}>
                  <Link href={`/app/aidat?sekme=binalar&bina=${r.buildingId}&bolum=tahsilat`} className="focus-ring flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 transition hover:bg-canvas">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink-950">{r.buildingName} · {r.unitLabel}</span>
                      <span className="block truncate text-xs text-text-muted">{r.batchTitle} · vade {r.dueDate}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="numeric text-sm font-bold text-ink-950">{money(r.amount)}</span>
                      {r.paid > 0 && r.paid < r.amount ? <span className="numeric text-xs text-text-muted">ödenen {money(r.paid)}</span> : null}
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${tone}`}>{BUILDING_STATUS_LABELS[status]}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {bldList.count > BUILDING_PAGE_SIZE ? (
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span className="numeric">{(bPage - 1) * BUILDING_PAGE_SIZE + 1}–{Math.min(bPage * BUILDING_PAGE_SIZE, bldList.count)} / {bldList.count}</span>
              <span className="flex gap-2">
                {bPage > 1 ? <Link href={bHref(bPage - 1)} className={PAGER_BTN}>Önceki</Link> : null}
                {bPage * BUILDING_PAGE_SIZE < bldList.count ? <Link href={bHref(bPage + 1)} className={PAGER_BTN}>Sonraki</Link> : null}
              </span>
            </div>
          ) : null}
        </section>
      ) : bldList && !durumF && !donemF ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-3 text-sm text-text-muted">
          Bir apartmanı ya da siteyi komple mi yönetiyorsunuz?{" "}
          <Link href="/app/aidat?sekme=binalar" className="font-semibold text-brand-600 hover:underline">Binalar sekmesinden</Link> bina ve daireleri ekleyip dönem aidatını tek tıkla tüm dairelere tahakkuk ettirebilirsiniz.
        </p>
      ) : null}

      <DuesClient dues={filteredDues as Parameters<typeof DuesClient>[0]["dues"]} properties={properties} canCreate={canCreate} canBulk={canEdit} />

      {/* Sayfalama — filtre parametreleri linklerde korunur */}
      {totalFiltered > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="numeric text-text-muted">
            {rangeStart.toLocaleString("tr-TR")}–{rangeEnd.toLocaleString("tr-TR")} / Toplam{" "}
            {totalFiltered.toLocaleString("tr-TR")}
          </p>
          <div className="flex items-center gap-1.5">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className={PAGER_BTN}>
                <ChevronLeft className="h-4 w-4" /> Önceki
              </Link>
            ) : (
              <span className={PAGER_BTN_DISABLED} aria-disabled="true">
                <ChevronLeft className="h-4 w-4" /> Önceki
              </span>
            )}
            <span className="numeric px-1 text-text-faint">
              {Math.min(page, totalPages)} / {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={pageHref(page + 1)} className={PAGER_BTN}>
                Sonraki <ChevronRight className="h-4 w-4" />
              </Link>
            ) : (
              <span className={PAGER_BTN_DISABLED} aria-disabled="true">
                Sonraki <ChevronRight className="h-4 w-4" />
              </span>
            )}
          </div>
        </div>
      ) : null}
    </ListPage>
  );
}
