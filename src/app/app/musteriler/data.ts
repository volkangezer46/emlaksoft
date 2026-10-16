/**
 * /app/musteriler veri katmanı (T1: _home/data.ts deseni). Tüm sorgular, sıcaklık/lead skorlama ve
 * satır modelleri burada; page.tsx yalnız parametreleri çözer ve görünümü çizer. Davranış sayfanın
 * önceki hâliyle aynıdır, tek fark: ana sorgu hataları sessizce "kayıt yok" yerine error.tsx
 * sınırına düşer (assertQueryBatchSucceeded) ve lead sinyalleri yalnız görünen satırlar için çekilir.
 */
import { leadChannelLabel } from "@/lib/lead-channel";
import { daysAgoIso, msSince, now } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { formatLeadSource } from "@/lib/lead-sources";
import {
  applyCustomerFilters,
  customerSearchTerm,
  HEAT_POOL_LIMIT,
  HEAT_RPC_CHUNK,
  type CustomerListFilters,
} from "@/lib/customer-list-filters";
import { listSavedViews } from "@/app/actions/saved-views";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { formatTurkishPhone, toTelHref, toWhatsAppLink } from "@/lib/phone";
import { buildCustomerState, computeCustomerHeat, type CustomerState } from "@/lib/customer-state/core";
import { fetchOwnerHistory, fetchUpcomingAppointmentIds } from "@/lib/customer-state/load";
import { isOwnerCustomer } from "@/lib/customer-state/seller";
import { heatBadge, heatTitle, type HeatSegment } from "@/lib/customer-state/heat";
import { assertQueryBatchSucceeded } from "@/lib/supabase/query-batch";
import { fetchLeadSignals, type LeadSignalRow } from "@/lib/lead-signals";
import { getSetting } from "@/lib/settings/read";
import { formatDateTr } from "@/lib/format";
import { applyScopeFilter, type ScopeFilter } from "@/lib/access-control/query-scope";
import { requireActiveTenant } from "@/lib/tenant-guard";
import { toAssignableAdvisors } from "@/lib/team/assignable-roles";
import type { CustomerVM } from "./customer-rows";
import { countCustomerTypes, heatTone, relativeFromDays } from "./customer-list-logic";
import { fetchTenantTags } from "./tenant-tags";
import { applyCustomFieldIds } from "@/lib/custom-fields/filter";
import { weekBucketsOf } from "@/lib/ui/list-charts";

/** Sayfa başına kayıt — gerçek sayfalama, 500'lük dilim yerine. */
export const PAGE_SIZE = 30;

/** Tip çipi sayaçları için taranan azami kayıt; aşılırsa sayaçlar gizlenir (yaklaşık sayı gösterilmez). */
const TYPE_SCAN_LIMIT = 2000;

export const HEAT_SEGMENT_KEYS = ["sicak", "ilgili", "soguk", "uykuda"] as const;

/** Yaklaşan özel gün penceresi (gün). */
export const WINDOW_DAYS = 7;

type CustomerRow = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  customer_types: string[] | null;
  tags: string[] | null;
  source: string | null;
  lead_channel?: string | null;
  notes: string | null;
  blacklist: boolean | null;
  assigned_to: string | null;
  created_at: string;
  birth_date: string | null;
  anniversary_date: string | null;
  anniversary_note: string | null;
  province: { name: string } | { name: string }[] | null;
};

type OccasionRow = {
  id: string;
  full_name: string;
  birth_date: string | null;
  anniversary_date: string | null;
  anniversary_note: string | null;
};

type HeatSignalRow = {
  customer_id: string;
  last_contact: string | null;
  open_demands: number;
  urgent_demands: number;
  portal_likes_30d: number;
  open_offers: number;
  open_deals: number;
};

type HeatPoolRow = { id: string; created_at: string; blacklist: boolean | null };

/** Müşteri listesi ana sorgusunun kolonları — segment diliminde de aynı set çekilir. */
const LIST_COLS =
  "id, full_name, phone, email, customer_types, tags, source, lead_channel, notes, blacklist, assigned_to, created_at, birth_date, anniversary_date, anniversary_note, province:geo_provinces(name)";

/** Liste dışı özet (sayfa Suspense ile akıtır): KPI sayıları, grafikler, özel günler, sıcaklık segmentleri. */
export type CustomersSummary = {
  buyerCount: number;
  ownerCount: number;
  occasions: Occasion[];
  growthTotal: number;
  growthFromDate: string;
  weeklySeries: number[] | undefined;
  weeklyBars: ReturnType<typeof weekBucketsOf>;
  typeCounts: ReturnType<typeof countCustomerTypes> | null;
  segmentCounts: Record<HeatSegment, number>;
  poolLimited: boolean;
};

export type Occasion ={ id: string; name: string; kind: "birthday" | "anniversary"; days: number; note: string | null };

function relativeAdded(iso: string) {
  const days = Math.floor(msSince(iso) / 86_400_000);
  if (days <= 0) return "Bugün eklendi";
  if (days === 1) return "Dün eklendi";
  if (days < 30) return `${days} gün önce eklendi`;
  if (days < 365) return `${Math.floor(days / 30)} ay önce eklendi`;
  return `${Math.floor(days / 365)} yıl önce eklendi`;
}

/** Yıllık tekrar eden bir tarihin (doğum günü/yıldönümü) bugüne kaç gün kaldığını döndürür (0 = bugün). Geçersiz/boş ise null. */
function daysUntilAnnual(iso: string | null): number | null {
  if (!iso) return null;
  const src = new Date(iso);
  if (Number.isNaN(src.getTime())) return null;
  const nowD = new Date(now());
  const today = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate());
  let next = new Date(today.getFullYear(), src.getMonth(), src.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, src.getMonth(), src.getDate());
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}

function provinceName(p: CustomerRow["province"]) {
  if (!p) return "—";
  return Array.isArray(p) ? (p[0]?.name ?? "—") : p.name;
}

export type CustomersDataInput = {
  tenantId: string | null | undefined;
  filters: CustomerListFilters;
  segmentF: HeatSegment | "";
  sortF: string;
  sortKey: "ad" | "tarih";
  sortDir: "asc" | "desc";
  offset: number;
  /** Kullanıcı kapsamı (assigned_to); verilmezse süzgeç yok (eski davranış). Liste + KPI sayıları aynı kapsamla. */
  scopeFilter?: ScopeFilter;
  /** Özel alan filtresi eşleşen kimlikler (`?ozel=`); null = filtre yok. Liste + sıcaklık havuzu aynı kümeyle. */
  customIds?: string[] | null;
};

export async function loadCustomersData(input: CustomersDataInput) {
  const { tenantId, filters, segmentF, sortF, sortKey, sortDir, offset } = input;
  const { q, type: typeF, source: sourceF, etiket: etiketF, from: fromF, to: toF, assigned: assignedF } = filters;
  const scopeFilter: ScopeFilter = input.scopeFilter ?? { kind: "none" };
  const scoped = <Q,>(q: Q): Q => applyScopeFilter(q, scopeFilter, { ownerColumn: "assigned_to" });
  const supabase = await createClient();
  // Bağımsız: sorgularla aynı turda beklenir (aşağıdaki Promise.all).
  const savedViewsPromise = listSavedViews("/app/musteriler");

  // ---- Sunucu tarafı filtreleme -------------------------------------------
  // Ad/telefon/e-posta araması — .or() sözdizimini bozan karakterler ayıklanır.
  // (İl adı araması DB'ye taşınmadı: join'li kolonda ilike desteklenmiyor.)
  const term = customerSearchTerm(q);

  // Aynı filtre seti hem ana listeye hem sıcaklık havuzuna uygulanır.
  const customIds = input.customIds ?? null;
  const buildFilteredQuery = (select: string, opts?: { count: "exact" }) =>
    applyCustomFieldIds(applyCustomerFilters(scoped(supabase.from("customers").select(select, opts).is("deleted_at", null)), filters), customIds);

  // count: "exact" — sayfalama ("X-Y / Toplam Z") gerçek toplamı ister;
  // sayı aynı yanıtta gelir, ek gidiş-dönüş yok.
  // Filtresiz görünümde filtreli toplam = "Toplam kayıt" KPI'ı (totalAll, aynı
  // koşul: deleted_at is null) — listeye ikinci bir COUNT bindirmeye gerek yok.
  const unfilteredList = !typeF && !etiketF && !sourceF && !assignedF && !fromF && !toF && !term && customIds === null;
  let listQuery = buildFilteredQuery(LIST_COLS, unfilteredList ? undefined : { count: "exact" });
  if (sortKey === "ad") {
    listQuery = listQuery
      .order("full_name", { ascending: sortDir === "asc" })
      .order("created_at", { ascending: false });
  } else {
    listQuery = listQuery.order("created_at", { ascending: sortDir === "asc" });
  }

  // ---- Liste-önce akış (hız ilkesi) -----------------------------------------------
  // Liste + görünen satırların ısı/lead/randevu sinyalleri ilk ekranı belirler. KPI/çip sayıları, tip sayaçları,
  // büyüme grafiği, özel günler ve sıcaklık havuzu (2000 satırlık tarama + ısı RPC'si) AYRI bir "özet" sözüdür:
  // sayfa Suspense ile akıtır, liste bunları BEKLEMEZ. Yalnız ?segment süzgeci havuza ihtiyaç duyar (sayfa dilimi havuzdan kesilir).

  // Sıcaklık havuzu — skor girdisi için hafif kolonlar (id + yaş + kara liste);
  // segment sayıları ve ?segment filtresi bu havuzdan hesaplanır.
  let heatPoolQuery = buildFilteredQuery("id, created_at, blacklist");
  if (sortKey === "ad") {
    heatPoolQuery = heatPoolQuery
      .order("full_name", { ascending: sortDir === "asc" })
      .order("created_at", { ascending: false });
  } else {
    heatPoolQuery = heatPoolQuery.order("created_at", { ascending: sortDir === "asc" });
  }

  const eightWeeksAgo = daysAgoIso(56);
  // Ofis tanımı: uykuda eşiği (varsayılan 90 gün = DORMANT_DAYS) — ana sorgularla aynı turda.
  const dormantP = tenantId ? getSetting<number>("office.insight.dormant_days", { tenantId }) : Promise.resolve(undefined);

  /** Isı sinyalleri: kimlikler HEAT_RPC_CHUNK'lık dilimlerle, dilimler paralel (N+1 yok). */
  const heatRpc = async (ids: string[]): Promise<{ data: HeatSignalRow[] | null; error?: unknown }> => {
    if (!tenantId || ids.length === 0) return { data: [] };
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += HEAT_RPC_CHUNK) chunks.push(ids.slice(i, i + HEAT_RPC_CHUNK));
    const results = await Promise.all(
      chunks.map((c) => supabase.rpc("customer_heat_signals", { p_tenant_id: tenantId, p_customer_ids: c })),
    );
    return {
      data: results.flatMap((r) => (r.data as HeatSignalRow[] | null) ?? []),
      error: results.find((r) => r.error)?.error,
    };
  };

  // Segment filtresi aktifken sayfa dilimi havuzdan kesilir; normal range sorgusu boşa çalışmasın diye atlanır.
  const listP = segmentF
    ? Promise.resolve({ data: null, count: null })
    : Promise.resolve(listQuery.range(offset, offset + PAGE_SIZE - 1));
  const poolP = Promise.resolve(heatPoolQuery.limit(HEAT_POOL_LIMIT));
  const poolHeatP = poolP.then((p) => heatRpc(((p.data ?? []) as unknown as HeatPoolRow[]).map((r) => r.id)));
  // Görünen sayfanın ısı sinyalleri: küçük (≤PAGE_SIZE) RPC — 2000'lik havuz RPC'sini beklemez.
  const pageHeatP = segmentF
    ? poolHeatP
    : listP.then((l) => heatRpc(((l.data ?? []) as unknown as CustomerRow[]).map((r) => r.id)));
  // Lead sinyalleri YALNIZ görünen sayfanın id'leri için (eski imza tüm tenant'ı döndürür ve 1000'de kesilirdi).
  // Segment filtresinde satırlar havuzdan kesildiği için sinyaller aşağıda satırlar bilinince çekilir.
  const signalsP = segmentF
    ? Promise.resolve(null)
    : listP.then((l) =>
        fetchLeadSignals(supabase, tenantId, ((l.data ?? []) as unknown as CustomerRow[]).map((c) => c.id)),
      );
  // Yaklaşan randevu + mülk sahibi geçmişi de satırlar bilinir bilinmez başlar (eskiden ısı RPC'sinden SONRA ardışıktı).
  const extrasP = segmentF
    ? Promise.resolve(null)
    : listP.then((l) => {
        const pageRows = (l.data ?? []) as unknown as CustomerRow[];
        return Promise.all([
          fetchUpcomingAppointmentIds(supabase, pageRows.map((c) => c.id), daysAgoIso(0)),
          fetchOwnerHistory(supabase, pageRows.filter((c) => isOwnerCustomer(c.customer_types)).map((c) => c.id)),
        ]);
      });

  // ---- Özet (akışla gelir): KPI sayıları, grafikler, özel günler, sıcaklık segmentleri ----------
  const summary: Promise<CustomersSummary> = (async () => {
    const [poolRes, poolHeat, dormantDays, buyerRes, ownerRes, occasionRes, growthRes, typeScanRes] = await Promise.all([
      poolP,
      poolHeatP,
      dormantP,
      scoped(supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null))
        .contains("customer_types", ["Alıcı"]),
      scoped(supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null))
        .contains("customer_types", ["Mülk sahibi"]),
      // Özel günler — sayfa dilimi yerine tarihli tüm kayıtlardan (dar seçim)
      scoped(supabase
        .from("customers")
        .select("id, full_name, birth_date, anniversary_date, anniversary_note")
        .is("deleted_at", null))
        .or("birth_date.not.is.null,anniversary_date.not.is.null")
        .limit(1000),
      // Büyüme grafiği — son 8 haftanın kayıt tarihleri
      scoped(supabase
        .from("customers")
        .select("created_at")
        .is("deleted_at", null))
        .gte("created_at", eightWeeksAgo)
        .limit(2000),
      // Tip çipi sayaçları — hafif tek kolon taraması (TYPE_SCAN_LIMIT'i aşarsa sayaç gösterilmez).
      scoped(supabase.from("customers").select("customer_types").is("deleted_at", null)).limit(TYPE_SCAN_LIMIT),
    ]);
    // Hata sessizce "kayıt yok"a dönüşmesin: error.tsx sınırına düşer (sahte sıfır yok).
    assertQueryBatchSucceeded(
      [poolRes, poolHeat, buyerRes, ownerRes, occasionRes, growthRes, typeScanRes],
      [
        "customers-heat-pool",
        "customers-heat-signals",
        "customers-buyers",
        "customers-owners",
        "customers-occasions",
        "customers-growth",
        "customers-type-scan",
      ],
      "Müşteri listesi",
    );
    const nowMs = now();
    const signalMap = new Map<string, HeatSignalRow>();
    for (const s of (poolHeat.data ?? []) as HeatSignalRow[]) signalMap.set(s.customer_id, s);
    const poolRows = (poolRes.data ?? []) as unknown as HeatPoolRow[];
    // Havuz sayımı: tam durum okuyucusunun ısı parçasıyla BİREBİR aynı hesap (tek tanım: customer-state/core).
    const segmentCounts: Record<HeatSegment, number> = { sicak: 0, ilgili: 0, soguk: 0, uykuda: 0 };
    for (const r of poolRows) {
      const seg = computeCustomerHeat({ createdAt: r.created_at, blacklist: Boolean(r.blacklist) }, signalMap.get(r.id) ?? null, nowMs, { dormantDays }).segment;
      segmentCounts[seg] += 1;
    }

    // Yaklaşan doğum günü / yıldönümü (önümüzdeki 7 gün) — ayrı dar sorgudan
    const occasions: Occasion[] = [];
    for (const row of (occasionRes.data ?? []) as OccasionRow[]) {
      const bd = daysUntilAnnual(row.birth_date);
      if (bd !== null && bd <= WINDOW_DAYS) occasions.push({ id: row.id, name: row.full_name, kind: "birthday", days: bd, note: null });
      const ad = daysUntilAnnual(row.anniversary_date);
      if (ad !== null && ad <= WINDOW_DAYS) occasions.push({ id: row.id, name: row.full_name, kind: "anniversary", days: ad, note: row.anniversary_note });
    }
    occasions.sort((a, b) => a.days - b.days);

    // Büyüme grafiği — son 8 haftalık kayıtlar (gerçek toplam, sayfa dilimi değil)
    const growthRows = (growthRes.data ?? []) as { created_at: string }[];
    const weekMs = 7 * 86_400_000;
    const buckets = Array.from({ length: 8 }, () => 0);
    growthRows.forEach((row) => {
      const idx = 7 - Math.floor((nowMs - new Date(row.created_at).getTime()) / weekMs);
      if (idx >= 0 && idx < 8) buckets[idx] += 1;
    });
    const typeScanRows = (typeScanRes.data ?? []) as { customer_types: string[] | null }[];
    return {
      buyerCount: buyerRes.count ?? 0,
      ownerCount: ownerRes.count ?? 0,
      occasions,
      growthTotal: buckets.reduce((a, b) => a + b, 0),
      growthFromDate: eightWeeksAgo.slice(0, 10),
      // PostgREST tavanı 1000 satır olabilir (limit 2000 istense de): 1000 ve üstü kesilmiş sayılır, seri çizilmez.
      weeklySeries: growthRows.length >= 1000 ? undefined : buckets,
      weeklyBars: weekBucketsOf(growthRows.map((r) => r.created_at), nowMs, 1000),
      // Tarama kesilmediyse güvenilir
      typeCounts: typeScanRows.length >= TYPE_SCAN_LIMIT ? null : countCustomerTypes(typeScanRows),
      segmentCounts,
      poolLimited: poolRows.length >= HEAT_POOL_LIMIT,
    };
  })();
  // Sayfa hata öncesi çıkarsa (yönlendirme vb.) yakalanmamış red olmasın; bileşenler yine aynı sözü bekleyip hatayı görür.
  summary.catch(() => undefined);

  const batch = await Promise.all([
    listP,
    segmentF ? poolP : Promise.resolve(null),
    supabase.from("profiles").select("id, full_name, role, team_id").eq("is_active", true).order("full_name"),
    signalsP,
    // "Toplam kayıt" — liste sayfalı olduğundan head-count (satır taşımaz, yalnızca sayım döner).
    scoped(supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null)),
    // Etiket filtresi + toplu etiketleme önerileri — tenant'taki distinct etiketler
    fetchTenantTags(supabase),
    getDefinitionsOrDefault("customer_type"),
    getDefinitionsOrDefault("customer_source"),
    savedViewsPromise,
    pageHeatP,
    dormantP,
    extrasP,
  ]);
  const [
    listRes,
    poolRes,
    advisorsRes,
    signalsRes,
    totalAllRes,
    tenantTags,
    typeDefs,
    sourceDefs,
    savedViews,
    heatRes,
    dormantDays,
    extrasRes,
  ] = batch;
  assertQueryBatchSucceeded(
    [listRes, ...(poolRes ? [poolRes] : []), advisorsRes, totalAllRes, heatRes],
    ["customers-list", ...(poolRes ? ["customers-heat-pool"] : []), "advisors", "customers-total", "customers-heat-signals"],
    "Müşteri listesi",
  );
  if (signalsRes) assertQueryBatchSucceeded([signalsRes], ["lead-signals"], "Müşteri listesi");
  const customers = listRes.data;
  const customerTotal = listRes.count;
  const advisors = advisorsRes.data;
  const totalAll = totalAllRes.count;

  // DB-driven tanımlar (boşsa definition-defaults.ts yedeği getDefinitionsOrDefault içinde)
  const customerTypes = typeDefs;
  const sourceEntries = sourceDefs.map((s) => [s.value, s.label] as const);

  // ---- Isı sinyalleri (tek toplu RPC — N+1 yok) -----------------------------
  const pageRowsRaw = (customers ?? []) as unknown as CustomerRow[];
  const heatSignalMap = new Map<string, HeatSignalRow>();
  for (const s of (heatRes.data ?? []) as HeatSignalRow[]) heatSignalMap.set(s.customer_id, s);
  const nowMs = now();

  // ---- Görünen satırlar + sayfalama ---------------------------------------
  let rows: CustomerRow[];
  let totalFiltered: number;
  if (segmentF) {
    // Segment filtresi: havuz skorlanır → filtrelenir → bellek içinde sayfalanır.
    const poolRows = (poolRes?.data ?? []) as unknown as HeatPoolRow[];
    const matching = poolRows.filter(
      (r) =>
        computeCustomerHeat({ createdAt: r.created_at, blacklist: Boolean(r.blacklist) }, heatSignalMap.get(r.id) ?? null, nowMs, { dormantDays }).segment === segmentF,
    );
    totalFiltered = matching.length;
    const sliceIds = matching.slice(offset, offset + PAGE_SIZE).map((r) => r.id);
    if (sliceIds.length > 0) {
      // Dilim küçüktür (≤PAGE_SIZE) — tam kolonlar yalnız görünen satırlar için çekilir.
      const sliceRes = await buildFilteredQuery(LIST_COLS).in("id", sliceIds);
      assertQueryBatchSucceeded([sliceRes], ["customers-segment-slice"], "Müşteri listesi");
      const byId = new Map(((sliceRes.data ?? []) as unknown as CustomerRow[]).map((r) => [r.id, r]));
      rows = sliceIds.flatMap((id) => byId.get(id) ?? []);
    } else {
      rows = [];
    }
  } else {
    rows = pageRowsRaw;
    totalFiltered = (unfilteredList ? totalAll : customerTotal) ?? rows.length;
  }
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const rangeStart = totalFiltered === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + rows.length, totalFiltered);

  // Tam durum (sıcaklık + risk + aday): YALNIZ görünen sayfa için — okuyucu tek kapı (customer-state/core).
  // Niyet sinyalleri (açık teklif/anlaşma) ısı RPC'sinden gelir; ayrıca teklif/anlaşma sorgusu yoktur.
  const rowIds = rows.map((c) => c.id);
  const leadSignalRes = signalsRes ?? (await fetchLeadSignals(supabase, tenantId, rowIds));
  if (!signalsRes) assertQueryBatchSucceeded([leadSignalRes], ["lead-signals"], "Müşteri listesi");
  const signalMap = new Map<string, LeadSignalRow>();
  for (const s of leadSignalRes.data) signalMap.set(s.customer_id, s);
  const [upcomingRes, ownerHistRes] =
    extrasRes ??
    (await Promise.all([
      fetchUpcomingAppointmentIds(supabase, rowIds, daysAgoIso(0)),
      fetchOwnerHistory(supabase, rows.filter((c) => isOwnerCustomer(c.customer_types)).map((c) => c.id)),
    ]));
  assertQueryBatchSucceeded([upcomingRes, ownerHistRes], ["upcoming-appointments", "owner-history"], "Müşteri listesi");
  const stateMap = new Map<string, CustomerState>(
    rows.map((c) => [
      c.id,
      buildCustomerState(
        {
          customerId: c.id,
          createdAt: c.created_at,
          blacklist: Boolean(c.blacklist),
          hasPhone: Boolean(c.phone),
          hasEmail: Boolean(c.email),
          source: c.source,
          types: c.customer_types ?? [],
          leadSignals: signalMap.get(c.id) ?? null,
          heatSignals: heatSignalMap.get(c.id) ?? null,
          hasUpcomingAppointment: upcomingRes.data.has(c.id),
          wonDeals: ownerHistRes.data.wonDeals.get(c.id) ?? 0,
          hasListingIntentDemand: ownerHistRes.data.listingIntent.has(c.id),
        },
        nowMs,
        { dormantDays },
      ),
    ]),
  );
  // "Sıcak önce" — ısı skoru sıralaması yalnızca görünen sayfa içinde uygulanır
  const displayRows = sortF === "hot"
    ? [...rows].sort((a, b) => (stateMap.get(b.id)?.scores.heat.score ?? 0) - (stateMap.get(a.id)?.scores.heat.score ?? 0))
    : rows;
  const hotCount = rows.filter((c) => stateMap.get(c.id)?.temperature === "sicak").length;

  // Danışman seçicileri (süzgeç + toplu atama) yalnız SATIŞ rollerini listeler (B070: salt okunur / muhasebe / çağrı
  // merkezi yok); takım lideri kendi takımını "Önerilen" olarak üstte görür. Satırdaki danışman adı TÜM aktif profillerden.
  const profileRows = (advisors ?? []) as { id: string; full_name: string | null; role: string | null; team_id?: string | null }[];
  const viewer = await requireActiveTenant().catch(() => null);
  const advisorList = toAssignableAdvisors(
    profileRows.map((a) => ({ ...a, id: String(a.id) })),
    viewer?.ok ? { userId: viewer.userId, role: viewer.role } : undefined,
  );

  const pageIds = displayRows.map((c) => c.id);

  const advisorName = new Map(profileRows.map((a) => [String(a.id), String(a.full_name ?? "")]));
  const sourceLabel = new Map<string, string>(sourceEntries);

  // ---- Satır modelleri (tablo + mobil liste ortak veri) ----------------------
  const viewModels: CustomerVM[] = displayRows.map((c) => {
    const state = stateMap.get(c.id);
    const heat = state?.scores.heat;
    const lastContactIso = heatSignalMap.get(c.id)?.last_contact ?? null;
    const lastDays = lastContactIso && !Number.isNaN(new Date(lastContactIso).getTime())
      ? Math.floor(msSince(lastContactIso) / 86_400_000)
      : null;
    return {
      id: c.id,
      name: c.full_name,
      href: `/app/musteriler/${c.id}`,
      types: c.customer_types ?? [],
      tags: c.tags ?? [],
      heat: heat
        ? {
            // Kart başlığı ve Müşteri sıcaklığı kartıyla aynı metin (YD5); aday skoru yalnız ayrıntıda.
            label: heatBadge(heat).text,
            tone: heatTone(heat.segment),
            title: state && !c.blacklist ? `${heatTitle(heat)} · Ciddiyet puanı ${state.scores.lead.score} (ayrı ölçek)` : heatTitle(heat),
          }
        : null,
      risk: state && !c.blacklist && state.risk === "yuksek" ? { label: "Yüksek risk", title: state.reasons[0] ? `${state.reasons[0].label}: ${state.reasons[0].evidence}` : "Kayıp riski yüksek" } : null,
      blacklist: Boolean(c.blacklist),
      sourceLabel: formatLeadSource(c.source, sourceLabel),
      channelLabel: leadChannelLabel(c.lead_channel),
      phone: c.phone,
      phoneDisplay: c.phone ? formatTurkishPhone(c.phone) : null,
      telHref: c.phone ? toTelHref(c.phone) : null,
      waHref: c.phone ? toWhatsAppLink(c.phone) : null,
      email: c.email,
      province: provinceName(c.province),
      advisor: c.assigned_to ? (advisorName.get(c.assigned_to) ?? null) : null,
      lastContact: lastDays !== null ? relativeFromDays(lastDays) : null,
      addedLabel: relativeAdded(c.created_at),
      createdLabel: formatDateTr(c.created_at),
    };
  });

  return {
    viewModels,
    pageIds,
    rowCount: rows.length,
    totalAll: totalAll ?? 0,
    totalFiltered,
    totalPages,
    rangeStart,
    rangeEnd,
    hotCount,
    advisorList,
    advisorName,
    tenantTags,
    customerTypes,
    sourceEntries,
    sourceLabel,
    savedViews,
    /** Akışla gelen özet (KPI/grafik/özel gün/segment): sayfa Suspense içinde bekler. */
    summary,
  };
}
