import Link from "next/link";
import { redirect } from "next/navigation";
import { daysAgoIso, msSince, now } from "@/lib/clock";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  ArrowDown,
  ArrowUp,
  Cake,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  Flame,
  Gift,
  Moon,
  Plus,
  Search,
  Snowflake,
  Sparkles,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { exportCustomersCsv } from "@/app/actions/export";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { listSavedViews } from "@/app/actions/saved-views";
import { SavedViews } from "@/components/app/saved-views";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { CustomerBulkBar, CustomerBulkProvider } from "./customer-bulk-actions";
import { formatTurkishPhone, toTelHref, toWhatsAppLink } from "@/lib/phone";
import { computeLeadScore } from "@/lib/lead-score";
import {
  HEAT_SEGMENTS,
  heatTitle,
  scoreCustomerHeat,
  type CustomerHeat,
  type HeatSegment,
} from "@/lib/customer-heat";
import { EmptyState } from "@/components/app/empty-state";
import { ICONS } from "@/lib/icons";
import {
  CategoryChips,
  FilterGrid,
  FilterSelect,
  KpiStrip,
  ListToolbar,
  PILL_TONE_CLASS,
  StatusPill,
  buildActiveChips,
  densityOf,
  type KpiItem,
} from "@/components/ui/list-kit";
import { CustomerMobileList, CustomerTable, type CustomerVM } from "./customer-rows";
import { countCustomerTypes, heatTone, relativeFromDays } from "./customer-list-logic";
import { fetchTenantTags } from "./tenant-tags";

type LeadSignalRow = {
  customer_id: string;
  active_demands: number;
  comms: number;
  appts: number;
  calls: number;
  last_activity: string | null;
};

type CustomerRow = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  customer_types: string[] | null;
  tags: string[] | null;
  source: string | null;
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

/** Sayfa başına kayıt — gerçek sayfalama, 500'lük dilim yerine. */
const PAGE_SIZE = 50;

/**
 * Sıcaklık segmenti havuz sınırı: segment DB'de değil TS'te (skor formülü)
 * hesaplandığından, segment sayıları ve ?segment filtresi filtrelenmiş listenin
 * İLK 500 kaydı üzerinden yürür. 500+ kayıtlı ofislerde UI bunu açıkça söyler;
 * pratikte filtre (danışman/tip/etiket) daraltıldığında havuz tamamı kapsar.
 */
const HEAT_POOL_LIMIT = 500;
/** Tip çipi sayaçları için taranan azami kayıt; aşılırsa sayaçlar gizlenir (yaklaşık sayı gösterilmez). */
const TYPE_SCAN_LIMIT = 2000;

const HEAT_SEGMENT_KEYS = ["sicak", "ilgili", "soguk", "uykuda"] as const;

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
  "id, full_name, phone, email, customer_types, tags, source, notes, blacklist, assigned_to, created_at, birth_date, anniversary_date, anniversary_note, province:geo_provinces(name)";

/** Sütun başlığı sıralama linki — modül seviyesinde (render içinde komponent üretme kuralı). */
function SortHeaderLink({
  href,
  active,
  dir,
  label,
}: {
  href: string;
  active: boolean;
  dir: "asc" | "desc";
  label: string;
}) {
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <Link
      href={href}
      className={`focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-0.5 uppercase tracking-[0.04em] transition hover:text-ink-950 ${active ? "text-brand-700" : ""}`}
    >
      {label}
      <Icon className={`h-3.5 w-3.5 ${active ? "text-brand-600" : "text-text-faint"}`} />
    </Link>
  );
}

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

function occasionLabel(days: number): string {
  if (days === 0) return "bugün";
  if (days === 1) return "yarın";
  return `${days} gün sonra`;
}

function provinceName(p: CustomerRow["province"]) {
  if (!p) return "—";
  return Array.isArray(p) ? (p[0]?.name ?? "—") : p.name;
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

const PAGER_BTN =
  "focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 shadow-[var(--elev-1)] transition hover:bg-canvas";
const PAGER_BTN_DISABLED =
  "inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 opacity-40";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    type?: string;
    source?: string;
    etiket?: string;
    from?: string;
    to?: string;
    assigned?: string;
    segment?: string;
    sort?: string;
    sirala?: string;
    yon?: string;
    sayfa?: string;
    yogunluk?: string;
    yeni?: string;
  }>;
}) {
  const { perms, tenantId } = await requireModulePage("customers");
  const canCreate = (perms.customers ?? []).includes("create");
  const canEdit = (perms.customers ?? []).includes("edit");
  const canDelete = (perms.customers ?? []).includes("delete");
  const canBulk = canEdit || canDelete;
  const supabase = await createClient();
  // Bağımsız: sorgularla aynı turda beklenir (aşağıdaki Promise.all).
  const savedViewsPromise = listSavedViews("/app/musteriler");
  const sp = await searchParams;
  // Eski popup adresi (?yeni=1; komut paleti, kısayollar) → tam sayfa form.
  if (sp.yeni === "1") redirect("/app/musteriler/yeni");
  const q        = sp.q        ?? "";
  const typeF    = sp.type     ?? "";
  const sourceF  = sp.source   ?? "";
  const etiketF  = (sp.etiket ?? "").trim();
  // Yalnız YYYY-MM-DD kabul edilir — bozuk tarih paramı sorguya sızıp
  // tüm listeyi sessizce boşaltmasın (Supabase hatası → data null → "0 sonuç").
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const fromF    = ISO_DATE.test(sp.from ?? "") ? sp.from! : "";
  const toF      = ISO_DATE.test(sp.to ?? "")   ? sp.to!   : "";
  const assignedF = sp.assigned ?? "";
  const sortF    = sp.sort     ?? "";
  const density  = densityOf(sp.yogunluk);
  // Sıcaklık segmenti filtresi — yalnız bilinen değerler
  const segmentF: HeatSegment | "" = (HEAT_SEGMENT_KEYS as readonly string[]).includes(sp.segment ?? "")
    ? (sp.segment as HeatSegment)
    : "";

  // Sütun sıralaması: ?sirala=ad|tarih & ?yon=asc|desc (varsayılan: tarih desc)
  const siralaF = sp.sirala === "ad" || sp.sirala === "tarih" ? sp.sirala : "";
  const yonF = sp.yon === "asc" || sp.yon === "desc" ? sp.yon : "";
  const sortKey: "ad" | "tarih" = siralaF === "ad" ? "ad" : "tarih";
  const sortDir: "asc" | "desc" = yonF || (sortKey === "ad" ? "asc" : "desc");

  const page = Math.max(1, Number.parseInt(sp.sayfa ?? "", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // ---- Sunucu tarafı filtreleme -------------------------------------------
  // Eskiden 500 kayıt çekilip bellekte filtreleniyordu; 500'ü aşan ofislerde
  // arama "kayıt yok" diyordu. Artık tüm filtreler Supabase sorgusunda.
  // Ad/telefon/e-posta araması — .or() sözdizimini bozan karakterler ayıklanır.
  // (İl adı araması DB'ye taşınmadı: join'li kolonda ilike desteklenmiyor.)
  const term = q.trim().replace(/[%_,()]/g, " ").trim();

  // Aynı filtre seti hem ana listeye hem sıcaklık havuzuna uygulanır —
  // tek doğruluk kaynağı bu kurucu (filtre eklerken iki yeri unutma riski yok).
  const buildFilteredQuery = (select: string, opts?: { count: "exact" }) => {
    let query = supabase.from("customers").select(select, opts).is("deleted_at", null);
    if (typeF)     query = query.contains("customer_types", [typeF]);
    if (etiketF)   query = query.contains("tags", [etiketF]);
    if (sourceF)   query = query.eq("source", sourceF);
    if (assignedF) query = query.eq("assigned_to", assignedF);
    if (fromF)     query = query.gte("created_at", fromF);
    if (toF)       query = query.lte("created_at", `${toF}T23:59:59.999`);
    if (term) {
      const pattern = `%${term}%`;
      const orParts = [
        `full_name.ilike.${pattern}`,
        `phone.ilike.${pattern}`,
        `email.ilike.${pattern}`,
      ];
      // "0532 111 22 33" gibi biçimli girdiler normalize kayıtla eşleşsin
      const digits = term.replace(/\D/g, "");
      if (digits.length >= 3 && digits !== term) orParts.push(`phone.ilike.%${digits}%`);
      query = query.or(orParts.join(","));
    }
    return query;
  };

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

  type IntentRows = { data: { customer_id: string | null }[] | null };
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
  const heatP = (async (): Promise<{ data: HeatSignalRow[] | null }> => {
    const [l, p] = await Promise.all([listP, poolP]);
    const ids = [
      ...new Set([
        ...((p.data ?? []) as unknown as HeatPoolRow[]).map((r) => r.id),
        ...((l.data ?? []) as unknown as CustomerRow[]).map((r) => r.id),
      ]),
    ];
    if (!tenantId || ids.length === 0) return { data: [] };
    const res = await supabase.rpc("customer_heat_signals", { p_tenant_id: tenantId, p_customer_ids: ids });
    return { data: res.data as HeatSignalRow[] | null };
  })();
  const intentP: Promise<[IntentRows, IntentRows] | null> = segmentF
    ? Promise.resolve(null)
    : listP.then((l) => fetchIntentSignals(((l.data ?? []) as unknown as CustomerRow[]).map((c) => c.id)));

  const [
    { data: customers, count: customerTotal },
    { data: heatPool },
    { data: advisors },
    { data: signals },
    { count: totalAll },
    { count: buyerCount },
    { count: ownerCount },
    { data: occasionRows },
    { data: growthRows },
    { data: typeScanRows },
    tenantTags,
    typeDefs,
    sourceDefs,
    savedViews,
    heatRes,
    intentRes,
  ] = await Promise.all([
    // Segment filtresi aktifken sayfa dilimi havuzdan kesilir; normal range
    // sorgusu boşa çalışmasın diye atlanır (listP yukarıda).
    listP,
    poolP,
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    tenantId
      ? supabase.rpc("customer_lead_signals", { p_tenant_id: tenantId })
      : Promise.resolve({ data: [] as LeadSignalRow[] }),
    // KPI sayıları — liste artık sayfalı olduğundan head-count sorgularıyla
    // gerçek toplamlar çekilir (satır taşımaz, yalnızca sayım döner).
    supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .contains("customer_types", ["Alıcı"]),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .contains("customer_types", ["Mülk sahibi"]),
    // Özel günler — sayfa dilimi yerine tarihli tüm kayıtlardan (dar seçim)
    supabase
      .from("customers")
      .select("id, full_name, birth_date, anniversary_date, anniversary_note")
      .is("deleted_at", null)
      .or("birth_date.not.is.null,anniversary_date.not.is.null")
      .limit(1000),
    // Büyüme grafiği — son 8 haftanın kayıt tarihleri
    supabase
      .from("customers")
      .select("created_at")
      .is("deleted_at", null)
      .gte("created_at", eightWeeksAgo)
      .limit(2000),
    // Tip çipi sayaçları — hafif tek kolon taraması (TYPE_SCAN_LIMIT'i aşarsa sayaç gösterilmez).
    supabase.from("customers").select("customer_types").is("deleted_at", null).limit(TYPE_SCAN_LIMIT),
    // Etiket filtresi + toplu etiketleme önerileri — tenant'taki distinct etiketler
    fetchTenantTags(supabase),
    getDefinitionsOrDefault("customer_type"),
    getDefinitionsOrDefault("customer_source"),
    savedViewsPromise,
    heatP,
    intentP,
  ]);

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
      const { data: sliceRows } = await buildFilteredQuery(LIST_COLS).in("id", sliceIds);
      const byId = new Map(((sliceRows ?? []) as unknown as CustomerRow[]).map((r) => [r.id, r]));
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
  const [{ data: offerRows }, { data: openDealRows }] = (intentPrefetch ?? (await fetchIntentSignals(rowIds)));
  const offerCount = new Map<string, number>();
  for (const o of (offerRows ?? []) as { customer_id: string | null }[]) {
    if (o.customer_id) offerCount.set(o.customer_id, (offerCount.get(o.customer_id) ?? 0) + 1);
  }
  const activeDealSet = new Set(
    ((openDealRows ?? []) as { customer_id: string | null }[]).map((d) => d.customer_id).filter(Boolean) as string[],
  );

  // Lead skoru — YALNIZCA görünen sayfa için hesaplanır (bellek dostu)
  const signalMap = new Map<string, LeadSignalRow>();
  for (const s of (signals ?? []) as LeadSignalRow[]) signalMap.set(s.customer_id, s);
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
  const WINDOW_DAYS = 7;
  type Occasion = { id: string; name: string; kind: "birthday" | "anniversary"; days: number; note: string | null };
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

  // ---- Link kurucu: filtreler sayfa/sıralama linklerinde korunur ----------
  const baseParams: Record<string, string> = {};
  if (q)         baseParams.q = q;
  if (typeF)     baseParams.type = typeF;
  if (sourceF)   baseParams.source = sourceF;
  if (etiketF)   baseParams.etiket = etiketF;
  if (assignedF) baseParams.assigned = assignedF;
  if (segmentF)  baseParams.segment = segmentF;
  if (fromF)     baseParams.from = fromF;
  if (toF)       baseParams.to = toF;
  if (sortF)     baseParams.sort = sortF;
  if (siralaF)   baseParams.sirala = siralaF;
  if (yonF)      baseParams.yon = yonF;
  if (density === "kompakt") baseParams.yogunluk = "kompakt";

  const hrefWith = (overrides: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = { ...baseParams, ...overrides };
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) if (value) usp.set(key, value);
    const qs = usp.toString();
    return qs ? `/app/musteriler?${qs}` : "/app/musteriler";
  };

  // Sütun başlığı sıralama linki: aktifse yön değişir, değilse varsayılan yön.
  // "Sıcak önce" görsel sıralamayı ezdiği için başlık tıklaması onu temizler.
  const columnSortActive = sortF !== "hot";
  const sortHeaderHref = (key: "ad" | "tarih") => {
    const isActive = columnSortActive && sortKey === key;
    const nextDir = isActive
      ? (sortDir === "asc" ? "desc" : "asc")
      : key === "ad" ? "asc" : "desc";
    return hrefWith({ sirala: key, yon: nextDir, sort: undefined, sayfa: undefined });
  };
  const pageIds = displayRows.map((c) => c.id);

  const growthTotal = buckets.reduce((a, b) => a + b, 0);
  const growthFromDate = eightWeeksAgo.slice(0, 10);

  // ---- Tip çipi sayaçları + haftalık yeni kayıt serisi (yalnız tarama kesilmediyse güvenilir) ----
  const typeCounts = (typeScanRows ?? []).length >= TYPE_SCAN_LIMIT
    ? null
    : countCustomerTypes((typeScanRows ?? []) as { customer_types: string[] | null }[]);
  const weeklySeries = ((growthRows ?? []) as unknown[]).length >= 2000 ? undefined : buckets;
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
      sourceLabel: c.source ? (sourceLabel.get(c.source) ?? c.source) : null,
      phone: c.phone,
      phoneDisplay: c.phone ? formatTurkishPhone(c.phone) : null,
      telHref: c.phone ? toTelHref(c.phone) : null,
      waHref: c.phone ? toWhatsAppLink(c.phone) : null,
      email: c.email,
      province: provinceName(c.province),
      advisor: c.assigned_to ? (advisorName.get(c.assigned_to) ?? null) : null,
      lastContact: lastDays !== null ? relativeFromDays(lastDays) : null,
      addedLabel: relativeAdded(c.created_at),
      createdLabel: formatDate(c.created_at),
    };
  });

  // ---- KPI şeridi: yalnız gerçekten hesaplanan sayılar -----------------------
  const kpis: KpiItem[] = [
    { label: "Toplam kayıt", value: totalAll ?? 0, icon: <ICONS.musteri />, tone: "info", href: "/app/musteriler", hint: "kayıtlı müşteri" },
    {
      label: "Aktif alıcı",
      value: buyerCount ?? 0,
      icon: <UserCheck />,
      tone: "success",
      href: `/app/musteriler?type=${encodeURIComponent("Alıcı")}`,
      hint: "alıcı tipinde",
    },
    {
      label: "Mülk sahibi",
      value: ownerCount ?? 0,
      icon: <ICONS.portfoy />,
      tone: "neutral",
      href: `/app/musteriler?type=${encodeURIComponent("Mülk sahibi")}`,
      hint: "portföy kaynağı",
    },
    {
      label: "Yeni · son 8 hafta",
      value: growthTotal,
      icon: <TrendingUp />,
      tone: "info",
      href: `/app/musteriler?from=${growthFromDate}`,
      series: weeklySeries,
      showTrend: true,
      seriesLabel: "önceki 4 haftaya göre",
      hint: growthTotal === 0 ? "yeni müşteri eklenmedi" : undefined,
    },
    {
      label: "Sıcak müşteri",
      value: segmentCounts.sicak,
      icon: <Flame />,
      tone: "warning",
      href: hrefWith({ segment: "sicak", sayfa: undefined }),
      hint: poolLimited ? "yaklaşık (ilk 500 kayıt)" : "şu an en canlı",
    },
  ];

  const chips = buildActiveChips("/app/musteriler", baseParams, [
    { key: "q", label: "Arama" },
    { key: "type", label: "Tip" },
    { key: "source", label: "Kaynak", format: (v) => sourceLabel.get(v) ?? v },
    { key: "etiket", label: "Etiket" },
    { key: "assigned", label: "Danışman", format: (v) => advisorName.get(v) ?? v },
    { key: "from", label: "Başlangıç" },
    { key: "to", label: "Bitiş" },
    { key: "segment", label: "Sıcaklık", format: (v) => HEAT_SEGMENTS[v as HeatSegment]?.label ?? v },
    { key: "sort", label: "Sıralama", format: (v) => (v === "hot" ? "Sıcak önce" : v) },
  ]);
  const savedViewParams = Object.fromEntries(Object.entries(baseParams).filter(([k]) => k !== "yogunluk"));
  const segmentCards = [
    { key: "sicak" as const, icon: Flame },
    { key: "ilgili" as const, icon: Sparkles },
    { key: "soguk" as const, icon: Snowflake },
    { key: "uykuda" as const, icon: Moon },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Müşteriler"
        description="Talep, iletişim ve müşteri yolculuğu tek ekranda."
        actions={
          <>
            <ButtonLink href="/app/musteriler/cift-kayit" variant="secondary" size="sm" icon={Copy}>
              Çift kayıt kontrolü
            </ButtonLink>
            <ExportCsvButton action={exportCustomersCsv} label="Dışa aktar" />
            {canCreate ? <ButtonLink href="/app/musteriler/yeni" icon={Plus}>Yeni müşteri</ButtonLink> : null}
          </>
        }
      />

      {/* KPI şeridi — hepsi tıklanabilir; çubuk/trend yalnız gerçek haftalık kayıt serisinden */}
      <KpiStrip items={kpis} />

      {/* Yaklaşan doğum günü / yıldönümü hatırlatma */}
      {occasions.length > 0 ? (
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Gift aria-hidden="true" className="h-4 w-4 text-text-muted" />
            <p className="text-sm font-semibold text-ink-950">
              Yaklaşan özel günler
              <span className="ml-1.5 font-normal text-text-muted">· önümüzdeki {WINDOW_DAYS} gün</span>
            </p>
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {occasions.slice(0, 12).map((o) => (
              <li key={`${o.id}-${o.kind}`}>
                <Link
                  href={`/app/musteriler/${o.id}`}
                  className="focus-ring group inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300"
                  title={o.note ?? undefined}
                >
                  {o.kind === "birthday" ? (
                    <Cake aria-hidden="true" className="h-3.5 w-3.5 text-text-muted" />
                  ) : (
                    <Gift aria-hidden="true" className="h-3.5 w-3.5 text-text-muted" />
                  )}
                  <span>{o.name}</span>
                  <StatusPill tone={o.days === 0 ? "warning" : "neutral"} dot={false}>
                    {o.kind === "birthday" ? "Doğum günü" : "Yıldönümü"} · {occasionLabel(o.days)}
                  </StatusPill>
                </Link>
              </li>
            ))}
            {occasions.length > 12 ? (
              <li className="self-center text-xs font-medium text-text-muted">+{occasions.length - 12} daha</li>
            ) : null}
          </ul>
        </Card>
      ) : null}

      {/* Araç çubuğu: arama + filtre paneli (GET form → URL), yoğunluk, kayıtlı görünümler, aktif filtre çipleri */}
      <ListToolbar
        pathname="/app/musteriler"
        params={baseParams}
        searchPlaceholder="Ad, telefon, e-posta ara…"
        searchLabel="Müşteri ara"
        panelParamKeys={["source", "etiket", "assigned", "from", "to"]}
        panel={
          <>
            <FilterGrid>
              <FilterSelect
                name="source"
                label="Kaynak"
                value={sourceF}
                options={[{ value: "", label: "Tüm kaynaklar" }, ...sourceEntries.map(([v, l]) => ({ value: v, label: l }))]}
              />
              {tenantTags.length > 0 || etiketF ? (
                <FilterSelect
                  name="etiket"
                  label="Etiket"
                  value={etiketF}
                  options={[
                    { value: "", label: "Tüm etiketler" },
                    ...(etiketF && !tenantTags.includes(etiketF) ? [{ value: etiketF, label: etiketF }] : []),
                    ...tenantTags.map((t) => ({ value: t, label: t })),
                  ]}
                />
              ) : null}
              {advisorList.length > 0 ? (
                <FilterSelect
                  name="assigned"
                  label="Danışman"
                  value={assignedF}
                  options={[{ value: "", label: "Tüm danışmanlar" }, ...advisorList.map((a) => ({ value: a.id, label: a.full_name }))]}
                />
              ) : null}
            </FilterGrid>
            <FilterGrid>
              <label className="grid gap-1 text-xs font-semibold text-text-muted">
                Eklenme (başlangıç)
                <input name="from" type="date" defaultValue={fromF} className="min-h-9 min-w-0 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 text-sm font-normal text-text outline-none focus:border-brand-400" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-text-muted">
                Eklenme (bitiş)
                <input name="to" type="date" defaultValue={toF} className="min-h-9 min-w-0 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 text-sm font-normal text-text outline-none focus:border-brand-400" />
              </label>
            </FilterGrid>
          </>
        }
        sort={
          <Link
            href={hrefWith({ sort: sortF === "hot" ? undefined : "hot", sayfa: undefined })}
            aria-pressed={sortF === "hot"}
            title="Bu sayfadaki kayıtları lead skoruna göre sırala"
            className={`focus-ring press inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-sm font-semibold transition ${
              sortF === "hot" ? "border-brand-300 bg-brand-600/10 text-brand-700" : "border-line bg-surface text-text-muted hover:text-text"
            }`}
          >
            <Flame aria-hidden="true" className="h-4 w-4" />
            Sıcak önce{hotCount > 0 ? <span className="numeric text-xs">· {hotCount}</span> : null}
          </Link>
        }
        densityParam="yogunluk"
        chips={chips}
        resultCount={chips.length > 0 ? totalFiltered : undefined}
        savedViews={<SavedViews route="/app/musteriler" views={savedViews} currentParams={savedViewParams} />}
      />

      {(totalAll ?? 0) > 0 ? (
        <div className="space-y-2">
          {/* Müşteri tipi çipleri (sunucu filtresi, ?type=) */}
          <CategoryChips
            options={customerTypes.map((t) => ({ value: t.value, label: t.label }))}
            counts={typeCounts}
            total={totalAll ?? 0}
            active={typeF}
            pathname="/app/musteriler"
            params={baseParams}
            paramName="type"
            label="Müşteri tipi"
          />

          {/* Sıcaklık segmentleri — akıllı listeler (çip = filtre; aktifken tekrar tıklamak kaldırır) */}
          <nav aria-label="Müşteri sıcaklık segmentleri" className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold text-text-muted">Sıcaklık</span>
            {segmentCards.map((card) => {
              const on = segmentF === card.key;
              return (
                <Link
                  key={card.key}
                  href={on ? hrefWith({ segment: undefined, sayfa: undefined }) : hrefWith({ segment: card.key, sayfa: undefined })}
                  aria-current={on ? "true" : undefined}
                  title={on ? "Filtre aktif — kaldır" : `${HEAT_SEGMENTS[card.key].label} müşterileri göster`}
                  className={`focus-ring press inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${PILL_TONE_CLASS[heatTone(card.key)]} ${on ? "ring-2 ring-brand-500" : "opacity-85 hover:opacity-100"}`}
                >
                  <card.icon aria-hidden="true" className="h-3.5 w-3.5" />
                  {HEAT_SEGMENTS[card.key].label}
                  <span className="numeric">{segmentCounts[card.key]}</span>
                </Link>
              );
            })}
            {poolLimited ? (
              <span className="text-xs text-text-faint">
                Sayılar filtrelenmiş listenin ilk {HEAT_POOL_LIMIT.toLocaleString("tr-TR")} kaydından hesaplanır (yaklaşık).
              </span>
            ) : null}
          </nav>
        </div>
      ) : null}

      {(totalAll ?? 0) === 0 ? (
        <EmptyState
          icon={ICONS.musteri}
          illustration="start"
          title="Henüz müşteri yok"
          description="İlk müşterinizi ekleyin. Arayan, mülk sahibi ve yatırımcıları tek yerde toplayın; hiçbir talebi kaçırmayın."
          action={
            canCreate
              ? { href: "/app/musteriler/yeni", label: "Yeni müşteri" }
              : undefined
          }
          secondary={{ href: "/app/gelen-kutusu", label: "Gelen kutusundan aktar" }}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Search}
          illustration="search"
          title="Eşleşen müşteri bulunamadı"
          description="Arama ifadenizi ya da filtreleri değiştirip tekrar deneyin."
          action={{ href: "/app/musteriler", label: "Filtreleri temizle" }}
        />
      ) : (
        /* key: sayfa/filtre değişince client seçim state'i sıfırlanır —
           önceki sayfadan kalan bayat id'lerle toplu işlem yapılmasın */
        <CustomerBulkProvider key={`${page}|${q}|${typeF}|${sourceF}|${etiketF}|${assignedF}|${segmentF}|${fromF}|${toF}|${siralaF}|${yonF}`}>
          {canBulk ? (
            <CustomerBulkBar advisors={advisorList} tagSuggestions={tenantTags} canEdit={canEdit} canDelete={canDelete} />
          ) : null}
          <CustomerTable
            rows={viewModels}
            ids={pageIds}
            canBulk={canBulk}
            canEdit={canEdit}
            canDelete={canDelete}
            density={density}
            sortHeader={{
              name: (
                <SortHeaderLink href={sortHeaderHref("ad")} active={columnSortActive && sortKey === "ad"} dir={sortDir} label="Müşteri" />
              ),
              created: (
                <SortHeaderLink href={sortHeaderHref("tarih")} active={columnSortActive && sortKey === "tarih"} dir={sortDir} label="Kayıt tarihi" />
              ),
              nameSort: columnSortActive && sortKey === "ad" ? (sortDir === "asc" ? "ascending" : "descending") : undefined,
              createdSort: columnSortActive && sortKey === "tarih" ? (sortDir === "asc" ? "ascending" : "descending") : undefined,
            }}
          />
          <CustomerMobileList rows={viewModels} />
        </CustomerBulkProvider>
      )}

      {/* Sayfalama — filtre ve sıralama parametreleri linklerde korunur */}
      {totalFiltered > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="numeric text-text-muted">
            {rangeStart.toLocaleString("tr-TR")}–{rangeEnd.toLocaleString("tr-TR")} / Toplam{" "}
            {totalFiltered.toLocaleString("tr-TR")}
          </p>
          <div className="flex items-center gap-1.5">
            {page > 1 ? (
              <Link
                href={hrefWith({ sayfa: page - 1 > 1 ? String(page - 1) : undefined })}
                className={PAGER_BTN}
              >
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
              <Link href={hrefWith({ sayfa: String(page + 1) })} className={PAGER_BTN}>
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
    </div>
  );
}
