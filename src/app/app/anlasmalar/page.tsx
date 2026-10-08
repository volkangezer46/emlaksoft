import { redirect } from "next/navigation";
import Link from "@/components/ui/smart-link";
import {
  AlarmClock,
  ArrowUpRight,
  Filter,
  Handshake,
  KanbanSquare,
  List,
  Percent,
  PieChart,
  Plus,
  Search,
  Target,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { batchAll } from "@/lib/supabase/query-batch";
import { requireModulePage } from "@/lib/require-module-page";
import { hasOfficeWideDataScope } from "@/lib/permission-data-scope";
import { applyScopeFilter, getListScope } from "@/lib/access-control";
import { ScopeBadge } from "@/components/app/scope-badge";
import { getStageLabels } from "@/lib/definitions";
import { daysAgoIso, msSince } from "@/lib/clock";
import { InteractiveChart } from "@/components/app/interactive-chart";
import type { BoardDeal } from "./deal-board";
import { DealBoard } from "./deal-board-lazy";
import { ListLimitNotice } from "@/components/app/list-limit-notice";
import { ReferralNudge } from "@/components/app/referral-nudge";
import { listSavedViews } from "@/app/actions/saved-views";
import { SavedViews } from "@/components/app/saved-views";
import { applyCustomFieldIds, customFilterRaw, customFilterValue, resolveCustomFieldFilter } from "@/lib/custom-fields/filter";
import { CustomFieldFilterBar } from "@/components/app/custom-field-filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { relatedSearchClause } from "@/lib/list-search";
import { buildHref } from "@/lib/ui/filter-params";
import { DistributionCard, FunnelCard, ListCharts, ListHero, ListPage } from "@/components/ui/list-page";
import { ButtonLink } from "@/components/ui/button";
import { MoneyValue } from "@/components/ui/money-value";
import {
  CategoryChips,
  FilterGrid,
  FilterSelect,
  KpiStrip,
  ListPager,
  ListToolbar,
  buildActiveChips,
  densityOf,
  mergeResetPage,
  pageWindow,
  parsePage,
  uuidParam,
  type KpiItem,
  type ViewOption,
} from "@/components/ui/list-kit";
import { getSetting } from "@/lib/settings/read";
import { DealTable, type DealVM } from "./deal-rows";
import { DealBulkBar } from "./deal-bulk-bar";
import { BulkSelectionProvider } from "@/components/app/bulk-selection";
import {
  DEAL_STAGE_KEYS,
  OPEN_STAGES,
  STALE_DAYS as DEFAULT_STALE_DAYS,
  dealStageTone,
  parseStageParam,
  sumDeals,
  updatedAgoLabel,
  winRate,
} from "./deal-list-logic";

export const metadata = { title: "Anlaşmalar" };

const PATH = "/app/anlasmalar";

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

/** KPI kartı için kompakt tutar ("₺44,3 Mn"); tam değer kartın title'ında. */
function moneyKpi(n: number) {
  const abs = Math.abs(n);
  if (abs < 1_000_000) return `₺${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n)}`;
  const v = abs >= 1_000_000_000 ? n / 1_000_000_000 : n / 1_000_000;
  return `₺${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(v)} ${abs >= 1_000_000_000 ? "Mr" : "Mn"}`;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** Liste görünümünde sayfa başına kayıt — gerçek sayfalama. */
const PAGE_SIZE = 50;
/** Tutar toplamları için taranan azami kayıt; tavana dayanırsa rakamlar gösterilmez. */
const SUM_SCAN_LIMIT = 2000;

/**
 * Satış hunisi görselleştirmesi — aşama sırası deal-board ile aynı; renkler de
 * sütun tonlarını izler (renk varlığı takip eder). Her satır ilgili sütuna iner.
 */
const FUNNEL_STAGES: { key: "new" | "qualified" | "negotiation" | "won"; bar: string; text: string }[] = [
  { key: "new", bar: "bg-cyan-500", text: "text-cyan-600" },
  { key: "qualified", bar: "bg-brand-600", text: "text-brand-600" },
  { key: "negotiation", bar: "bg-amber-400", text: "text-amber-600" },
  { key: "won", bar: "bg-mint-500", text: "text-mint-600" },
];

export default async function DealsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    yeni?: string;
    gorunum?: string;
    q?: string;
    asama?: string;
    danisman?: string;
    bayat?: string;
    sayfa?: string;
    yogunluk?: string;
  }>;
}) {
  const sp = (await searchParams) ?? {};
  if (sp.yeni === "1") redirect("/app/anlasmalar/yeni");
  const { perms, role, userId, tenantId } = await requireModulePage("commissions");
  // Ofis Tanımları Merkezi: hareketsiz anlaşma eşiği (ayar yoksa kod varsayılanı 14 gün). Arama ön sorgusuyla aynı turda beklenir.
  const staleDaysPromise = tenantId ? getSetting<number>("office.alert.deal_stale_days", { tenantId }) : Promise.resolve(DEFAULT_STALE_DAYS);
  const canCreate = (perms.commissions ?? []).includes("create");
  const canEdit = (perms.commissions ?? []).includes("edit");
  const supabase = await createClient();
  const savedViewsPromise = listSavedViews(PATH);

  // Pano korunur (varsayılan); ?gorunum=liste kit tablosunu açar.
  const gorunum: "pano" | "liste" = sp.gorunum === "liste" ? "liste" : "pano";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const asamaF = parseStageParam(sp.asama);
  // Ofis geneli kapsam yalnız owner/gm/branch_manager; diğer roller yalnız kendi anlaşmalarını görür
  // (arama ve dışa aktarma ile aynı kural). ?danisman= başkasının kimliğini açamaz.
  const officeWide = hasOfficeWideDataScope(role);
  const danismanF = officeWide ? uuidParam(sp.danisman) : userId;
  // Kullanıcı kapsamı (ofis bayrağı açıksa) eski rol kuralını yalnız DARALTIR (takım/şube lideri ofis geneli yerine üyelerini görür).
  // Kapsam, özel alan süzgeci ve arama ön sorgusu birbirinden bağımsız: aşağıda TEK turda beklenir (eskiden 3 ardışık tur).
  const listScopeP = getListScope({ userId, tenantId, role, mineOnly: !officeWide });
  const bayatF = sp.bayat === "1";
  const density = densityOf(sp.yogunluk);
  const page = parsePage(sp.sayfa);
  const offset = (page - 1) * PAGE_SIZE;

  const urlParams: Record<string, string> = {};
  if (gorunum === "liste") urlParams.gorunum = "liste";
  if (q) urlParams.q = q;
  if (asamaF && gorunum === "liste") urlParams.asama = asamaF;
  if (officeWide && danismanF) urlParams.danisman = danismanF;
  if (bayatF) urlParams.bayat = "1";
  if (density === "kompakt" && gorunum === "liste") urlParams.yogunluk = "kompakt";
  // Özel alan filtresi (?ozel=anahtar:değer): liste ve pano aynı kimlik kümesiyle daralır.
  const customFilterP = resolveCustomFieldFilter(supabase, tenantId, "deal", customFilterRaw(sp as Record<string, string | undefined>));
  const searchP = relatedSearchClause(supabase, q, { customerColumn: "customer_id", propertyColumn: "property_id" });
  const [listScope, customFilter, STALE_DAYS, search] = await Promise.all([listScopeP, customFilterP, staleDaysPromise, searchP]);
  const scoped = <Q,>(q: Q): Q => applyScopeFilter(q, listScope.filter, { ownerColumn: "assigned_to" });
  if (customFilter.active) urlParams.ozel = customFilterValue(customFilter.active.def.key, customFilter.active.value);
  const hrefWith = (patch: Record<string, string>) => buildHref(PATH, mergeResetPage(urlParams, patch));
  const savedViewParams = Object.fromEntries(Object.entries(urlParams).filter(([k]) => k !== "yogunluk"));

  const staleIso = daysAgoIso(STALE_DAYS);
  const scope: Record<string, string> = danismanF ? { assigned_to: danismanF } : {};

  const SELECT_COLS =
    "id, stage, deal_type, deal_value, probability, assigned_to, updated_at, property_id, customer_id, project_unit_id, property:properties!deals_property_id_fkey(id, title, property_code), customer:customers!deals_customer_id_fkey(id, full_name, phone), deal_notes!deal_notes_deal_id_fkey(count)";

  // Liste/pano ortak filtreleri (danışman kapsamı, arama, bayat); aşama yalnız liste görünümünde.
  let listQuery = scoped(supabase.from("deals").select(SELECT_COLS, { count: "exact" }).match(scope));
  if (search.clause) listQuery = listQuery.or(search.clause);
  listQuery = applyCustomFieldIds(listQuery, customFilter.ids);
  if (bayatF) listQuery = listQuery.not("stage", "in", "(won,lost)").lt("updated_at", staleIso);
  if (gorunum === "liste") {
    if (asamaF === "acik") listQuery = listQuery.not("stage", "in", "(won,lost)");
    else if (asamaF) listQuery = listQuery.eq("stage", asamaF);
    listQuery = listQuery.order("updated_at", { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
  } else {
    // Pipeline 200 anlaşmayla sınırlı; gerçek toplam ListLimitNotice ile gösterilir.
    listQuery = listQuery.order("updated_at", { ascending: false }).limit(200);
  }

  const head = () => scoped(supabase.from("deals").select("id", { count: "exact", head: true }).match(scope));

  const dealsP = Promise.resolve(search.empty ? { data: [], count: 0 } : listQuery);
  const relatedP = dealsP.then(async (res) => {
    const rows = (res.data ?? []) as unknown as Array<{ id: string; project_unit_id?: string | null }>;
    const ids = rows.map((d) => d.id);
    const unitIds = [...new Set(rows.map((d) => d.project_unit_id).filter((v): v is string => Boolean(v)))];
    return Promise.all([
      ids.length
        ? supabase.from("deal_checklist_items").select("deal_id, is_required, is_done").in("deal_id", ids).eq("is_required", true)
        : Promise.resolve({ data: [] as { deal_id: string; is_required: boolean; is_done: boolean }[] }),
      // Proje dairesi bağı (deals.project_unit_id): bileşik FK gömmesine güvenmeden ayrı, tek sorgu.
      unitIds.length
        ? supabase.from("project_units").select("id, unit_no, block, project_id, project:projects!project_units_project_id_fkey(name)").in("id", unitIds)
        : Promise.resolve({ data: [] as unknown[] }),
    ]);
  });

  const [
    { data: dealsRaw, count: dealCount },
    { data: members },
    [{ data: checklistRows }, { data: unitRows }],
    stageLabels,
    savedViews,
    sumScan,
    newRes,
    qualifiedRes,
    negotiationRes,
    wonRes,
    lostRes,
    staleRes,
    realWonRes,
  ] = await batchAll("Anlaşmalar", ["deals", "profiles", "deal-checklist", "stage-labels", "saved-views", "sum-scan", "stage-new", "stage-qualified", "stage-negotiation", "stage-won", "stage-lost", "stale", "real-won"], [
    dealsP,
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    relatedP,
    getStageLabels(),
    savedViewsPromise,
    scoped(supabase.from("deals").select("stage, deal_value, probability").match(scope)).limit(SUM_SCAN_LIMIT),
    head().eq("stage", "new"),
    head().eq("stage", "qualified"),
    head().eq("stage", "negotiation"),
    head().eq("stage", "won"),
    head().eq("stage", "lost"),
    head().not("stage", "in", "(won,lost)").lt("updated_at", staleIso),
    // Davet önerisi tetiği: örnek (demo) anlaşmalar sayılmaz; yalnız gerçek kazanılmış anlaşma.
    head().eq("stage", "won").eq("is_sample", false),
  ]);

  const checklistByDeal = new Map<string, { done: number; total: number }>();
  for (const r of checklistRows ?? []) {
    const agg = checklistByDeal.get(r.deal_id) ?? { done: 0, total: 0 };
    agg.total += 1;
    if (r.is_done) agg.done += 1;
    checklistByDeal.set(r.deal_id, agg);
  }
  const advisors = (members ?? []).map((m) => ({ id: String(m.id), name: String(m.full_name ?? "") }));
  type UnitRow = { id: string; unit_no: string; block: string | null; project_id: string; project: { name?: string } | { name?: string }[] | null };
  const unitById = new Map(
    ((unitRows ?? []) as UnitRow[]).map((u) => {
      const proj = Array.isArray(u.project) ? u.project[0] : u.project;
      const label = [proj?.name, u.block ? `${u.block} blok` : null, `No ${u.unit_no}`].filter(Boolean).join(" · ");
      return [u.id, { label, href: `/app/projeler/${u.project_id}` }] as const;
    }),
  );
  const advisorName = new Map(advisors.map((a) => [a.id, a.name]));

  type RawDeal = {
    id: string;
    stage: string;
    deal_type: string;
    deal_value: number | string | null;
    probability: number | string | null;
    assigned_to: string | null;
    updated_at: string;
    property_id: string | null;
    customer_id: string | null;
    project_unit_id?: string | null;
    property: unknown;
    customer: unknown;
    deal_notes: unknown;
  };
  const rawRows = (dealsRaw ?? []) as unknown as RawDeal[];
  type PropRel = { id?: string; title?: string; property_code?: string };
  type CustRel = { id?: string; full_name?: string };

  const deals: BoardDeal[] = rawRows.map((d) => {
    const p = one(d.property as PropRel | PropRel[] | null);
    const c = one(d.customer as CustRel | CustRel[] | null);
    const noteAgg = d.deal_notes as { count?: number }[] | null;
    return {
      id: d.id,
      stage: d.stage,
      deal_type: d.deal_type,
      deal_value: d.deal_value != null ? Number(d.deal_value) : null,
      probability: d.probability != null ? Number(d.probability) : null,
      assigned_to: d.assigned_to ?? null,
      updated_at: d.updated_at,
      property_title: p?.title ?? null,
      property_code: p?.property_code ?? null,
      property_id: p?.id ?? d.property_id,
      customer_name: c?.full_name ?? null,
      customer_id: c?.id ?? d.customer_id,
      note_count: Number(noteAgg?.[0]?.count ?? 0),
      checklist_done: checklistByDeal.get(d.id)?.done ?? 0,
      checklist_total: checklistByDeal.get(d.id)?.total ?? 0,
    };
  });

  // Sayaçlar (head-count; danışman kapsamlı, arama/aşama filtresinden bağımsız)
  const stageCounts: Record<string, number> = {
    new: newRes.count ?? 0,
    qualified: qualifiedRes.count ?? 0,
    negotiation: negotiationRes.count ?? 0,
    won: wonRes.count ?? 0,
    lost: lostRes.count ?? 0,
  };
  const openCount = OPEN_STAGES.reduce((s, k) => s + (stageCounts[k] ?? 0), 0);
  const dealsTotal = openCount + stageCounts.won! + stageCounts.lost!;
  const staleCount = staleRes.count ?? 0;
  const sums = sumDeals(
    ((sumScan.data ?? []) as unknown as Array<{ stage: string; deal_value: number | string | null; probability: number | string | null }>).map((r) => ({
      stage: r.stage,
      deal_value: r.deal_value != null ? Number(r.deal_value) : null,
      probability: r.probability != null ? Number(r.probability) : null,
    })),
    SUM_SCAN_LIMIT,
  );
  const rate = winRate(stageCounts.won!, stageCounts.lost!);

  const kpis: KpiItem[] = [];
  if (sums) {
    kpis.push({ label: "Açık hat", value: moneyKpi(sums.openValue), title: money(sums.openValue), icon: <TrendingUp />, tone: "info", href: hrefWith({ gorunum: "liste", asama: "acik", sayfa: "" }), hint: `${openCount} açık anlaşma` });
    kpis.push({
      label: "Ağırlıklı tahmin",
      value: moneyKpi(sums.weighted),
      title: money(sums.weighted),
      icon: <Target />,
      tone: "info",
      href: `${hrefWith({ gorunum: "", asama: "", sayfa: "" })}#huni`,
      hint: "olasılıkla ağırlıklı açık hat",
    });
    kpis.push({ label: "Kazanılan", value: moneyKpi(sums.wonValue), title: money(sums.wonValue), icon: <Trophy />, tone: "success", href: hrefWith({ gorunum: "liste", asama: "won", sayfa: "" }), hint: `${stageCounts.won} anlaşma` });
  } else {
    kpis.push({ label: "Açık anlaşma", value: openCount, icon: <TrendingUp />, tone: "info", href: hrefWith({ gorunum: "liste", asama: "acik", sayfa: "" }), hint: "kazanılmamış, kaybedilmemiş" });
    kpis.push({ label: "Kazanılan", value: stageCounts.won!, icon: <Trophy />, tone: "success", href: hrefWith({ gorunum: "liste", asama: "won", sayfa: "" }), hint: "anlaşma" });
  }
  if (rate !== null) {
    kpis.push({
      label: "Kazanma oranı",
      value: `%${rate}`,
      icon: <Percent />,
      tone: rate >= 50 ? "success" : "warning",
      href: hrefWith({ gorunum: "liste", asama: "won", sayfa: "" }),
      hint: "kazanılan / sonuçlanan",
    });
  }
  kpis.push({
    label: `${STALE_DAYS}+ gün hareketsiz`,
    value: staleCount,
    icon: <AlarmClock />,
    tone: "warning",
    href: hrefWith({ gorunum: "liste", bayat: "1", asama: "", sayfa: "" }),
    attention: true,
    hint: "açık anlaşma",
  });

  const viewOptions: ViewOption[] = [
    { value: "pano", label: "Pano", icon: KanbanSquare, href: hrefWith({ gorunum: "", asama: "", sayfa: "" }) },
    { value: "liste", label: "Liste", icon: List, href: hrefWith({ gorunum: "liste", sayfa: "" }) },
  ];

  const chips = buildActiveChips(PATH, urlParams, [
    { key: "q", label: "Arama" },
    {
      key: "asama",
      label: "Aşama",
      format: (v) => (v === "acik" ? "Açık anlaşmalar" : (stageLabels[v as keyof typeof stageLabels]?.label ?? v)),
    },
    { key: "danisman", label: "Danışman", format: (v) => advisorName.get(v) ?? "Seçili danışman" },
    { key: "bayat", label: "Hareket", format: () => `${STALE_DAYS}+ gündür güncellenmedi` },
  ]);

  // ---- Liste görünümü satırları ------------------------------------------------
  const win = pageWindow(page, dealCount ?? rawRows.length, PAGE_SIZE, rawRows.length);
  const viewModels: DealVM[] =
    gorunum === "liste"
      ? deals.map((d) => {
          const days = Math.floor(msSince(d.updated_at) / 86_400_000);
          const open = d.stage !== "won" && d.stage !== "lost";
          return {
            id: d.id,
            href: `${PATH}/${d.id}`,
            propertyId: d.property_id,
            propertyLabel: d.property_title ?? d.property_code,
            customerId: d.customer_id,
            customerName: d.customer_name,
            stageLabel: stageLabels[d.stage as keyof typeof stageLabels]?.label ?? d.stage,
            stageTone: dealStageTone(d.stage),
            value: d.deal_value != null ? money(d.deal_value) : null,
            probability: d.probability,
            advisor: d.assigned_to ? (advisorName.get(d.assigned_to) ?? null) : null,
            updatedLabel: updatedAgoLabel(days),
            stale: open && days >= STALE_DAYS,
            checklist: d.checklist_total > 0 ? { done: d.checklist_done, total: d.checklist_total } : null,
            noteCount: d.note_count,
            unit: (() => {
              const raw = rawRows.find((r) => r.id === d.id);
              return raw?.project_unit_id ? (unitById.get(raw.project_unit_id) ?? null) : null;
            })(),
          };
        })
      : [];

  // ---- Pano görünümü: huni + aylık ciro (mevcut yüklenen kartlardan) ------------
  const open = deals.filter((d) => !["won", "lost"].includes(d.stage));
  const won = deals.filter((d) => d.stage === "won");
  const lost = deals.filter((d) => d.stage === "lost");
  const pipelineValue = open.reduce((s, d) => s + (d.deal_value || 0), 0);
  const wonValue = won.reduce((s, d) => s + (d.deal_value || 0), 0);
  const funnel = FUNNEL_STAGES.map((s) => {
    const rows = s.key === "won" ? won : open.filter((d) => d.stage === s.key);
    return { ...s, label: stageLabels[s.key].label, count: rows.length, value: rows.reduce((t, d) => t + (d.deal_value || 0), 0) };
  });
  const funnelMax = Math.max(1, ...funnel.map((f) => f.count));
  const lostValue = lost.reduce((s, d) => s + (d.deal_value || 0), 0);
  const staleOpen = open.filter((d) => msSince(d.updated_at) > STALE_DAYS * 86_400_000).length;

  // Aylık kazanılan ciro (son 6 ay) — updated_at won-tarihi vekili (şemada ayrı kapanış tarihi yok).
  // Ay bucketing saf string matematiğiyle (clock kuralı: bileşende new Date() yok); "YYYY-MM" karşılaştırması.
  const MONTHS_TR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const [curY, curM] = daysAgoIso(0).slice(0, 7).split("-").map(Number); // curM: 1-12
  const wonByMonth = Array.from({ length: 6 }, (_, k) => {
    const i = 5 - k; // 5 ay önce → bu ay
    let idx = curM - 1 - i;
    let y = curY;
    while (idx < 0) {
      idx += 12;
      y -= 1;
    }
    return { key: `${y}-${String(idx + 1).padStart(2, "0")}`, label: MONTHS_TR[idx], value: 0 };
  });
  for (const w of won) {
    if (!w.updated_at) continue;
    const b = wonByMonth.find((x) => x.key === String(w.updated_at).slice(0, 7));
    if (b) b.value += w.deal_value || 0;
  }
  const wonTrendTotal = wonByMonth.reduce((s, m) => s + m.value, 0);

  const chipParams = { ...urlParams, gorunum: "liste" };
  // Grafik bağlantıları danışman süzgecini taşır (yalnız ofis geneli kapsamda anlamlı; diğerinde kapsam zaten kişinin kendisi).
  const dq = officeWide && danismanF ? `&danisman=${danismanF}` : "";

  return (
    <ListPage>
      <ReferralNudge moment="first_deal" show={(realWonRes.count ?? 0) >= 1} />
      <ListHero
        title="Anlaşma tahtası"
        eyebrow="Anlaşma hattı"
        art="anlasma"
        meta={<ScopeBadge text={listScope.badge} />}
        description={`${stageLabels.new.label} → ${stageLabels.qualified.label} → ${stageLabels.negotiation.label} → ${stageLabels.won.label}/${stageLabels.lost.label}. Kazanıldığında komisyon otomatik üretilir.`}
        actions={
          <>
            {canCreate ? <ButtonLink href="/app/anlasmalar/yeni" icon={Plus}>Yeni anlaşma</ButtonLink> : null}
          </>
        }
      />

      {dealsTotal === 0 && !danismanF ? (
        <EmptyState
          icon={Handshake}
          illustration="teklif"
          title="Satış hattı boş"
          description="İlk anlaşmayı ekleyin veya portföyden “Anlaşma + komisyon” ile kazanan işlem açın."
          tone="mint"
          action={canCreate ? { href: "/app/anlasmalar/yeni", label: "Yeni anlaşma" } : undefined}
          secondary={{ href: "/app/portfoyler", label: "Portföye git" }}
        />
      ) : (
        <>
          <KpiStrip items={kpis} />

          {/* Liste görünümünde aşama hunisi + sonuç dağılımı (gerçek sayımlar). Pano görünümünün kendi hunisi var (#huni). */}
          {gorunum === "liste" ? (
            <ListCharts>
              <FunnelCard
                title="Aşama hunisi"
                subtitle="Her aşamadaki anlaşma sayısı"
                icon={Filter}
                href={hrefWith({ gorunum: "liste", asama: "acik", sayfa: "" })}
                stages={FUNNEL_STAGES.map((s) => ({
                  label: stageLabels[s.key].label,
                  value: stageCounts[s.key] ?? 0,
                  href: `${PATH}?gorunum=liste&asama=${s.key}${dq}`,
                }))}
              />
              <DistributionCard
                title="Sonuç dağılımı"
                subtitle="Açık, kazanılan ve kaybedilen"
                icon={PieChart}
                tone="success"
                href={`${PATH}?gorunum=liste${dq}`}
                centerLabel="anlaşma"
                slices={[
                  { label: "Açık", value: openCount, color: "var(--viz-1)", href: `${PATH}?gorunum=liste&asama=acik${dq}` },
                  { label: stageLabels.won.label, value: stageCounts.won ?? 0, tone: "success", href: `${PATH}?gorunum=liste&asama=won${dq}` },
                  { label: stageLabels.lost.label, value: stageCounts.lost ?? 0, tone: "danger", href: `${PATH}?gorunum=liste&asama=lost${dq}` },
                ]}
              />
            </ListCharts>
          ) : null}

          <ListToolbar
            pathname={PATH}
            params={urlParams}
            views={viewOptions}
            activeView={gorunum}
            searchPlaceholder="Portföy veya müşteri ara…"
            searchLabel="Anlaşma ara"
            panelParamKeys={["danisman", "bayat"]}
            panel={
              <FilterGrid>
                {officeWide && advisors.length > 0 ? (
                  <FilterSelect
                    name="danisman"
                    label="Danışman"
                    value={danismanF}
                    options={[{ value: "", label: "Tüm danışmanlar" }, ...advisors.map((a) => ({ value: a.id, label: a.name }))]}
                  />
                ) : null}
                <FilterSelect
                  name="bayat"
                  label="Hareket"
                  value={bayatF ? "1" : ""}
                  options={[
                    { value: "", label: "Tümü" },
                    { value: "1", label: `${STALE_DAYS}+ gündür güncellenmedi` },
                  ]}
                />
              </FilterGrid>
            }
            densityParam={gorunum === "liste" ? "yogunluk" : undefined}
            chips={chips}
            resultCount={chips.length > 0 ? (dealCount ?? rawRows.length) : undefined}
            savedViews={<SavedViews route={PATH} views={savedViews} currentParams={savedViewParams} />}
          />
          <CustomFieldFilterBar path={PATH} params={urlParams} state={customFilter} />

          {/* Aşama çipleri: pano görünümünde tıklayınca liste görünümüne iner (sunucu filtresi ?asama=) */}
          <CategoryChips
            options={DEAL_STAGE_KEYS.map((k) => ({ value: k, label: stageLabels[k].label }))}
            counts={stageCounts}
            total={dealsTotal}
            active={gorunum === "liste" ? asamaF : ""}
            pathname={PATH}
            params={gorunum === "liste" ? urlParams : chipParams}
            paramName="asama"
            label="Anlaşma aşaması"
          />

          {gorunum === "liste" ? (
            <>
              {viewModels.length === 0 ? (
                <EmptyState
                  icon={Search}
                  illustration="search"
                  title="Eşleşen anlaşma bulunamadı"
                  description="Arama ifadenizi ya da filtreleri değiştirip tekrar deneyin."
                  action={{ href: `${PATH}?gorunum=liste`, label: "Filtreleri temizle" }}
                />
              ) : (
                <BulkSelectionProvider>
                  {canEdit ? (
                    <DealBulkBar
                      stages={OPEN_STAGES.map((k) => ({ value: k, label: stageLabels[k].label }))}
                      members={advisors}
                      canAssign={officeWide}
                    />
                  ) : null}
                  <DealTable rows={viewModels} density={density} selectable={canEdit} />
                </BulkSelectionProvider>
              )}
              <ListPager pathname={PATH} params={urlParams} window={win} total={dealCount ?? rawRows.length} />
            </>
          ) : deals.length === 0 ? (
            <EmptyState
              icon={Search}
              illustration="search"
              title="Eşleşen anlaşma bulunamadı"
              description="Arama ifadenizi ya da filtreleri değiştirip tekrar deneyin."
              action={{ href: PATH, label: "Filtreleri temizle" }}
            />
          ) : (
            <>
              {/* Satış hunisi — mevcut dağılım + aşamalar arası oran; satırlar sütuna iner */}
              <section id="huni" className="grid scroll-mt-24 gap-4 lg:grid-cols-[1.6fr_1fr]">
                <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-display text-sm font-extrabold uppercase tracking-[0.08em] text-ink-950">Satış hunisi</h2>
                    <span className="text-xs text-text-faint">Aşamadaki kart sayısına göre</span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {funnel.map((f, i) => {
                      const nextF = funnel[i + 1];
                      const conv = nextF && f.count > 0 ? Math.round((nextF.count / f.count) * 100) : null;
                      return (
                        <div key={f.key}>
                          <Link
                            href={`#sutun-${f.key}`}
                            className="focus-ring group block rounded-[var(--radius-card)] px-1 py-0.5 transition hover:bg-canvas"
                          >
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className={`font-bold ${f.text}`}>{f.label}</span>
                              <span className="numeric text-text-muted">
                                <span className="font-extrabold text-ink-950">{f.count}</span> kart · {money(f.value)}
                                <ArrowUpRight className="ml-1 inline h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                              </span>
                            </div>
                            <div className="mt-1.5 h-3 overflow-hidden rounded-[var(--radius-control)] bg-canvas">
                              <div
                                className={`h-full rounded-[var(--radius-control)] ${f.bar} transition-all`}
                                style={{ width: `${Math.max(f.count > 0 ? 4 : 0, Math.round((f.count / funnelMax) * 100))}%` }}
                              />
                            </div>
                          </Link>
                          {conv != null && f.key !== "won" ? (
                            <p className="mt-0.5 pl-1 text-xs text-text-faint">↓ sonraki aşamaya oran %{conv}</p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  {lost.length > 0 ? (
                    <Link
                      href="#sutun-lost"
                      className="focus-ring mt-4 flex items-center justify-between rounded-[var(--radius-card)] border border-danger-500/15 bg-danger-500/5 px-3 py-2 text-xs transition hover:border-danger-500/30"
                    >
                      <span className="font-semibold text-danger-500">Kaybedilen</span>
                      <span className="numeric text-text-muted">
                        <span className="font-extrabold text-ink-950">{lost.length}</span> kart · {money(lostValue)}
                      </span>
                    </Link>
                  ) : null}
                </div>

                {/* Aşama bazlı toplam değer şeridi + hat sağlığı */}
                <div className="flex flex-col gap-4">
                  <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
                    <h2 className="font-display text-sm font-extrabold uppercase tracking-[0.08em] text-ink-950">Aşama bazlı değer</h2>
                    {pipelineValue + wonValue > 0 ? (
                      <>
                        <div className="mt-4 flex h-4 gap-0.5 overflow-hidden rounded-[var(--radius-control)]">
                          {funnel
                            .filter((f) => f.value > 0)
                            .map((f) => (
                              <Link
                                key={f.key}
                                href={`#sutun-${f.key}`}
                                title={`${f.label}: ${money(f.value)}`}
                                className={`${f.bar} focus-ring block h-full transition hover:opacity-80`}
                                style={{ width: `${Math.max(3, Math.round((f.value / (pipelineValue + wonValue)) * 100))}%` }}
                                aria-label={`${f.label} sütununa git — ${money(f.value)}`}
                              />
                            ))}
                        </div>
                        <ul className="mt-3 space-y-1.5">
                          {funnel.map((f) => (
                            <li key={f.key} className="flex items-center gap-2 text-xs">
                              <span className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${f.bar}`} aria-hidden />
                              <span className="text-text-muted">{f.label}</span>
                              <Link href={`#sutun-${f.key}`} className="numeric focus-ring ml-auto rounded-[var(--radius-control)] font-bold text-ink-950 hover:text-brand-600 hover:underline">
                                {money(f.value)}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="mt-3 text-xs text-text-muted">Kartlara anlaşma değeri girildiğinde dağılım burada görünür.</p>
                    )}
                  </div>

                  {staleOpen > 0 ? (
                    <Link
                      href={hrefWith({ gorunum: "liste", bayat: "1", asama: "", sayfa: "" })}
                      className="focus-ring press flex items-start gap-3 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 p-4 transition hover:border-amber-400/70"
                    >
                      <AlarmClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <span className="text-xs text-text-muted">
                        <span className="font-bold text-amber-600">{staleOpen} açık anlaşma</span> {STALE_DAYS}+ gündür güncellenmedi — listede bayat kartları öne alın.
                      </span>
                    </Link>
                  ) : null}
                </div>
              </section>

              {wonTrendTotal > 0 ? (
                <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h2 className="font-display text-sm font-extrabold uppercase tracking-[0.08em] text-ink-950">Aylık kazanılan ciro</h2>
                      <p className="mt-0.5 text-xs text-text-faint">Son 6 ay · kapanan anlaşma değeri</p>
                    </div>
                    <p className="numeric font-display text-xl font-extrabold tabular-nums text-mint-600">
                      <MoneyValue amount={wonTrendTotal} symbol="suffix" />
                    </p>
                  </div>
                  <InteractiveChart
                    data={wonByMonth.map((m) => ({ label: m.label, value: m.value }))}
                    color="var(--mint-500)"
                    name="Kazanılan"
                    format="money"
                    height={180}
                    className="mt-4"
                  />
                </section>
              ) : null}

              <div className="flex items-center gap-2 text-xs font-semibold text-text-muted">
                <Filter className="h-3.5 w-3.5 shrink-0" />
                {canEdit
                  ? "Tahta: kartı sürükleyin, tutamaçta klavyeyle taşıyın veya aşama düğmelerini kullanın"
                  : "Tahta: aşama düğmelerini kullanın"}
              </div>
              <ListLimitNotice
                shown={deals.length}
                total={dealCount}
                hint="Kapanan anlaşmaları raporlardan inceleyin ya da liste görünümünü kullanın."
                href="/app/raporlar"
                hrefLabel="Raporlar"
              />
              <DealBoard
                deals={deals}
                canEdit={canEdit}
                members={members ?? []}
                stageLabels={stageLabels}
              />
            </>
          )}
        </>
      )}
    </ListPage>
  );
}
