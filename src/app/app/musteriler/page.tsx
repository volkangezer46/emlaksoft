import Link from "next/link";
import { daysAgoIso, msSince, now } from "@/lib/clock";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Cake,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Clock3,
  Copy,
  Flame,
  Gift,
  Mail,
  MapPin,
  MessageCircle,
  Moon,
  Phone,
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
import { NewCustomerDialog } from "./new-customer-dialog";
import { getDefinitions } from "@/lib/definitions";
import { CustomerRowDelete } from "./customer-row-delete";
import { CustomerPortalLinkButton } from "@/components/app/portal-link-dialog";
import {
  CustomerBulkBar,
  CustomerBulkProvider,
  CustomerRowCheckbox,
  CustomerSelectAllCheckbox,
} from "./customer-bulk-actions";
import { formatTurkishPhone, toTelHref, toWhatsAppLink } from "@/lib/phone";
import { computeLeadScore, leadTierCls } from "@/lib/lead-score";
import {
  HEAT_SEGMENTS,
  heatTitle,
  scoreCustomerHeat,
  type CustomerHeat,
  type HeatSegment,
} from "@/lib/customer-heat";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { ICONS } from "@/lib/icons";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
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

const SOURCE_LABELS: Record<string, string> = {
  referral:    "Referans",
  web:         "Web sitesi",
  social:      "Sosyal medya",
  walk_in:     "Elden geldi",
  phone:       "Telefon",
  portal:      "Portal",
  other:       "Diğer",
};

const CUSTOMER_TYPES = [
  "Alıcı", "Satıcı", "Kiracı", "Mülk sahibi", "Yatırımcı",
];

/** Sayfa başına kayıt — gerçek sayfalama, 500'lük dilim yerine. */
const PAGE_SIZE = 50;

/**
 * Sıcaklık segmenti havuz sınırı: segment DB'de değil TS'te (skor formülü)
 * hesaplandığından, segment sayıları ve ?segment filtresi filtrelenmiş listenin
 * İLK 500 kaydı üzerinden yürür. 500+ kayıtlı ofislerde UI bunu açıkça söyler;
 * pratikte filtre (danışman/tip/etiket) daraltıldığında havuz tamamı kapsar.
 */
const HEAT_POOL_LIMIT = 500;

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
      className={`focus-ring inline-flex items-center gap-1.5 rounded-[6px] px-0.5 uppercase tracking-[0.04em] transition hover:text-ink-950 ${active ? "text-brand-700" : ""}`}
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
  "focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 shadow-[var(--elev-1)] transition hover:bg-canvas";
const PAGER_BTN_DISABLED =
  "inline-flex items-center gap-1 rounded-[9px] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 opacity-40";

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
  }>;
}) {
  const { perms, tenantId } = await requireModulePage("customers");
  const canCreate = (perms.customers ?? []).includes("create");
  const canEdit = (perms.customers ?? []).includes("edit");
  const canDelete = (perms.customers ?? []).includes("delete");
  const canBulk = canEdit || canDelete;
  const supabase = await createClient();
  const savedViews = await listSavedViews("/app/musteriler");
  const sp = await searchParams;
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
  let listQuery = buildFilteredQuery(LIST_COLS, { count: "exact" });
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

  const [
    { data: customers, count: customerTotal },
    { data: heatPool },
    { data: provinces },
    { data: branches },
    { data: advisors },
    { data: signals },
    { count: totalAll },
    { count: buyerCount },
    { count: ownerCount },
    { data: occasionRows },
    { data: growthRows },
    tenantTags,
    typeDefs,
    sourceDefs,
  ] = await Promise.all([
    // Segment filtresi aktifken sayfa dilimi havuzdan kesilir; normal range
    // sorgusu boşa çalışmasın diye atlanır.
    segmentF
      ? Promise.resolve({ data: null, count: null })
      : listQuery.range(offset, offset + PAGE_SIZE - 1),
    heatPoolQuery.limit(HEAT_POOL_LIMIT),
    supabase.from("geo_provinces").select("id, name").order("name", { ascending: true }),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
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
    // Etiket filtresi + toplu etiketleme önerileri — tenant'taki distinct etiketler
    fetchTenantTags(supabase),
    getDefinitions("customer_type"),
    getDefinitions("customer_source"),
  ]);

  // DB-driven tanımlar (boşsa sabit yedeğe düş)
  const customerTypes = typeDefs.length > 0 ? typeDefs : CUSTOMER_TYPES.map((t) => ({ value: t, label: t, color: null }));
  const customerTypeValues = customerTypes.map((t) => t.value);
  const sourceEntries = sourceDefs.length > 0 ? sourceDefs.map((s) => [s.value, s.label] as const) : Object.entries(SOURCE_LABELS);

  // ---- Sıcaklık skorlama (tek toplu RPC — N+1 yok) ------------------------
  const poolRows = (heatPool ?? []) as unknown as HeatPoolRow[];
  const pageRowsRaw = (customers ?? []) as unknown as CustomerRow[];
  // Havuz + görünen sayfa (500'ü aşan derin sayfalarda rozet kaybolmasın)
  const heatIds = [...new Set([...poolRows.map((r) => r.id), ...pageRowsRaw.map((r) => r.id)])];
  const { data: heatSignals } =
    tenantId && heatIds.length > 0
      ? await supabase.rpc("customer_heat_signals", {
          p_tenant_id: tenantId,
          p_customer_ids: heatIds,
        })
      : { data: [] as HeatSignalRow[] };

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
    totalFiltered = customerTotal ?? rows.length;
  }
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const rangeStart = totalFiltered === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + rows.length, totalFiltered);

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
    });
  };
  const leadMap = new Map(rows.map((c) => [c.id, leadOf(c)]));
  // "Sıcak önce" — skor sıralaması yalnızca görünen sayfa içinde uygulanır
  const displayRows = sortF === "hot"
    ? [...rows].sort((a, b) => (leadMap.get(b.id)?.score ?? 0) - (leadMap.get(a.id)?.score ?? 0))
    : rows;
  const hotCount = rows.filter((c) => leadMap.get(c.id)?.tier === "hot").length;

  const provinceList = provinces ?? [];
  const branchList = branches ?? [];
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

  const activeFilters = [typeF, sourceF, etiketF, fromF, toF, assignedF, segmentF].filter(Boolean).length;

  // Büyüme grafiği — son 8 haftalık kayıtlar (gerçek toplam, sayfa dilimi değil)
  const weekMs = 7 * 86_400_000;
  const buckets = Array.from({ length: 8 }, () => 0);
  ((growthRows ?? []) as { created_at: string }[]).forEach((row) => {
    const idx = 7 - Math.floor((nowMs - new Date(row.created_at).getTime()) / weekMs);
    if (idx >= 0 && idx < 8) buckets[idx] += 1;
  });
  const maxBucket = Math.max(1, ...buckets);
  const growthPts = buckets.map((b, i) => ({ x: (i / 7) * 200, y: 56 - (b / maxBucket) * 44 - 6 }));
  const growthLine = growthPts.map((p) => `${p.x},${p.y}`).join(" ");
  const growthArea = `0,60 ${growthLine} 200,60`;
  const growthLast = growthPts[growthPts.length - 1];

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

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-brand-600/35 blur-[70px]" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
              <span className="status-pulse h-2 w-2 rounded-full bg-mint-400" /> CRM canlı
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Müşteri merkezi</h1>
            <p className="mt-1 text-sm text-white/60">Talep, iletişim ve müşteri yolculuğu tek operasyon ekranında.</p>
          </div>
          {canCreate ? <NewCustomerDialog provinces={provinceList} branches={branchList} types={customerTypeValues} /> : null}
        </div>
        <div className="relative mt-6 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="stagger-grid grid grid-cols-3 gap-3">
            {/* KPI'lar filtre formunun kendi parametreleriyle listeye iner: tip
                sayımları sabit "Alıcı"/"Mülk sahibi" etiketleriyle yapıldığından
                linkler de aynı değerleri kullanır. Sayılar head-count
                sorgularından gelir — sayfa dilimi değil, gerçek toplamlar. */}
            {[
              // İkonografi: "müşteri" kavramı her ekranda ICONS.musteri (Users).
              // "Mülk sahibi" MapPin (konum ikonu) ile çiziliyordu — kavramla
              // ilgisi yoktu; portföy sahipliğini anlatan ICONS.portfoy ile
              // değiştirildi.
              { label: "Toplam kayıt", value: totalAll ?? 0, icon: ICONS.musteri, href: "/app/musteriler" },
              { label: "Aktif alıcı", value: buyerCount ?? 0, icon: UserCheck, href: `/app/musteriler?type=${encodeURIComponent("Alıcı")}` },
              { label: "Mülk sahibi", value: ownerCount ?? 0, icon: ICONS.portfoy, href: `/app/musteriler?type=${encodeURIComponent("Mülk sahibi")}` },
            ].map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="focus-ring press lift group block rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur transition hover:border-brand-300"
              >
                <div className="flex items-start justify-between">
                  <item.icon className="h-4 w-4 text-mint-400" />
                  <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </div>
                <p className="mt-2 font-display text-xl font-extrabold text-white">{item.value}</p>
                <p className="text-[11px] text-white/45 sm:text-xs">{item.label}</p>
              </Link>
            ))}
          </div>
          <div className="rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-white/75"><TrendingUp className="h-3.5 w-3.5 text-cyan-400" /> Yeni müşteri · son 8 hafta</p>
              <span className="rounded-full bg-brand-500/20 px-2 py-0.5 text-[11px] font-bold text-cyan-300">{buckets[7]} bu hafta</span>
            </div>
            <svg viewBox="0 0 200 60" className="mt-3 h-20 w-full overflow-visible" preserveAspectRatio="none">
              <defs>
                <linearGradient id="custGrowth" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--cyan-400)" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="var(--cyan-400)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points={growthArea} fill="url(#custGrowth)" />
              <polyline
                className="chart-draw"
                style={{ "--len": 320 } as React.CSSProperties}
                points={growthLine}
                fill="none"
                stroke="var(--cyan-400)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx={growthLast.x} cy={growthLast.y} r="3" fill="var(--cyan-400)" opacity="0.4" className="glow-halo" />
              <circle cx={growthLast.x} cy={growthLast.y} r="2.6" fill="#fff" />
            </svg>
          </div>
        </div>
      </section>

      {/* Yaklaşan doğum günü / yıldönümü hatırlatma */}
      {occasions.length > 0 ? (
        <section className="overflow-hidden rounded-[16px] border border-amber-300/60 bg-gradient-to-r from-amber-50 to-rose-50/60 p-4 shadow-[var(--shadow-xs)] dark:border-amber-400/25 dark:from-amber-500/[0.08] dark:to-rose-500/[0.06]">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-400/20 text-amber-600 dark:text-amber-400">
              <Gift className="h-4 w-4" />
            </span>
            <p className="text-sm font-bold text-ink-950">
              Yaklaşan özel günler
              <span className="ml-1.5 font-medium text-text-muted">· önümüzdeki {WINDOW_DAYS} gün</span>
            </p>
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {occasions.slice(0, 12).map((o) => (
              <li key={`${o.id}-${o.kind}`}>
                <Link
                  href={`/app/musteriler/${o.id}`}
                  className="group inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10"
                  title={o.note ?? undefined}
                >
                  {o.kind === "birthday" ? (
                    <Cake className="h-3.5 w-3.5 text-rose-500" />
                  ) : (
                    <Gift className="h-3.5 w-3.5 text-amber-500" />
                  )}
                  <span>{o.name}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${o.days === 0 ? "bg-rose-500 text-white" : "bg-amber-400/20 text-amber-700 dark:text-amber-300"}`}>
                    {o.kind === "birthday" ? "🎂" : "🎉"} {occasionLabel(o.days)}
                  </span>
                </Link>
              </li>
            ))}
            {occasions.length > 12 ? (
              <li className="self-center text-xs font-medium text-text-muted">+{occasions.length - 12} daha</li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {/* Filtre toolbar — form GET olduğu için sayfa 1'e döner; sıralama gizli
          alanlarla korunur */}
      <form className="rounded-[16px] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] space-y-3" action="/app/musteriler">
        {siralaF ? <input type="hidden" name="sirala" value={siralaF} /> : null}
        {yonF ? <input type="hidden" name="yon" value={yonF} /> : null}
        {segmentF ? <input type="hidden" name="segment" value={segmentF} /> : null}
        <div className="flex flex-wrap gap-3">
          {/* Arama */}
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
            <input
              name="q"
              defaultValue={q}
              aria-label="Müşteri ara"
              placeholder="Ad, telefon, e-posta ara…"
              className="w-full rounded-[11px] border border-line bg-canvas py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
            />
          </div>
          {/* Müşteri tipi */}
          <select
            name="type"
            defaultValue={typeF}
            aria-label="Müşteri tipi filtresi"
            className="rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
          >
            <option value="">Tüm tipler</option>
            {customerTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {/* Kaynak */}
          <select
            name="source"
            defaultValue={sourceF}
            aria-label="Kaynak filtresi"
            className="rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
          >
            <option value="">Tüm kaynaklar</option>
            {sourceEntries.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {/* Etiket — tenant'taki distinct etiketler (URL'deki bayat değer de listelenir) */}
          {(tenantTags.length > 0 || etiketF) && (
            <select
              name="etiket"
              defaultValue={etiketF}
              aria-label="Etiket filtresi"
              className="rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            >
              <option value="">Tüm etiketler</option>
              {etiketF && !tenantTags.includes(etiketF) ? (
                <option value={etiketF}>{etiketF}</option>
              ) : null}
              {tenantTags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {/* Danışman */}
          {advisorList.length > 0 && (
            <select
              name="assigned"
              defaultValue={assignedF}
              aria-label="Danışman filtresi"
              className="rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            >
              <option value="">Tüm danışmanlar</option>
              {advisorList.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </select>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Tarih aralığı */}
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <span className="text-xs font-medium">Eklenme:</span>
            <input
              name="from"
              type="date"
              defaultValue={fromF}
              className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
            />
            <span>—</span>
            <input
              name="to"
              type="date"
              defaultValue={toF}
              className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
            />
          </div>
          <button type="submit" className="rounded-[10px] bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700">
            Filtrele
          </button>
          {(activeFilters > 0 || q || sortF || siralaF) && (
            <Link href="/app/musteriler" className="text-xs font-semibold text-text-muted hover:text-danger-500">
              Temizle
            </Link>
          )}
          <button
            type="submit"
            name="sort"
            value={sortF === "hot" ? "" : "hot"}
            className={`inline-flex items-center gap-1 rounded-[10px] px-3 py-2 text-xs font-semibold transition ${sortF === "hot" ? "bg-danger-500/15 text-danger-500 ring-1 ring-danger-500/25" : "border border-line text-text-muted hover:border-danger-500/50 hover:text-danger-500"}`}
            title="Bu sayfadaki kayıtları lead skoruna göre sırala"
          >
            🔥 Sıcak önce{hotCount > 0 ? ` · ${hotCount}` : ""}
          </button>
          <span className="ml-auto rounded-full bg-brand-600/10 px-3 py-1.5 text-xs font-semibold text-brand-600">
            {totalFiltered.toLocaleString("tr-TR")} sonuç
          </span>
        </div>
      </form>

      {/* Kayıtlı görünümler — aktif filtre kombinasyonu adlandırılıp saklanır */}
      <SavedViews route="/app/musteriler" views={savedViews} currentParams={baseParams} />

      {/* Sıcaklık segmentleri — akıllı listeler (kart = filtre çipi, tıklanınca
          ?segment= ile listeye iner; aktifken tekrar tıklamak filtreyi kaldırır) */}
      {(totalAll ?? 0) > 0 ? (
        <section aria-label="Müşteri sıcaklık segmentleri" className="space-y-2">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(
              [
                { key: "sicak" as const, icon: Flame, tone: "danger" as const },
                { key: "ilgili" as const, icon: Sparkles, tone: "neutral" as const },
                { key: "soguk" as const, icon: Snowflake, tone: "neutral" as const },
                { key: "uykuda" as const, icon: Moon, tone: "warning" as const },
              ]
            ).map((card) => (
              <StatCard
                key={card.key}
                label={`${HEAT_SEGMENTS[card.key].emoji} ${HEAT_SEGMENTS[card.key].label}`}
                value={segmentCounts[card.key]}
                icon={card.icon}
                tone={card.tone}
                trend={segmentF === card.key ? "neutral" : undefined}
                trendLabel={segmentF === card.key ? "Filtre aktif — kaldır" : undefined}
                href={
                  segmentF === card.key
                    ? hrefWith({ segment: undefined, sayfa: undefined })
                    : hrefWith({ segment: card.key, sayfa: undefined })
                }
              />
            ))}
          </div>
          {poolLimited ? (
            <p className="text-xs text-text-faint">
              Segment sayıları ve filtresi, filtrelenmiş listenin ilk{" "}
              {HEAT_POOL_LIMIT.toLocaleString("tr-TR")} kaydı üzerinden hesaplanır (yaklaşık değerler).
              Daha kesin sonuç için danışman, tip veya etiket filtresiyle listeyi daraltın.
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Cift kayit kontrolu: telefon/e-posta uzerinde benzersizlik kisiti
              YOK, yani ayni kisi iki kez girilebiliyor ve bunu goren bir ekran
              yoktu. */}
          <Link
            href="/app/musteriler/cift-kayit"
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] border border-line px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-amber-400 hover:text-amber-600"
          >
            <Copy className="h-3.5 w-3.5" /> Çift kayıt kontrolü
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <ExportCsvButton action={exportCustomersCsv} iconOnly label="Müşterileri CSV indir" />
        </div>
      </div>

      {(totalAll ?? 0) === 0 ? (
        <EmptyState
          icon={ICONS.musteri}
          illustration="start"
          title="Henüz müşteri yok"
          description="İlk müşterinizi ekleyin. Arayan, mülk sahibi ve yatırımcıları tek yerde toplayın; hiçbir talebi kaçırmayın."
          action={
            canCreate
              ? { node: <NewCustomerDialog provinces={provinceList} branches={branchList} types={customerTypeValues} /> }
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
          secondary={{ href: "/app/musteriler", label: "Filtreleri temizle" }}
        />
      ) : (
        /* key: sayfa/filtre değişince client seçim state'i sıfırlanır —
           önceki sayfadan kalan bayat id'lerle toplu işlem yapılmasın */
        <CustomerBulkProvider key={`${page}|${q}|${typeF}|${sourceF}|${etiketF}|${assignedF}|${segmentF}|${fromF}|${toF}|${siralaF}|${yonF}`}>
          {canBulk ? (
            <CustomerBulkBar advisors={advisorList} tagSuggestions={tenantTags} canEdit={canEdit} canDelete={canDelete} />
          ) : null}
          <TableFrame minWidth={canBulk ? 800 : 760}>
            <Table>
              <THead>
                <TR>
                  {canBulk ? (
                    <TH className="w-10">
                      <CustomerSelectAllCheckbox ids={pageIds} />
                    </TH>
                  ) : null}
                  <TH
                    aria-sort={columnSortActive && sortKey === "ad" ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    <SortHeaderLink
                      href={sortHeaderHref("ad")}
                      active={columnSortActive && sortKey === "ad"}
                      dir={sortDir}
                      label="Müşteri"
                    />
                  </TH>
                  <TH>Tür</TH>
                  <TH>İletişim</TH>
                  <TH>Konum</TH>
                  <TH
                    aria-sort={columnSortActive && sortKey === "tarih" ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    <SortHeaderLink
                      href={sortHeaderHref("tarih")}
                      active={columnSortActive && sortKey === "tarih"}
                      dir={sortDir}
                      label="Kayıt tarihi"
                    />
                  </TH>
                  <TH align="right"><span className="sr-only">İşlemler</span></TH>
                </TR>
              </THead>
              <TBody>
                {displayRows.map((c) => {
                  const lead = leadMap.get(c.id);
                  const heat = heatMap.get(c.id);
                  return (
                  <TR key={c.id} interactive>
                    {canBulk ? (
                      <TD className="w-10">
                        {/* checkbox relative z-10 — satır overlay linkiyle çakışmaz */}
                        <CustomerRowCheckbox id={c.id} name={c.full_name} />
                      </TD>
                    ) : null}
                    <TD>
                      <Link href={`/app/musteriler/${c.id}`} className="absolute inset-0" aria-label={`${c.full_name} detayları`} />
                      <div className="flex items-center gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[image:var(--grad-brand)] text-xs font-bold text-white shadow-[var(--shadow-xs)]">
                          {c.full_name.split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <p className="flex items-center gap-1.5 font-semibold text-ink-950">
                            {c.full_name}
                            {lead && !c.blacklist ? (
                              <span
                                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${leadTierCls(lead.tier)}`}
                                title={`Lead skoru: ${lead.score}`}
                              >
                                {lead.tier === "hot" ? "🔥" : lead.tier === "warm" ? "🌤️" : "❄️"} {lead.score}
                              </span>
                            ) : null}
                            {/* Sıcaklık segmenti — title: skor dökümü (hangi bileşen kaç puan);
                                uykudaysa temassız gün sayısı da başlıkta */}
                            {heat ? (
                              <span
                                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${HEAT_SEGMENTS[heat.segment].badgeCls}`}
                                title={heatTitle(heat)}
                              >
                                {HEAT_SEGMENTS[heat.segment].emoji} {HEAT_SEGMENTS[heat.segment].label}
                                {heat.segment === "uykuda" && heat.daysSinceContact !== null
                                  ? ` · ${heat.daysSinceContact} gün`
                                  : ""}
                              </span>
                            ) : null}
                          </p>
                          {c.blacklist ? (
                            <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-danger-500"><span className="h-1.5 w-1.5 rounded-full bg-danger-500" /> Kara liste</p>
                          ) : (
                            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-text-faint"><Clock3 className="h-3 w-3" /> {relativeAdded(c.created_at)}</p>
                          )}
                        </div>
                      </div>
                    </TD>
                    <TD>
                      {c.customer_types && c.customer_types.length > 0 ? (
                        <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-medium text-brand-600">
                          {c.customer_types[0]}
                        </span>
                      ) : (
                        <span className="text-text-faint">—</span>
                      )}
                      {/* Etiketler — ilk 2 chip + kalan sayısı */}
                      {c.tags && c.tags.length > 0 ? (
                        <span className="mt-1 flex flex-wrap items-center gap-1">
                          {c.tags.slice(0, 2).map((t) => (
                            <span key={t} className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-700">
                              {t}
                            </span>
                          ))}
                          {c.tags.length > 2 ? (
                            <span className="text-[10px] font-semibold text-text-faint" title={c.tags.slice(2).join(", ")}>
                              +{c.tags.length - 2}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </TD>
                    <TD>
                      {/* tel/wa/mailto linkleri satır overlay'inin üstünde kalmalı → relative z-10 */}
                      {c.phone ? (
                        <span className="relative z-10 flex items-center gap-1.5">
                          <a
                            href={toTelHref(c.phone) ?? "#"}
                            className="flex items-center gap-2 tabular-nums text-text-muted transition hover:text-brand-600"
                            aria-label={`${c.full_name} numarasını ara`}
                          >
                            <Phone className="h-3.5 w-3.5 text-brand-600" />{formatTurkishPhone(c.phone)}
                          </a>
                          <a
                            href={toWhatsAppLink(c.phone) ?? "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`${c.full_name} ile WhatsApp görüşmesi`}
                            className="grid h-6 w-6 min-h-9 min-w-9 place-items-center rounded-full text-mint-600 transition hover:bg-mint-500/10"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                          </a>
                        </span>
                      ) : (
                        <p className="flex items-center gap-2 tabular-nums text-text-muted"><Phone className="h-3.5 w-3.5 text-brand-600" />—</p>
                      )}
                      {c.email ? (
                        <a
                          href={`mailto:${c.email}`}
                          className="relative z-10 mt-1 flex w-fit items-center gap-2 text-xs text-text-faint transition hover:text-brand-600"
                          aria-label={`${c.full_name} adresine e-posta gönder`}
                        >
                          <Mail className="h-3.5 w-3.5" />{c.email}
                        </a>
                      ) : null}
                    </TD>
                    <TD className="text-text-muted">
                      <span className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-text-faint" />{provinceName(c.province)}</span>
                    </TD>
                    <TD className="text-text-muted">
                      <span className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5 text-text-faint" />{formatDate(c.created_at)}</span>
                    </TD>
                    <TD>
                      <div className="relative z-10 flex items-center justify-end gap-1">
                        {/* Müşteri portalı linki — createCustomerPortalToken'ın
                            tek girişi. Action customers.edit istiyor, buton da
                            aynı kapıyla gösterilir. */}
                        {canEdit ? (
                          <CustomerPortalLinkButton
                            customerId={c.id}
                            customerName={c.full_name}
                            phone={c.phone}
                          />
                        ) : null}
                        {canDelete ? <CustomerRowDelete customerId={c.id} name={c.full_name} /> : null}
                        <span className="grid h-8 w-8 place-items-center rounded-[9px] text-text-faint transition group-hover:bg-brand-600/10 group-hover:text-brand-600">
                          <ArrowUpRight className="h-4 w-4" />
                        </span>
                      </div>
                    </TD>
                  </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableFrame>
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
