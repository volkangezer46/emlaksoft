import { Suspense } from "react";
import { AlarmClock, Crosshair, Flame, PieChart, Plus, Search, Sparkles, Target, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { batchAll } from "@/lib/supabase/query-batch";
import { getProvince } from "@/lib/geo/reader";
import { requireModulePage } from "@/lib/require-module-page";
import { daysAgoIso, msSince, now } from "@/lib/clock";
import {
  fetchTenantMatchingWeights,
  scoreDemandProperty,
  type MatchDemand,
  type MatchProperty,
} from "@/lib/matching";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton, SkeletonBlock } from "@/components/ui/skeleton";
import { ColumnChartCard, DistributionCard, ListCharts, ListHero, ListPage } from "@/components/ui/list-page";
import { weekBucketsOf } from "@/lib/ui/list-charts";
import { EmptyState } from "@/components/ui/empty-state";
import { listSavedViews } from "@/app/actions/saved-views";
import { SavedViews } from "@/components/app/saved-views";
import { applyCustomFieldIds, customFilterRaw, customFilterValue, resolveCustomFieldFilter } from "@/lib/custom-fields/filter";
import { CustomFieldFilterBar } from "@/components/app/custom-field-filter-bar";
import { relatedSearchClause } from "@/lib/list-search";
import { buildHref } from "@/lib/ui/filter-params";
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
  isoDateParam,
  uuidParam,
  weeklySeriesOf,
  type Density,
  type KpiItem,
} from "@/components/ui/list-kit";
import { getSetting } from "@/lib/settings/read";
import { applyScopeFilter, getListScope, isNarrowing } from "@/lib/access-control";
import { ScopeBadge } from "@/components/app/scope-badge";
import { DemandTable, type DemandVM } from "./demand-rows";
import { DemandBulkBar, DemandBulkProvider } from "./demand-bulk";
import {
  AGING_DAYS as DEFAULT_AGING_DAYS,
  BUDGET_BANDS,
  DEMAND_STATUS_LABELS,
  URGENCY_LABELS,
  budgetLabel,
  budgetOrFilter,
  demandAgeLabel,
  demandStatusTone,
  parseUrgencyParam,
  tallyPool,
  urgencyTone,
  type BandKey,
  type PoolRow,
} from "./demand-list-logic";

const PATH = "/app/talepler";
/** ?eklenen= pencereleri (gün) — ana ekran dönem seçiciyle aynı (7|30|90); 1 = ana ekran "Dünden beri" (son 24 saat). */
const ADDED_WINDOWS = [1, 7, 30, 90] as const;
const addedLabel = (d: number | string) => (String(d) === "1" ? "son 24 saat" : `son ${d} gün`);

type Rel = { id?: string; full_name?: string; name?: string; assigned_to?: string | null } | { id?: string; full_name?: string; name?: string; assigned_to?: string | null }[] | null;

type DemandRow = {
  id: string;
  transaction_type: string;
  property_type: string | null;
  budget_min: number | null;
  budget_max: number | null;
  rooms: string | null;
  min_sqm: number | null;
  urgency: string | null;
  status: string;
  created_at: string;
  province_id: string | null;
  district_id: string | null;
  customer: Rel;
  province: Rel;
};

function relOne<T extends { full_name?: string; name?: string; id?: string; assigned_to?: string | null }>(value: Rel): T | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) as T;
}

/** Sayfa başına kayıt — gerçek sayfalama. */
const PAGE_SIZE = 50;

/**
 * Segment çipleri (bütçe bantları + en yoğun iller) havuz sınırı: bantlar TS'te türetildiğinden
 * sayılar filtrelenmiş listenin ilk POOL_LIMIT kaydından hesaplanır. Havuz tavana dayanırsa
 * sayılar GİZLENİR (yaklaşık sayı gösterilmez); liste FİLTRESİ ise her zaman sunucuda doğru çalışır.
 */
const POOL_LIMIT = 500;
const SERIES_SCAN_LIMIT = 2000;
const OPEN_STATUSES = ["new", "active", "matched"];

type Matches = Map<string, { strong: number; good: number; best: number }>;

type Pending = {
  /** Sayfa dilimi + gerçek toplam + eşleşme potansiyeli (liste, portföy havuzu ve ofis ağırlıklarından türer). */
  listP: Promise<{ rows: DemandRow[]; total: number; matchByDemand: Matches }>;
  poolP: Promise<PoolRow[]>;
};

export async function DemandsView({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    aciliyet?: string;
    yas?: string;
    eklenen?: string;
    from?: string;
    to?: string;
    il?: string;
    butce?: string;
    danisman?: string;
    sayfa?: string;
    yogunluk?: string;
  }>;
}) {
  const { perms, tenantId, userId, role } = await requireModulePage("demands");
  // Ofis Tanımları Merkezi: bekleyen talep eşiği (ayar yoksa kod varsayılanı 30 gün).
  const AGING_DAYS = tenantId ? await getSetting<number>("office.alert.demand_aging_days", { tenantId }) : DEFAULT_AGING_DAYS;
  // Kullanıcı kapsamı (ofis bayrağı açıksa): talep sahipliği müşteri üzerinden (customers.assigned_to), yalnız daraltır.
  const listScope = await getListScope({ userId, tenantId, role });
  const canCreate = (perms.demands ?? []).includes("create");
  const canEdit = (perms.demands ?? []).includes("edit");
  const canDelete = (perms.demands ?? []).includes("delete");
  const sp = await searchParams;
  const supabase = await createClient();
  const savedViewsPromise = listSavedViews(PATH);

  // ?aciliyet= virgülle birden çok değer alır (örn. "Acil / yüksek" KPI'sı high,urgent gönderir).
  const aciliyetValues = parseUrgencyParam(sp.aciliyet);
  const aciliyetF = aciliyetValues.join(",");
  // Liste-kesen kullanıcı filtreleri: ?il= (province_id, doğrulanmış uuid) ?butce= ?yas= ?danisman= — hepsi sunucuda.
  const ilF = uuidParam(sp.il);
  const butceF: BandKey | "" = BUDGET_BANDS.some((b) => b.key === sp.butce) ? (sp.butce as BandKey) : "";
  const yasF = sp.yas === String(AGING_DAYS);
  // ?eklenen=7|30|90: son N günde açılan talepler (ana ekran "Yeni talep · N gün" KPI'sı buraya iner; sayımla aynı koşul).
  const eklenenF = ADDED_WINDOWS.find((d) => String(d) === sp.eklenen) ?? null;
  // Talepte danışman sütunu yok: danışman = talep sahibi müşterinin atandığı kişi (customers.assigned_to).
  const danismanF = uuidParam(sp.danisman);
  // ?from=&to= (YYYY-MM-DD, UTC gün sınırı): "Yeni talep" haftalık grafiğinin sütunları buraya iner (sayımla aynı koşul).
  const fromF = isoDateParam(sp.from);
  const toF = isoDateParam(sp.to);
  const q = (sp.q ?? "").trim().slice(0, 80);
  const statusF = sp.status === "all" || (sp.status && DEMAND_STATUS_LABELS[sp.status]) ? sp.status : "";
  const density = densityOf(sp.yogunluk);
  const page = parsePage(sp.sayfa);
  const offset = (page - 1) * PAGE_SIZE;

  // Doğrulanmış URL durumu — toolbar, çipler, sayfalama ve kayıtlı görünümler TEK kaynaktan beslenir.
  const urlParams: Record<string, string> = {};
  if (q) urlParams.q = q;
  if (statusF) urlParams.status = statusF;
  if (aciliyetF) urlParams.aciliyet = aciliyetF;
  if (ilF) urlParams.il = ilF;
  if (butceF) urlParams.butce = butceF;
  if (yasF) urlParams.yas = String(AGING_DAYS);
  if (eklenenF) urlParams.eklenen = String(eklenenF);
  if (danismanF) urlParams.danisman = danismanF;
  if (fromF) urlParams.from = fromF;
  if (toF) urlParams.to = toF;
  if (density === "kompakt") urlParams.yogunluk = "kompakt";
  // Özel alan filtresi (?ozel=anahtar:değer): liste sorgusuna eşleşen kimliklerle iner.
  const customFilter = await resolveCustomFieldFilter(supabase, tenantId, "demand", customFilterRaw(sp as Record<string, string | undefined>));
  if (customFilter.active) urlParams.ozel = customFilterValue(customFilter.active.def.key, customFilter.active.value);
  const hrefWith = (patch: Record<string, string>) => buildHref(PATH, mergeResetPage(urlParams, patch));
  const savedViewParams = Object.fromEntries(Object.entries(urlParams).filter(([k]) => k !== "yogunluk"));

  const search = await relatedSearchClause(supabase, q, {
    customerColumn: "customer_id",
    extraColumns: ["property_type", "rooms"],
  });

  // Danışman filtresi / kullanıcı kapsamı müşteri üzerinden: inner gömme + embed alanı filtresi (FK adıyla).
  const CUSTOMER_FK = "customers!customer_demands_customer_id_fkey";
  const needCustomerInner = Boolean(danismanF) || isNarrowing(listScope.filter);
  const scopeEmbed = needCustomerInner ? `, customer:${CUSTOMER_FK}!inner(id)` : "";
  const listCustomerEmbed = needCustomerInner
    ? `customer:${CUSTOMER_FK}!inner(id, full_name, assigned_to)`
    : `customer:${CUSTOMER_FK}(id, full_name, assigned_to)`;

  const LIST_COLS = `id, transaction_type, property_type, budget_min, budget_max, rooms, min_sqm, urgency, status, created_at, province_id, district_id, ${listCustomerEmbed}, province:geo_provinces(name)`;

  /** Danışman kapsamı + (isteğe bağlı) durum/aciliyet filtreleriyle temel sorgu. */
  const buildBase = (select: string, opts?: { count: "exact"; head?: boolean }, useUserFilters = true) => {
    let query = supabase.from("customer_demands").select(select, opts);
    if (danismanF) query = query.eq("customer.assigned_to", danismanF);
    query = applyScopeFilter(query, listScope.filter, { ownerColumn: "customer.assigned_to" });
    if (useUserFilters) {
      if (statusF && statusF !== "all") query = query.eq("status", statusF);
      else if (!statusF) query = query.in("status", OPEN_STATUSES);
      if (aciliyetValues.length > 0) query = query.in("urgency", aciliyetValues);
    }
    return query;
  };
  /** Kullanıcı filtresi OLMAYAN, yalnız danışman kapsamlı sayaç sorgusu. */
  const scopeHead = () => buildBase(`id${scopeEmbed}`, { count: "exact", head: true }, false);

  const buildList = (select: string, opts?: { count: "exact"; head?: boolean }) => {
    let query = buildBase(select, opts);
    if (ilF) query = query.eq("province_id", ilF);
    if (butceF) query = query.or(budgetOrFilter(butceF));
    // Yaşlanan: 30+ gündür açık; kapalılar sayılmaz.
    if (yasF) query = query.lte("created_at", daysAgoIso(AGING_DAYS)).neq("status", "closed");
    if (eklenenF) query = query.gte("created_at", daysAgoIso(eklenenF));
    if (fromF) query = query.gte("created_at", fromF);
    if (toF) query = query.lte("created_at", `${toF}T23:59:59.999`);
    if (search.clause) query = query.or(search.clause);
    query = applyCustomFieldIds(query, customFilter.ids);
    return query;
  };

  const listQuery = buildList(LIST_COLS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  // Ağır bölümler (liste + eşleşme skorları, segment havuzu) kendi Suspense sınırında bekler.
  const propsP = Promise.resolve(
    supabase
      .from("properties")
      .select("id, property_code, title, transaction_type, property_type, status, list_price, province_id, district_id, features")
      .is("deleted_at", null)
      .in("status", ["live", "draft", "reserved", "Yayında"])
      .order("created_at", { ascending: false })
      .limit(300),
  );
  const weightsP = fetchTenantMatchingWeights(supabase);
  const rawListP = search.empty ? Promise.resolve({ data: [], count: 0 }) : Promise.resolve(listQuery);

  const pending: Pending = {
    listP: batchAll("Talepler", ["demands", "properties", "matching-weights"], [rawListP, propsP, weightsP]).then(([{ data, count }, { data: propsData }, weights]) => {
      const rows = (data ?? []) as unknown as DemandRow[];
      const matchProps = (propsData ?? []).map((p) => ({
        ...p,
        list_price: p.list_price != null ? Number(p.list_price) : null,
        features: (p.features ?? {}) as MatchProperty["features"],
      })) as MatchProperty[];
      const matchByDemand: Matches = new Map();
      for (const d of rows) {
        if (d.status === "closed") continue;
        let strong = 0;
        let good = 0;
        let best = 0;
        for (const p of matchProps) {
          const res = scoreDemandProperty(d as unknown as MatchDemand, p, weights);
          if (res.score > best) best = res.score;
          if (res.score >= 75) strong += 1;
          else if (res.score >= 55) good += 1;
        }
        matchByDemand.set(d.id, { strong, good, best });
      }
      return { rows, total: count ?? rows.length, matchByDemand };
    }),
    poolP: Promise.resolve(
      buildBase(`id, status, budget_min, budget_max, province_id, province:geo_provinces(name)${scopeEmbed}`).limit(POOL_LIMIT),
    ).then((res) => {
      if (res.error) throw new Error(`Talepler verileri eksik yüklendi (demand-pool:${res.error.code ?? "?"}).`);
      return res;
    }).then((res) =>
      ((res.data ?? []) as unknown as Array<{
        status: string;
        budget_min: number | null;
        budget_max: number | null;
        province_id: string | null;
        province: Rel;
      }>).map((r) => ({
        status: r.status,
        budget_min: r.budget_min,
        budget_max: r.budget_max,
        province_id: r.province_id,
        provinceName: relOne<{ name: string }>(r.province)?.name ?? null,
      })),
    ),
  };

  // ── Hızlı (head-count) veriler: KPI + çip sayaçları + araç çubuğu ───────────────
  const nowMs = now();
  const [
    advisorsRes,
    savedViews,
    newRes,
    activeRes,
    matchedRes,
    closedRes,
    urgentRes,
    highRes,
    agingRes,
    seriesRes,
    ilRes,
  ] = await batchAll("Talepler", [
    "profiles", "saved-views", "count-new", "count-active", "count-matched", "count-closed",
    "count-urgent", "count-high", "count-aging", "series", "province",
  ], [
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    savedViewsPromise,
    scopeHead().eq("status", "new"),
    scopeHead().eq("status", "active"),
    scopeHead().eq("status", "matched"),
    scopeHead().eq("status", "closed"),
    scopeHead().in("status", OPEN_STATUSES).eq("urgency", "urgent"),
    scopeHead().in("status", OPEN_STATUSES).eq("urgency", "high"),
    scopeHead().in("status", OPEN_STATUSES).lte("created_at", daysAgoIso(AGING_DAYS)),
    buildBase(`created_at${scopeEmbed}`, undefined, false).gte("created_at", daysAgoIso(56)).limit(SERIES_SCAN_LIMIT),
    ilF ? getProvince(ilF).then((p) => ({ data: p ? { name: p.name } : null })) : Promise.resolve({ data: null }),
  ]);

  const advisors = (advisorsRes.data ?? []).map((a) => ({ id: String(a.id), name: String(a.full_name ?? "") }));
  const advisorName = new Map(advisors.map((a) => [a.id, a.name]));
  const statusCounts: Record<string, number> = {
    new: newRes.count ?? 0,
    active: activeRes.count ?? 0,
    matched: matchedRes.count ?? 0,
    closed: closedRes.count ?? 0,
  };
  const openTotal = statusCounts.new! + statusCounts.active! + statusCounts.matched!;
  const allTotal = openTotal + statusCounts.closed!;
  const urgentCounts: Record<string, number> = { urgent: urgentRes.count ?? 0, high: highRes.count ?? 0 };
  const urgentTotal = urgentCounts.urgent! + urgentCounts.high!;
  const agingCount = agingRes.count ?? 0;
  const seriesIsos = ((seriesRes.data ?? []) as unknown as Array<{ created_at: string }>).map((r) => r.created_at);
  const weekly = weeklySeriesOf(seriesIsos, nowMs, SERIES_SCAN_LIMIT);
  // Grafik kovaları: PostgREST tavanı (1000) ile SERIES_SCAN_LIMIT'ten küçüğüne göre kesilme denetlenir (kesildiyse grafik yok).
  const weekBars = weekBucketsOf(seriesIsos, nowMs, Math.min(1000, SERIES_SCAN_LIMIT));
  const danismanQ = danismanF ? `&danisman=${danismanF}` : "";
  const ilName = (ilRes.data as { name?: string } | null)?.name ?? null;

  const kpis: KpiItem[] = [
    {
      label: "Açık talepler",
      value: openTotal,
      icon: <Target />,
      tone: "info",
      href: hrefWith({ status: "", aciliyet: "", yas: "", il: "", butce: "", q: "" }),
      series: weekly,
      showTrend: true,
      seriesLabel: "haftalık yeni talep",
      hint: "yeni + aktif + eşleşti",
    },
    {
      // Karar KPI'sı: henüz dokunulmamış (eşleşme/arama yapılmamış) talepler — ilk aranacaklar.
      label: "Yeni",
      value: statusCounts.new!,
      icon: <Sparkles />,
      tone: "info",
      href: hrefWith({ status: "new", aciliyet: "", yas: "" }),
      hint: "henüz işlenmedi",
    },
    {
      label: "Acil / yüksek",
      value: urgentTotal,
      icon: <Flame />,
      tone: "warning",
      href: hrefWith({ status: "", aciliyet: "high,urgent", yas: "" }),
      hint: "öncelikli açık talep",
    },
    {
      label: `${AGING_DAYS}+ gündür açık`,
      value: agingCount,
      icon: <AlarmClock />,
      tone: "danger",
      href: hrefWith({ status: "", yas: String(AGING_DAYS) }),
      attention: true,
      hint: "müşteri soğuyor",
    },
    {
      label: "Eşleşti",
      value: statusCounts.matched!,
      icon: <Sparkles />,
      tone: "success",
      href: hrefWith({ status: "matched", yas: "" }),
      hint: "portföy eşleşmiş talep",
    },
  ];

  const chips = buildActiveChips(PATH, urlParams, [
    { key: "q", label: "Arama" },
    { key: "status", label: "Durum", format: (v) => (v === "all" ? "Kapalılar dahil" : (DEMAND_STATUS_LABELS[v] ?? v)) },
    {
      key: "aciliyet",
      label: "Aciliyet",
      format: (v) => v.split(",").map((x) => URGENCY_LABELS[x] ?? x).join(" + "),
    },
    { key: "il", label: "İl", format: () => ilName ?? "Seçili il" },
    { key: "butce", label: "Bütçe", format: (v) => BUDGET_BANDS.find((b) => b.key === v)?.label ?? v },
    { key: "yas", label: "Açık süre", format: (v) => `${v}+ gün` },
    { key: "eklenen", label: "Eklenme", format: (v) => addedLabel(v) },
    { key: "from", label: "Başlangıç" },
    { key: "to", label: "Bitiş" },
    { key: "danisman", label: "Danışman", format: (v) => advisorName.get(v) ?? "Seçili danışman" },
  ]);

  const statusOptions = [
    ...Object.entries(DEMAND_STATUS_LABELS).map(([value, label]) => ({ value, label })),
    { value: "all", label: "Kapalılar dahil" },
  ];

  return (
    <ListPage>
      <ListHero
        eyebrow="Talep yönetimi"
        art="talep"
        title="Talepler"
        description="Açık talepleri yönetin, bütçe ve konum kriterlerini eşleştirme motoruna bağlayın."
        meta={<ScopeBadge text={listScope.badge} />}
        actions={
          <>
            <ButtonLink href="/app/eslestirme" variant="secondary" size="sm" icon={Crosshair}>
              Eşleştirme motoru
            </ButtonLink>
            {canCreate ? <ButtonLink href="/app/talepler/yeni" size="sm" icon={Plus}>Yeni talep</ButtonLink> : null}
          </>
        }
      />

      {allTotal === 0 && !danismanF ? (
        <EmptyState
          icon={Target}
          illustration="talep"
          title="Henüz talep yok"
          description="Müşteri detayından ya da “Yeni talep” ile ilk talebi ekleyin; sistem talebi portföylerinizle otomatik karşılaştırır."
          action={canCreate ? { href: "/app/talepler/yeni", label: "Yeni talep" } : undefined}
          secondary={{ href: "/app/musteriler", label: "Müşterilere git" }}
        />
      ) : (
        <>
          <KpiStrip items={kpis} />

          {/* Durum dağılımı + haftalık yeni talep (gerçek sayımlar; dilim/sütun = filtreli liste) */}
          <ListCharts>
            <DistributionCard
              title="Talep durumu"
              subtitle="Açık ve kapalı talepler"
              icon={PieChart}
              href={`${PATH}?status=all${danismanQ}`}
              centerLabel="talep"
              slices={[
                { label: DEMAND_STATUS_LABELS.new ?? "Yeni", value: statusCounts.new!, color: "var(--viz-1)", href: `${PATH}?status=new${danismanQ}` },
                { label: DEMAND_STATUS_LABELS.active ?? "Aktif", value: statusCounts.active!, tone: "warn", href: `${PATH}?status=active${danismanQ}` },
                { label: DEMAND_STATUS_LABELS.matched ?? "Eşleşti", value: statusCounts.matched!, tone: "success", href: `${PATH}?status=matched${danismanQ}` },
                { label: DEMAND_STATUS_LABELS.closed ?? "Kapalı", value: statusCounts.closed!, tone: "neutral", href: `${PATH}?status=closed${danismanQ}` },
              ]}
            />
            {weekBars ? (
              <ColumnChartCard
                title="Yeni talep"
                subtitle="Son 8 hafta · haftalık açılan talep"
                icon={TrendingUp}
                tone="success"
                barTone="success"
                highlight={weekBars.length - 1}
                href={`${PATH}?status=all&eklenen=90${danismanQ}`}
                bars={weekBars.map((w) => ({ label: w.label, value: w.count, title: `${w.title}: ${w.count}`, href: `${PATH}?status=all&from=${w.from}&to=${w.to}${danismanQ}` }))}
              />
            ) : null}
          </ListCharts>

          <ListToolbar
            pathname={PATH}
            params={urlParams}
            searchPlaceholder="Müşteri, tip veya oda ara…"
            searchLabel="Talep ara"
            panelParamKeys={["danisman", "yas", "eklenen"]}
            panel={
              <FilterGrid>
                {advisors.length > 0 ? (
                  <FilterSelect
                    name="danisman"
                    label="Danışman"
                    value={danismanF}
                    options={[{ value: "", label: "Tüm danışmanlar" }, ...advisors.map((a) => ({ value: a.id, label: a.name }))]}
                  />
                ) : null}
                <FilterSelect
                  name="yas"
                  label="Açık süre"
                  value={yasF ? String(AGING_DAYS) : ""}
                  options={[
                    { value: "", label: "Tümü" },
                    { value: String(AGING_DAYS), label: `${AGING_DAYS}+ gündür açık` },
                  ]}
                />
                <FilterSelect
                  name="eklenen"
                  label="Eklenme"
                  value={eklenenF ? String(eklenenF) : ""}
                  options={[{ value: "", label: "Tümü" }, ...ADDED_WINDOWS.map((d) => ({ value: String(d), label: addedLabel(d).replace(/^s/, "S") }))]}
                />
              </FilterGrid>
            }
            densityParam="yogunluk"
            chips={chips}
            savedViews={<SavedViews route={PATH} views={savedViews} currentParams={savedViewParams} />}
          />
          <CustomFieldFilterBar path={PATH} params={urlParams} state={customFilter} />

          <div className="space-y-2">
            <CategoryChips
              options={statusOptions}
              counts={{ ...statusCounts, all: allTotal }}
              total={openTotal}
              allLabel="Açık talepler"
              active={statusF}
              pathname={PATH}
              params={urlParams}
              paramName="status"
              label="Talep durumu"
            />
            <CategoryChips
              options={["urgent", "high"].map((value) => ({ value, label: URGENCY_LABELS[value]! }))}
              counts={urgentCounts}
              total={openTotal}
              allLabel="Tüm aciliyetler"
              active={aciliyetF}
              pathname={PATH}
              params={urlParams}
              paramName="aciliyet"
              label="Aciliyet"
            />
            <Suspense fallback={<Skeleton className="h-9 w-full rounded-full" />}>
              <SegmentChips pending={pending} urlParams={urlParams} butceF={butceF} ilF={ilF} ilName={ilName} />
            </Suspense>
          </div>

          <Suspense fallback={<ListSkeleton />}>
            <DemandList
              pending={pending}
              urlParams={urlParams}
              density={density}
              page={page}
              advisorName={advisorName}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          </Suspense>
        </>
      )}
    </ListPage>
  );
}

function ListSkeleton() {
  return (
    <SkeletonBlock label="Talepler yükleniyor" className="grid gap-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-[var(--radius-card)]" />
      ))}
    </SkeletonBlock>
  );
}

/** Bütçe bandı + bölge çipleri (sunucu filtresi). Havuz tavana dayanırsa sayılar gizlenir. */
async function SegmentChips({
  pending,
  urlParams,
  butceF,
  ilF,
  ilName,
}: {
  pending: Pending;
  urlParams: Record<string, string>;
  butceF: string;
  ilF: string;
  ilName: string | null;
}) {
  const poolRows = await pending.poolP;
  const { bandCounts, provinces } = tallyPool(poolRows);
  const reliable = poolRows.length < POOL_LIMIT;
  const provOptions = provinces.map((p) => ({ value: p.id, label: p.name }));
  if (ilF && !provOptions.some((o) => o.value === ilF)) provOptions.push({ value: ilF, label: ilName ?? "Seçili il" });
  const provCounts = reliable ? Object.fromEntries(provinces.map((p) => [p.id, p.count])) : null;
  const hasBands = Object.keys(bandCounts).length > 0 || Boolean(butceF);
  if (!hasBands && provOptions.length === 0) return null;
  return (
    <>
      {hasBands ? (
        <CategoryChips
          options={BUDGET_BANDS.map((b) => ({ value: b.key, label: b.label }))}
          counts={reliable ? bandCounts : null}
          total={null}
          allLabel="Tüm bütçeler"
          active={butceF}
          pathname={PATH}
          params={urlParams}
          paramName="butce"
          label="Bütçe bandı"
        />
      ) : null}
      {provOptions.length > 0 ? (
        <CategoryChips
          options={provOptions}
          counts={provCounts ? { ...provCounts, ...(ilF && !(ilF in provCounts) ? { [ilF]: 1 } : {}) } : null}
          total={null}
          allLabel="Tüm iller"
          active={ilF}
          pathname={PATH}
          params={urlParams}
          paramName="il"
          label="Bölge"
        />
      ) : null}
    </>
  );
}

async function DemandList({
  pending,
  urlParams,
  density,
  page,
  advisorName,
  canEdit,
  canDelete,
}: {
  canEdit: boolean;
  canDelete: boolean;
  pending: Pending;
  urlParams: Record<string, string>;
  density: Density;
  page: number;
  advisorName: Map<string, string>;
}) {
  const { rows, total, matchByDemand } = await pending.listP;
  const win = pageWindow(page, total, PAGE_SIZE, rows.length);

  const viewModels: DemandVM[] = rows.map((d) => {
    const customer = relOne<{ id: string; full_name: string; assigned_to?: string | null }>(d.customer);
    const province = relOne<{ name: string }>(d.province);
    const days = Math.floor(msSince(d.created_at) / 86_400_000);
    const criteria: string[] = [];
    if (d.rooms) criteria.push(d.rooms);
    if (d.min_sqm) criteria.push(`≥ ${d.min_sqm} m²`);
    return {
      id: d.id,
      href: `/app/talepler/${d.id}`,
      customerId: customer?.id ?? null,
      customerName: customer?.full_name ?? null,
      kind: `${d.transaction_type}${d.property_type ? ` · ${d.property_type}` : ""}`,
      budget: budgetLabel(d.budget_min, d.budget_max),
      province: province?.name ?? null,
      criteria,
      statusLabel: DEMAND_STATUS_LABELS[d.status] ?? d.status,
      statusTone: demandStatusTone(d.status),
      urgencyLabel: d.urgency ? (URGENCY_LABELS[d.urgency] ?? d.urgency) : null,
      urgencyTone: urgencyTone(d.urgency),
      match: d.status !== "closed" ? (matchByDemand.get(d.id) ?? null) : null,
      ageLabel: demandAgeLabel(days, d.status),
      ageUrgent: d.status !== "closed" && d.urgency === "urgent",
      advisor: customer?.assigned_to ? (advisorName.get(customer.assigned_to) ?? null) : null,
    };
  });

  return (
    <>
      {viewModels.length === 0 ? (
        <EmptyState
          icon={Search}
          illustration="search"
          title="Eşleşen talep bulunamadı"
          description="Arama ifadenizi ya da filtreleri değiştirip tekrar deneyin; yeni talep müşteri detayından da eklenebilir."
          action={{ href: PATH, label: "Filtreleri temizle" }}
          secondary={{ href: "/app/musteriler", label: "Müşterilere git" }}
        />
      ) : (
        <>
          <DemandBulkProvider key={viewModels.map((v) => v.id).join(",")}>
            {canEdit ? <DemandBulkBar canDelete={canDelete} /> : null}
            <DemandTable rows={viewModels} density={density} canBulk={canEdit} />
          </DemandBulkProvider>
        </>
      )}
      <ListPager pathname={PATH} params={urlParams} window={win} total={total} />
    </>
  );
}
