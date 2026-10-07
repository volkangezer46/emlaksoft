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
import { computeLeadScore } from "@/lib/lead-score";
import { HEAT_SEGMENTS, heatTitle, scoreCustomerHeat, type CustomerHeat, type HeatSegment } from "@/lib/customer-heat";
import { assertQueryBatchSucceeded } from "@/lib/supabase/query-batch";
import { fetchLeadSignals, type LeadSignalRow } from "@/lib/lead-signals";
import { getSetting } from "@/lib/settings/read";
import { formatDateTr } from "@/lib/format";
import { applyScopeFilter, type ScopeFilter } from "@/lib/access-control/query-scope";
import type { CustomerVM } from "./customer-rows";
import { countCustomerTypes, heatTone, relativeFromDays } from "./customer-list-logic";
import { fetchTenantTags } from "./tenant-tags";
import { weekBucketsOf } from "@/lib/ui/list-charts";

/** Sayfa başına kayıt — gerçek sayfalama, 500'lük dilim yerine. */
export const PAGE_SIZE = 50;

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

export type Occasion = { id: string; name: string; kind: "birthday" | "anniversary"; days: number; note: string | null };

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
  const buildFilteredQuery = (select: string, opts?: { count: "exact" }) =>
    applyCustomerFilters(scoped(supabase.from("customers").select(select, opts).is("deleted_at", null)), filters);

  // count: "exact" — sayfalama ("X-Y / Toplam Z") gerçek toplamı ister;
  // sayı aynı yanıtta gelir, ek gidiş-dönüş yok.
  // Filtresiz görünümde filtreli toplam = "Toplam kayıt" KPI'ı (totalAll, aynı
  // koşul: deleted_at is null) — listeye ikinci bir COUNT bindirmeye gerek yok.
  const unfilteredList = !typeF && !etiketF && !sourceF && !assignedF && !fromF && !toF && !term;
  let listQuery = buildFilteredQuery(LIST_COLS, unfilteredList ? undefined : { count: "exact" });
  if (sortKey === "ad") {
    listQuery = listQuery
      .order("full_name", { ascending: sortDir === "asc" })
      .order("created_at", { ascending: false });
  } else {
    listQuery = listQuery.order("created_at", { ascending: sortDir === "asc" });
  }

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

  type IntentRows = { data: { customer_id: string | null }[] | null; error?: unknown };
  const fetchIntentSignals = async (ids: string[]): Promise<[IntentRows, IntentRows]> =>
    ids.length
      ? Promise.all([
          supabase.from("offers").select("customer_id").in("customer_id", ids),
          supabase.from("deals").select("customer_id").in("customer_id", ids).not("stage", "in", "(won,lost)"),
        ])
      : [{ data: [] }, { data: [] }];
  // Liste + havuz sorguları hemen başlar; ısı RPC'si ve niyet sinyalleri bunlara bağlıdır
  // ama diğer (referans/KPI) sorguları BEKLEMEZ — eskiden hepsi bitince seri başlıyordu.
  const listP = segmentF
    ? Promise.resolve({ data: null, count: null })
    : Promise.resolve(listQuery.range(offset, offset + PAGE_SIZE - 1));
  const poolP = heatPoolQuery.limit(HEAT_POOL_LIMIT);
  const heatP = (async (): Promise<{ data: HeatSignalRow[] | null; error?: unknown }> => {
    const [l, p] = await Promise.all([listP, poolP]);
    const ids = [
      ...new Set([
        ...((p.data ?? []) as unknown as HeatPoolRow[]).map((r) => r.id),
        ...((l.data ?? []) as unknown as CustomerRow[]).map((r) => r.id),
      ]),
    ];
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
  })();
  const intentP: Promise<[IntentRows, IntentRows] | null> = segmentF
    ? Promise.resolve(null)
    : listP.then((l) => fetchIntentSignals(((l.data ?? []) as unknown as CustomerRow[]).map((c) => c.id)));
  // Lead sinyalleri YALNIZ görünen sayfanın id'leri için (eski imza tüm tenant'ı döndürür ve 1000'de kesilirdi).
  // Segment filtresinde satırlar havuzdan kesildiği için sinyaller aşağıda satırlar bilinince çekilir.
  const signalsP = segmentF
    ? Promise.resolve(null)
    : listP.then((l) =>
        fetchLeadSignals(supabase, tenantId, ((l.data ?? []) as unknown as CustomerRow[]).map((c) => c.id)),
      );

  const batch = await Promise.all([
    // Segment filtresi aktifken sayfa dilimi havuzdan kesilir; normal range
    // sorgusu boşa çalışmasın diye atlanır (listP yukarıda).
    listP,
    poolP,
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    signalsP,
    // KPI sayıları — liste artık sayfalı olduğundan head-count sorgularıyla
    // gerçek toplamlar çekilir (satır taşımaz, yalnızca sayım döner).
    scoped(supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null)),
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
    // Etiket filtresi + toplu etiketleme önerileri — tenant'taki distinct etiketler
    fetchTenantTags(supabase),
    getDefinitionsOrDefault("customer_type"),
    getDefinitionsOrDefault("customer_source"),
    savedViewsPromise,
    heatP,
    intentP,
    // Ofis tanımı: uykuda eşiği (varsayılan 90 gün = DORMANT_DAYS) — ana sorgularla aynı turda (eskiden ardışıktı).
    tenantId ? getSetting<number>("office.insight.dormant_days", { tenantId }) : Promise.resolve(undefined),
  ]);
  const [
    listRes,
    poolRes,
    advisorsRes,
    signalsRes,
    totalAllRes,
    buyerRes,
    ownerRes,
    occasionRes,
    growthRes,
    typeScanRes,
    tenantTags,
    typeDefs,
    sourceDefs,
    savedViews,
    heatRes,
    intentRes,
    dormantDays,
  ] = batch;
  // Hata sessizce "kayıt yok"a dönüşmesin: error.tsx sınırına düşer (sahte sıfır yok).
  assertQueryBatchSucceeded(
    [listRes, poolRes, advisorsRes, totalAllRes, buyerRes, ownerRes, occasionRes, growthRes, typeScanRes, heatRes],
    [
      "customers-list",
      "customers-heat-pool",
      "advisors",
      "customers-total",
      "customers-buyers",
      "customers-owners",
      "customers-occasions",
      "customers-growth",
      "customers-type-scan",
      "customers-heat-signals",
    ],
    "Müşteri listesi",
  );
  if (intentRes) assertQueryBatchSucceeded(intentRes, ["intent-offers", "intent-deals"], "Müşteri listesi");
  if (signalsRes) assertQueryBatchSucceeded([signalsRes], ["lead-signals"], "Müşteri listesi");
  const customers = listRes.data;
  const customerTotal = listRes.count;
  const heatPool = poolRes.data;
  const advisors = advisorsRes.data;
  const totalAll = totalAllRes.count;
  const buyerCount = buyerRes.count;
  const ownerCount = ownerRes.count;
  const occasionRows = occasionRes.data;
  const growthRows = growthRes.data;
  const typeScanRows = typeScanRes.data;

  // DB-driven tanımlar (boşsa definition-defaults.ts yedeği getDefinitionsOrDefault içinde)
  const customerTypes = typeDefs;
  const sourceEntries = sourceDefs.map((s) => [s.value, s.label] as const);

  // ---- Sıcaklık skorlama (tek toplu RPC — N+1 yok) ------------------------
  const poolRows = (heatPool ?? []) as unknown as HeatPoolRow[];
  const pageRowsRaw = (customers ?? []) as unknown as CustomerRow[];
  // Isı sinyalleri (heatP): havuz + görünen sayfa id'leri için, diğer sorgularla paralel.
  // Niyet sinyalleri (teklif/açık anlaşma) sayfa satırlarına bağlıdır, ısı RPC'sine
  // değil: segment filtresi yokken satırlar = pageRowsRaw → ısı RPC'siyle paralel başlar.
  const intentPrefetch = intentRes;
  const { data: heatSignals } = heatRes;

  const heatSignalMap = new Map<string, HeatSignalRow>();
  for (const s of (heatSignals ?? []) as HeatSignalRow[]) heatSignalMap.set(s.customer_id, s);
  const nowMs = now();
  const heatOf = (id: string, createdAt: string, blacklist: boolean | null): CustomerHeat => {
    const s = heatSignalMap.get(id);
    return scoreCustomerHeat(
      {
        lastContactAt: s?.last_contact ?? null,
        openDemands: s?.open_demands ?? 0,
        urgentDemands: s?.urgent_demands ?? 0,
        portalLikes30d: s?.portal_likes_30d ?? 0,
        hasOpenOfferOrDeal: (s?.open_offers ?? 0) > 0 || (s?.open_deals ?? 0) > 0,
        createdAt,
        blacklist: Boolean(blacklist),
      },
      nowMs,
      { dormantDays },
    );
  };
  const heatMap = new Map<string, CustomerHeat>();
  for (const r of poolRows) heatMap.set(r.id, heatOf(r.id, r.created_at, r.blacklist));
  for (const r of pageRowsRaw) {
    if (!heatMap.has(r.id)) heatMap.set(r.id, heatOf(r.id, r.created_at, r.blacklist));
  }

  // Segment sayıları — filtrelenmiş listenin ilk HEAT_POOL_LIMIT kaydından.
  const segmentCounts: Record<HeatSegment, number> = { sicak: 0, ilgili: 0, soguk: 0, uykuda: 0 };
  for (const r of poolRows) {
    const seg = heatMap.get(r.id)?.segment;
    if (seg) segmentCounts[seg] += 1;
  }
  const poolLimited = poolRows.length >= HEAT_POOL_LIMIT;

  // ---- Görünen satırlar + sayfalama ---------------------------------------
  let rows: CustomerRow[];
  let totalFiltered: number;
  if (segmentF) {
    // Segment filtresi: havuz skorlanır → filtrelenir → bellek içinde sayfalanır.
    const matching = poolRows.filter((r) => heatMap.get(r.id)?.segment === segmentF);
    totalFiltered = matching.length;
    const sliceIds = matching.slice(offset, offset + PAGE_SIZE).map((r) => r.id);
    if (sliceIds.length > 0) {
      // Dilim küçüktür (≤50) — tam kolonlar yalnız görünen satırlar için çekilir.
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

  // Davranışsal niyet sinyalleri — YALNIZ görünen satırlar için (≤50, customer_id
  // indeksli). Teklif = güçlü niyet, açık anlaşma = en yüksek niyet.
  const rowIds = rows.map((c) => c.id);
  const intentPair = intentPrefetch ?? (await fetchIntentSignals(rowIds));
  if (!intentPrefetch) assertQueryBatchSucceeded(intentPair, ["intent-offers", "intent-deals"], "Müşteri listesi");
  const [{ data: offerRows }, { data: openDealRows }] = intentPair;
  const offerCount = new Map<string, number>();
  for (const o of (offerRows ?? []) as { customer_id: string | null }[]) {
    if (o.customer_id) offerCount.set(o.customer_id, (offerCount.get(o.customer_id) ?? 0) + 1);
  }
  const activeDealSet = new Set(
    ((openDealRows ?? []) as { customer_id: string | null }[]).map((d) => d.customer_id).filter(Boolean) as string[],
  );

  // Lead skoru — YALNIZCA görünen sayfa için hesaplanır (bellek dostu)
  const leadSignalRes = signalsRes ?? (await fetchLeadSignals(supabase, tenantId, rowIds));
  if (!signalsRes) assertQueryBatchSucceeded([leadSignalRes], ["lead-signals"], "Müşteri listesi");
  const signalMap = new Map<string, LeadSignalRow>();
  for (const s of leadSignalRes.data) signalMap.set(s.customer_id, s);
  const leadOf = (c: CustomerRow) => {
    const s = signalMap.get(c.id);
    return computeLeadScore({
      hasPhone: Boolean(c.phone),
      hasEmail: Boolean(c.email),
      source: c.source,
      activeDemands: s?.active_demands ?? 0,
      communications: s?.comms ?? 0,
      appointments: s?.appts ?? 0,
      calls: s?.calls ?? 0,
      lastActivityAt: s?.last_activity ?? null,
      createdAt: c.created_at,
      blacklist: Boolean(c.blacklist),
      offers: offerCount.get(c.id) ?? 0,
      hasActiveDeal: activeDealSet.has(c.id),
    });
  };
  const leadMap = new Map(rows.map((c) => [c.id, leadOf(c)]));
  // "Sıcak önce" — skor sıralaması yalnızca görünen sayfa içinde uygulanır
  const displayRows = sortF === "hot"
    ? [...rows].sort((a, b) => (leadMap.get(b.id)?.score ?? 0) - (leadMap.get(a.id)?.score ?? 0))
    : rows;
  const hotCount = rows.filter((c) => leadMap.get(c.id)?.tier === "hot").length;

  const advisorList = (advisors ?? []).map((a) => ({
    id: String(a.id),
    full_name: String(a.full_name ?? ""),
  }));

  // Yaklaşan doğum günü / yıldönümü (önümüzdeki 7 gün) — ayrı dar sorgudan
  const occasions: Occasion[] = [];
  for (const row of (occasionRows ?? []) as OccasionRow[]) {
    const bd = daysUntilAnnual(row.birth_date);
    if (bd !== null && bd <= WINDOW_DAYS) occasions.push({ id: row.id, name: row.full_name, kind: "birthday", days: bd, note: null });
    const ad = daysUntilAnnual(row.anniversary_date);
    if (ad !== null && ad <= WINDOW_DAYS) occasions.push({ id: row.id, name: row.full_name, kind: "anniversary", days: ad, note: row.anniversary_note });
  }
  occasions.sort((a, b) => a.days - b.days);

  // Büyüme grafiği — son 8 haftalık kayıtlar (gerçek toplam, sayfa dilimi değil)
  const weekMs = 7 * 86_400_000;
  const buckets = Array.from({ length: 8 }, () => 0);
  ((growthRows ?? []) as { created_at: string }[]).forEach((row) => {
    const idx = 7 - Math.floor((nowMs - new Date(row.created_at).getTime()) / weekMs);
    if (idx >= 0 && idx < 8) buckets[idx] += 1;
  });

  const pageIds = displayRows.map((c) => c.id);

  const growthTotal = buckets.reduce((a, b) => a + b, 0);
  const growthFromDate = eightWeeksAgo.slice(0, 10);

  // ---- Tip çipi sayaçları + haftalık yeni kayıt serisi (yalnız tarama kesilmediyse güvenilir) ----
  const typeCounts = (typeScanRows ?? []).length >= TYPE_SCAN_LIMIT
    ? null
    : countCustomerTypes((typeScanRows ?? []) as { customer_types: string[] | null }[]);
  // PostgREST tavanı 1000 satır olabilir (limit 2000 istense de): 1000 ve üstü kesilmiş sayılır, seri çizilmez.
  const weeklySeries = ((growthRows ?? []) as unknown[]).length >= 1000 ? undefined : buckets;
  const weeklyBars = weekBucketsOf(((growthRows ?? []) as { created_at: string }[]).map((r) => r.created_at), nowMs, 1000);
  const advisorName = new Map(advisorList.map((a) => [a.id, a.full_name]));
  const sourceLabel = new Map<string, string>(sourceEntries);

  // ---- Satır modelleri (tablo + mobil liste ortak veri) ----------------------
  const viewModels: CustomerVM[] = displayRows.map((c) => {
    const lead = leadMap.get(c.id);
    const heat = heatMap.get(c.id);
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
            label: `${HEAT_SEGMENTS[heat.segment].label}${heat.segment === "uykuda" && heat.daysSinceContact !== null ? ` · ${heat.daysSinceContact} gün` : ""}`,
            tone: heatTone(heat.segment),
            title: heatTitle(heat),
          }
        : null,
      lead: lead && !c.blacklist ? { score: lead.score, hot: lead.tier === "hot" } : null,
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
    buyerCount: buyerCount ?? 0,
    ownerCount: ownerCount ?? 0,
    totalFiltered,
    totalPages,
    rangeStart,
    rangeEnd,
    hotCount,
    advisorList,
    advisorName,
    occasions,
    growthTotal,
    growthFromDate,
    weeklySeries,
    weeklyBars,
    typeCounts,
    tenantTags,
    customerTypes,
    sourceEntries,
    sourceLabel,
    savedViews,
    segmentCounts,
    poolLimited,
  };
}
