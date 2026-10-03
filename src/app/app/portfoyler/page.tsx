import Link from "next/link";
import { IntentLink } from "@/components/app/intent-link";
import { redirect } from "next/navigation";
import Image from "next/image";
import { inFilter, orIlike, safeLike } from "@/lib/pgrst";
import {
  ArrowUpRight,
  Banknote,
  Building2,
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  Gauge,
  LayoutGrid,
  List as ListIcon,
  Map as MapIcon,
  MapPin,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { exportPropertiesCsv } from "@/app/actions/export";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { listSavedViews } from "@/app/actions/saved-views";
import { SavedViews } from "@/components/app/saved-views";
import { CompareBar } from "@/components/public/compare-select";
import type { CompareItem } from "@/components/public/compare-table";
import { PropertyCompareShell } from "./compare-shell";
import { PropertyBulkBar, PropertyBulkProvider } from "./property-bulk-actions";
import { PropertySortSelect } from "./property-sort-select";
import { PropertyMobileList, PropertyTable, type PropertyVM } from "./property-rows";
import { compactTry, countByType, featureSummary, priceHealthPill, propertyStatusTone } from "./property-list-logic";
import { OwnerPortalLinkButton } from "@/components/app/portal-link-dialog";
import { ListLimitNotice } from "@/components/app/list-limit-notice";
import { EmptyState } from "@/components/app/empty-state";
import { propertyStatusLabel } from "@/lib/property-labels";
import { ICONS } from "@/lib/icons";
import { PageHeader } from "@/components/ui/page-header";
import { HelpTip } from "@/components/ui/help-tip";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CategoryChips,
  FilterGrid,
  FilterSelect,
  KpiStrip,
  ListToolbar,
  WEEK_MS,
  bucketByWeek,
  buildActiveChips,
  densityOf,
  mergeResetPage,
  type KpiItem,
  type ViewOption,
} from "@/components/ui/list-kit";
import { buildHref } from "@/lib/ui/filter-params";
import { DAY_MS, daysAgoIso, msSince, now } from "@/lib/clock";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { fetchLatestRates, formatFx, fxAgeLabel, fxApproxLine } from "@/lib/fx";

// Harita ağır bir client komponenti ve yalnız ?gorunum=harita'da görünür —
// dynamic import ile liste görünümünün ilk yükünden çıkarılır (ayrı chunk).
const MapView = dynamic(() => import("./map-view").then((m) => m.MapView), {
  loading: () => <div className="h-[520px] animate-pulse rounded-[var(--radius-panel)] border border-line bg-ink-950/8" />,
});

type PropertyRow = {
  id: string;
  property_code: string;
  title: string | null;
  transaction_type: string;
  property_type: string;
  status: string;
  list_price: number | null;
  price_health: string | null;
  features: Record<string, unknown> | null;
  created_at: string;
  published_at: string | null;
  province_id: string | null;
  district_id: string | null;
  lat: number | null;
  lng: number | null;
  province: { name: string } | { name: string }[] | null;
  district: { name: string } | { name: string }[] | null;
  portal_listings: { portal_name: string; status: string; last_confirmed_at: string | null }[] | null;
};

type MapRow = {
  id: string;
  property_code: string;
  title: string | null;
  transaction_type: string;
  list_price: number | null;
  lat: number | null;
  lng: number | null;
};

/** supabase-js gomulu iliskiyi dizi olarak tipler; iki bicimi de karsila. */
function relName(value: { name: string } | { name: string }[] | null): string | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0]?.name : value.name) ?? null;
}

/** "Istanbul / Kadikoy" — ilce yoksa yalniz il, ikisi de yoksa uyari metni. */
function locationLabel(row: PropertyRow): string {
  const parts = [relName(row.province), relName(row.district)].filter(Boolean);
  return parts.length ? parts.join(" / ") : "Konum belirtilmedi";
}

function formatPrice(value: number | null, transaction: string) {
  if (value === null) return "Fiyat girilmedi";
  const price = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(value);
  return `${price} ₺${transaction === "rent" || transaction === "Kiralık" ? "/ay" : ""}`;
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

/** Sayfa başına kayıt — gerçek sunucu sayfalaması (200'lük dilim yerine). */
const PAGE_SIZE = 50;
/** Harita görünümü tek seferde en çok bu kadar konumlu portföy çizer. */
const MAP_LIMIT = 1000;
/** Tek hafif tarama (değer toplamı, tip sayaçları, haftalık seri) azami kayıt sayısı. */
const SCAN_LIMIT = 2000;
const TREND_WEEKS = 8;
/** ?eklenen= — son N günde eklenenler (KPI "Son 4 hafta" buraya iner). */
const ADDED_WINDOWS = [7, 28, 90] as const;

/** ?status= kontratı — değerler properties.status kolonuyla (İngilizce + Türkçe eşleri) eşlenir. */
const STATUS_FILTERS = [
  { label: "Tümü", value: "all" },
  { label: "Yayında", value: "live" },
  { label: "Teyit", value: "pending" },
  { label: "Taslak", value: "draft" },
] as const;

const STATUS_DB_VALUES: Record<string, string[]> = {
  live: ["live", "Yayında"],
  pending: ["pending", "teyit", "confirming"],
  draft: ["draft", "taslak"],
};

/** ?saglik= kontratı — değerler properties.price_health kolonuyla (green/yellow/red ve Türkçe eşleri) eşlenir. */
const SAGLIK_FILTERS = [
  { value: "iyi", label: "İyi" },
  { value: "izle", label: "İzle" },
  { value: "riskli", label: "Riskli" },
] as const;
type SaglikValue = (typeof SAGLIK_FILTERS)[number]["value"];

const SAGLIK_DB_VALUES: Record<SaglikValue, string[]> = {
  iyi: ["green", "Yeşil"],
  izle: ["yellow", "Sarı"],
  riskli: ["red", "Kırmızı"],
};

/** price_health kolonunu rozet etiketine çevirir (green/Yeşil → İyi vb.). */
function healthLabel(health: string | null): string {
  return priceHealthPill(health)?.label ?? "Bekliyor";
}

const PAGER_BTN =
  "focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 shadow-[var(--elev-1)] transition hover:bg-canvas";
const PAGER_BTN_DISABLED =
  "inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 opacity-40";

const PATH = "/app/portfoyler";

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
    status?: string;
    saglik?: string;
    gorunum?: string;
    sayfa?: string;
    sirala?: string;
    kategori?: string;
    eklenen?: string;
    yogunluk?: string;
    yeni?: string;
    danisman?: string;
  }>;
}) {
  const { perms } = await requireModulePage("properties");
  const canCreate = (perms.properties ?? []).includes("create");
  const canEditProperty = (perms.properties ?? []).includes("edit");
  const params = (await searchParams) ?? {};
  if (params.yeni === "1") redirect("/app/portfoyler/yeni");
  const q = (params.q ?? "").trim();
  const statusFilter = STATUS_FILTERS.some((f) => f.value === params.status) ? params.status! : "all";
  const saglikFilter = SAGLIK_FILTERS.some((f) => f.value === params.saglik) ? (params.saglik as SaglikValue) : null;
  const view: "liste" | "kart" | "harita" = params.gorunum === "harita" ? "harita" : params.gorunum === "kart" ? "kart" : "liste";
  const kategoriF = (params.kategori ?? "").trim().slice(0, 60);
  const eklenenDays = ADDED_WINDOWS.find((d) => String(d) === params.eklenen) ?? null;
  const density = densityOf(params.yogunluk);
  // Kullanıcı sıralaması: ?sirala=eski|fiyat_yuksek|fiyat_dusuk (varsayılan: yeni=created_at desc)
  const siralaF = ["eski", "fiyat_yuksek", "fiyat_dusuk"].includes(params.sirala ?? "") ? (params.sirala as string) : "";
  const page = Math.max(1, Number.parseInt(params.sayfa ?? "", 10) || 1);
  // ?danisman=<profil id>: danışmana atanmış portföyler (Ekip Merkezi / Kıyas bağlantıları).
  const danismanF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.danisman ?? "") ? params.danisman! : "";
  const offset = (page - 1) * PAGE_SIZE;
  const supabase = await createClient();
  // Bağımsız: sorgularla aynı turda beklenir (aşağıdaki Promise.all).
  const savedViewsPromise = listSavedViews(PATH);

  // Doğrulanmış URL durumu — toolbar, çipler, sayfalama ve kayıtlı görünümler TEK kaynaktan beslenir
  // (geçersiz/bayat paramlar bağlantılara sızmaz).
  const urlParams: Record<string, string> = {};
  if (q) urlParams.q = q;
  if (statusFilter !== "all") urlParams.status = statusFilter;
  if (saglikFilter) urlParams.saglik = saglikFilter;
  if (kategoriF) urlParams.kategori = kategoriF;
  if (danismanF) urlParams.danisman = danismanF;
  if (eklenenDays) urlParams.eklenen = String(eklenenDays);
  if (siralaF) urlParams.sirala = siralaF;
  if (view !== "liste") urlParams.gorunum = view;
  if (density === "kompakt") urlParams.yogunluk = "kompakt";
  const hrefWith = (patch: Record<string, string>) => buildHref(PATH, mergeResetPage(urlParams, patch));
  // Kayıtlı görünümler: yoğunluk kişisel tercih, görünüm kaydına girmez.
  const savedViewParams = Object.fromEntries(Object.entries(urlParams).filter(([k]) => k !== "yogunluk"));

  /*
   * BULUNAN HATA (sessiz veri kaybı): eskiden 200 kayıt çekilip status/sağlık
   * BELLEKTE (array.filter) eleniyor, portal adı araması da bellekte augment
   * ediliyordu. 200'ü aşan ofiste filtre yalnız ilk 200 kayıtta çalışıp
   * kullanıcıya yanlışlıkla "sonuç yok" diyordu; ötesi hiç görünmüyordu.
   * Gerçek sayfalama da yoktu.
   *
   * ÇÖZÜM: bütün kullanıcı filtreleri (durum, sağlık, kategori, eklenme, arama + konum/portal)
   * Supabase sorgusuna itildi; liste gerçek sayfalama ile (range + count)
   * geliyor. Konum ve portal adı önce ilgili tablolarda aranıp bulunan id'ler
   * or() koşuluna ekleniyor (name üzerinde trigram indeksi var, ucuz).
   */
  let qOrClause: string | null = null;
  if (q) {
    const [{ data: provHits }, { data: distHits }, { data: portalHits }] = await Promise.all([
      supabase.from("geo_provinces").select("id").ilike("name", safeLike(q)).limit(20),
      supabase.from("geo_districts").select("id").ilike("name", safeLike(q)).limit(50),
      // Portal adıyla arama artık DB tarafında: eşleşen ilanların property_id'leri
      // ana sorgunun or() koşuluna eklenir (bellekte augment yerine).
      supabase.from("portal_listings").select("property_id").ilike("portal_name", safeLike(q)).limit(500),
    ]);
    const clauses = [orIlike(["property_code", "title", "address_line"], q)];
    const provClause = inFilter("province_id", (provHits ?? []).map((r) => r.id));
    const distClause = inFilter("district_id", (distHits ?? []).map((r) => r.id));
    const portalIds = [
      ...new Set((portalHits ?? []).map((r) => r.property_id as string | null).filter((v): v is string => Boolean(v))),
    ];
    const portalClause = inFilter("id", portalIds);
    if (provClause) clauses.push(provClause);
    if (distClause) clauses.push(distClause);
    if (portalClause) clauses.push(portalClause);
    qOrClause = clauses.join(",");
  }

  const statusValues = statusFilter !== "all" ? STATUS_DB_VALUES[statusFilter] : undefined;
  const saglikValues = saglikFilter ? SAGLIK_DB_VALUES[saglikFilter] : undefined;
  const addedSince = eklenenDays ? daysAgoIso(eklenenDays) : null;

  // Ortak filtre kurucu — deleted_at + durum + kategori + eklenme + arama. Sağlık HARİÇ: sağlık
  // dağılımı çipleri her sağlık değeri için ayrı sayıldığından temel sorguda
  // sağlık filtresi olmaz (aksi halde çip sayıları kendi filtresini yer).
  const buildBaseQuery = (select: string, opts?: { count: "exact"; head?: boolean }) => {
    let query = supabase.from("properties").select(select, opts).is("deleted_at", null);
    if (statusValues) query = query.in("status", statusValues);
    if (kategoriF) query = query.eq("property_type", kategoriF);
    if (addedSince) query = query.gte("created_at", addedSince);
    if (qOrClause) query = query.or(qOrClause);
    if (danismanF) query = query.eq("assigned_to", danismanF);
    return query;
  };
  const buildFilteredQuery = (select: string, opts?: { count: "exact"; head?: boolean }) => {
    let query = buildBaseQuery(select, opts);
    if (saglikValues) query = query.in("price_health", saglikValues);
    return query;
  };

  const filtersEmpty = !statusValues && !qOrClause && !saglikValues && !kategoriF && !addedSince && !danismanF;

  const LIST_COLS =
    "id, property_code, title, transaction_type, property_type, status, list_price, price_health, features, created_at, published_at, province_id, district_id, lat, lng, province:geo_provinces(name), district:geo_districts(name), portal_listings!portal_listings_property_id_fkey(portal_name,status,last_confirmed_at)";
  const MAP_COLS = "id, property_code, title, transaction_type, list_price, lat, lng";

  // Liste/Kart görünümleri sunucu-sayfalı; harita görünümü tüm konumlu sonuçları (cap) çeker.
  const listQuery =
    view !== "harita"
      ? (() => {
          const base = buildFilteredQuery(LIST_COLS);
          const ordered =
            siralaF === "eski"
              ? base.order("created_at", { ascending: true })
              : siralaF === "fiyat_yuksek"
                ? base.order("list_price", { ascending: false, nullsFirst: false })
                : siralaF === "fiyat_dusuk"
                  ? base.order("list_price", { ascending: true, nullsFirst: false })
                  : base.order("created_at", { ascending: false });
          return ordered.range(offset, offset + PAGE_SIZE - 1);
        })()
      : Promise.resolve({ data: null });
  const mapQuery =
    view === "harita"
      ? buildFilteredQuery(MAP_COLS, { count: "exact" })
          .not("lat", "is", null)
          .not("lng", "is", null)
          .order("created_at", { ascending: false })
          .limit(MAP_LIMIT)
      : Promise.resolve({ data: null, count: null });

  // Liste promise'i bir kez başlatılır; kapak sorgusu liste biter bitmez DİĞER sorgularla
  // paralel koşar (eskiden tüm Promise.all'dan sonra seri çalışıyordu).
  const listP = Promise.resolve(listQuery);
  const coversP = listP.then(async (res) => {
    const ids = ((res.data ?? []) as unknown as PropertyRow[]).map((p) => p.id);
    if (ids.length === 0) return [] as { id: string; property_id: string }[];
    const { data: covers } = await supabase
      .from("property_media")
      .select("id, property_id")
      .in("property_id", ids)
      .eq("kind", "image")
      .eq("is_cover", true);
    return (covers ?? []) as { id: string; property_id: string }[];
  });

  const [
    { data },
    { data: mapData, count: mapLocatedTotal },
    { count: filteredTotal },
    fxRates,
    { count: totalCount },
    { count: liveCount },
    { count: portalCount },
    { count: greenCount },
    { count: yellowCount },
    { count: redCount },
    { count: recentCount },
    { data: scanRows },
    typeDefs,
    savedViews,
    coverRows,
  ] = await Promise.all([
    listP,
    mapQuery,
    // Filtrelenmiş gerçek toplam — hem sayfalama ("X-Y / Toplam Z") hem de
    // harita görünümünde konumsuz portföy sayısı için tek doğruluk kaynağı.
    // Filtresizken sorgu "Toplam portföy" KPI'ı ile birebir aynıdır → tekrar sayılmaz.
    filtersEmpty
      ? Promise.resolve({ count: null as number | null })
      : buildFilteredQuery("id", { count: "exact", head: true }),
    // TCMB kuru — yoksa null döner ve döviz satırı hiç basılmaz (uydurma kur yok).
    fetchLatestRates(supabase),
    // KPI sayıları — liste artık sayfalı olduğundan head-count sorgularıyla
    // gerçek toplamlar çekilir (satır taşımaz, yalnızca sayım döner).
    supabase.from("properties").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("properties").select("id", { count: "exact", head: true }).is("deleted_at", null).in("status", STATUS_DB_VALUES.live),
    supabase.from("portal_listings").select("id", { count: "exact", head: true }).eq("status", "live"),
    // Sağlık dağılımı — aktif q+durum bağlamında (sağlık HARİÇ) gerçek sayımlar
    buildBaseQuery("id", { count: "exact", head: true }).in("price_health", SAGLIK_DB_VALUES.iyi),
    buildBaseQuery("id", { count: "exact", head: true }).in("price_health", SAGLIK_DB_VALUES.izle),
    buildBaseQuery("id", { count: "exact", head: true }).in("price_health", SAGLIK_DB_VALUES.riskli),
    // Son 4 haftada eklenen (KPI) — ?eklenen=28 hedefiyle aynı koşul.
    supabase.from("properties").select("id", { count: "exact", head: true }).is("deleted_at", null).gte("created_at", daysAgoIso(28)),
    // Tek hafif tarama: portföy değeri + tip sayaçları + haftalık seri (en yeni SCAN_LIMIT kayıt).
    supabase
      .from("properties")
      .select("list_price, property_type, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(SCAN_LIMIT),
    getDefinitionsOrDefault("property_type"),
    savedViewsPromise,
    coversP,
  ]);

  const rows = (data ?? []) as unknown as PropertyRow[];
  const totalFilteredCount = (filtersEmpty ? totalCount : filteredTotal) ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / PAGE_SIZE));
  const rangeStart = totalFilteredCount === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + rows.length, totalFilteredCount);
  const nowMs = now();

  // Toplam portföy değeri + döviz karşılığı. Türk emlak piyasası fiilen
  // dolarize; ofis sahibi "kaç dolarlık portföyüm var" sorusunu soruyor.
  const scan = (scanRows ?? []) as { list_price: number | null; property_type: string | null; created_at: string }[];
  const totalValueTry = scan.reduce((sum, p) => sum + Number(p.list_price ?? 0), 0);
  const totalValueFx = fxApproxLine(totalValueTry, fxRates);
  const fxTitle = fxRates ? `TCMB ${fxRates.rateDate} satış kuru — ${fxAgeLabel(fxRates.rateDate, now())}` : undefined;
  // Tarama kesildiyse (SCAN_LIMIT) tip sayaçları ve eski haftalar eksik olur → göstermeyiz.
  const scanTruncated = scan.length >= SCAN_LIMIT;
  const oldestScanMs = scan.length ? new Date(scan[scan.length - 1]!.created_at).getTime() : nowMs;
  const typeCounts = scanTruncated ? null : countByType(scan);
  const weeklySeries =
    !scanTruncated || oldestScanMs <= nowMs - TREND_WEEKS * WEEK_MS
      ? bucketByWeek(scan.map((r) => r.created_at), nowMs, TREND_WEEKS)
      : undefined;

  // Kapak görselleri — tek ek sorgu; property_id -> media id eşlemesi.
  // Görsel tenant/yetki kontrollü download ucu üzerinden servis edilir.
  const coverByProperty = new Map<string, string>();
  for (const cover of coverRows) {
    if (!coverByProperty.has(cover.property_id)) coverByProperty.set(cover.property_id, cover.id);
  }

  // Fiyat sağlığı dağılımı — head-count sorgularından (gerçek toplamlar).
  const greenN = greenCount ?? 0;
  const yellowN = yellowCount ?? 0;
  const redN = redCount ?? 0;
  const warningCount = yellowN + redN;
  const healthKnownTotal = greenN + yellowN + redN;
  const healthTotal = Math.max(1, healthKnownTotal);
  const healthSegments: { label: string; param: SaglikValue; count: number; bar: string; dot: string; delay: string }[] = [
    { label: "İyi", param: "iyi", count: greenN, bar: "bg-mint-500", dot: "bg-mint-400", delay: "0s" },
    { label: "İzle", param: "izle", count: yellowN, bar: "bg-amber-400", dot: "bg-amber-400", delay: "0.12s" },
    { label: "Riskli", param: "riskli", count: redN, bar: "bg-danger-500", dot: "bg-danger-500", delay: "0.24s" },
  ];

  // Sayfalama linki — aktif filtreleri koruyarak yalnız ?sayfa= değiştirir.
  const pageHref = (target: number) => {
    const sp = mergeResetPage(urlParams, {});
    if (target > 1) sp.set("sayfa", String(target));
    return buildHref(PATH, sp);
  };

  // Harita görünümü verisi — konumlu sonuçlar (cap); konumsuz portföy sayısı bildirilir.
  const mapRows = (mapData ?? []) as unknown as MapRow[];
  const mapProperties = mapRows.map((p) => ({
    id: p.id,
    title: p.title ?? p.property_code,
    price: formatPrice(p.list_price, p.transaction_type),
    lat: Number(p.lat),
    lng: Number(p.lng),
  }));
  const missingCoordCount = Math.max(0, totalFilteredCount - (mapLocatedTotal ?? 0));

  // ---- Satır modelleri (tablo + mobil liste + kart ortak veri) --------------
  const viewModels: PropertyVM[] = rows.map((property) => {
    const portals = property.portal_listings ?? [];
    const coverId = coverByProperty.get(property.id);
    const feat = (property.features ?? {}) as { rooms?: string; sqm?: number; floor?: number | string; building_age?: number | string };
    const title = property.title ?? property.property_code;
    const compareItem: CompareItem = {
      id: property.id,
      title: `${title} · Fiyat sağlığı: ${healthLabel(property.price_health)}`,
      href: `/app/portfoyler/${property.id}`,
      coverId: coverId ?? null,
      coverSrc: coverId ? `/api/property-media/${coverId}/download` : null,
      price: property.list_price != null ? Number(property.list_price) : null,
      tx: property.transaction_type,
      rooms: feat.rooms ?? null,
      sqm: feat.sqm ?? null,
      floor: feat.floor ?? null,
      buildingAge: feat.building_age ?? null,
      district: relName(property.district),
    };
    return {
      id: property.id,
      code: property.property_code,
      title,
      href: `/app/portfoyler/${property.id}`,
      coverSrc: coverId ? `/api/property-media/${coverId}/download` : null,
      subtitle: featureSummary(property.features),
      tx: property.transaction_type,
      type: property.property_type,
      location: locationLabel(property),
      price: formatPrice(property.list_price, property.transaction_type),
      statusLabel: propertyStatusLabel(property.status),
      statusTone: propertyStatusTone(property.status),
      health: priceHealthPill(property.price_health),
      portalsLive: portals.filter((p) => p.status === "live").length,
      portalsTotal: portals.length,
      createdLabel: formatDate(property.created_at),
      // Son 7 günde yayına giren portföy — published_at gerçek yayın damgası (vitrindeki rozetle aynı kural)
      isNew: property.published_at != null && msSince(property.published_at) < 7 * DAY_MS,
      compareItem,
    };
  });
  const pageIds = viewModels.map((v) => v.id);

  // ---- KPI şeridi: yalnız gerçekten hesaplanan sayılar ----------------------
  const total = totalCount ?? 0;
  const kpis: KpiItem[] = [
    {
      label: "Toplam portföy",
      value: total,
      icon: <Building2 />,
      tone: "info",
      href: PATH,
      series: weeklySeries,
      showTrend: true,
      seriesLabel: "önceki 4 haftaya göre",
      hint: "kayıtlı portföy",
    },
    {
      label: "Aktif portföy",
      value: liveCount ?? 0,
      icon: <FileCheck2 />,
      tone: "success",
      href: buildHref(PATH, new URLSearchParams({ ...(q ? { q } : {}), status: "live" })),
      hint: total > 0 ? `toplamın %${Math.round(((liveCount ?? 0) / total) * 100)}'i` : undefined,
    },
    {
      label: "Son 4 hafta eklenen",
      value: recentCount ?? 0,
      icon: <Sparkles />,
      tone: "neutral",
      href: buildHref(PATH, new URLSearchParams({ eklenen: "28" })),
      hint: "yeni kayıt",
    },
    {
      label: "Portföy değeri",
      value: compactTry(totalValueTry),
      icon: <Banknote />,
      tone: "success",
      href: buildHref(PATH, new URLSearchParams({ sirala: "fiyat_yuksek" })),
      hint: totalValueFx ?? (scanTruncated ? `en yeni ${SCAN_LIMIT.toLocaleString("tr-TR")} kayıt` : undefined),
      title: [formatFx(totalValueTry, "TRY"), fxTitle].filter(Boolean).join(" · ") || undefined,
    },
    {
      label: "Fiyat uyarısı",
      value: warningCount,
      icon: <ICONS.alarm />,
      tone: "warning",
      attention: true,
      href: hrefWith({ saglik: "riskli", gorunum: "", sayfa: "" }),
      hint: `${yellowN} izle · ${redN} riskli`,
    },
    {
      label: "Canlı portal",
      value: portalCount ?? 0,
      icon: <ICONS.portal />,
      tone: "info",
      href: "/app/portallar?durum=live",
      hint: "yayındaki ilan",
    },
  ];

  const views: ViewOption[] = [
    { value: "liste", label: "Liste", icon: ListIcon, href: hrefWith({ gorunum: "", sayfa: "" }) },
    { value: "kart", label: "Kart", icon: LayoutGrid, href: hrefWith({ gorunum: "kart", sayfa: "" }) },
    { value: "harita", label: "Harita", icon: MapIcon, href: hrefWith({ gorunum: "harita", sayfa: "" }) },
  ];

  const chips = buildActiveChips(PATH, urlParams, [
    { key: "q", label: "Arama" },
    { key: "status", label: "Durum", format: (v) => STATUS_FILTERS.find((f) => f.value === v)?.label ?? v },
    { key: "saglik", label: "Fiyat sağlığı", format: (v) => SAGLIK_FILTERS.find((f) => f.value === v)?.label ?? v },
    { key: "kategori", label: "Tip" },
    { key: "eklenen", label: "Eklenme", format: (v) => `son ${v} gün` },
  ]);
  const anyFilter = chips.length > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Portföyler"
        description={<>Fiyat sağlığı, portal teyidi ve yetki durumu tek merkezde. <HelpTip topic="fiyat-sagligi" /></>}
        actions={
          <>
            <ExportCsvButton
              action={exportPropertiesCsv}
              label="Dışa aktar"
              className="focus-ring press inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-hairline-strong bg-surface px-4 text-sm font-semibold text-ink-950 transition hover:bg-canvas disabled:opacity-50"
            />
            {canCreate ? <ButtonLink href="/app/portfoyler/yeni"><Plus className="h-4 w-4" /> Yeni portföy</ButtonLink> : null}
          </>
        }
      />

      {/* İlgili ekranlar — ikincil gezinme */}
      <div className="-mt-2 flex flex-wrap items-center gap-1">
        <ButtonLink href="/app/yabanci-satis" variant="ghost" size="sm">Yabancıya satış</ButtonLink>
        <ButtonLink href="/app/portfoyler/sunumlar" variant="ghost" size="sm">Sunumlar &amp; portallar</ButtonLink>
        <ButtonLink href="/app/portfoyler/anahtarlar" variant="ghost" size="sm">Anahtarlar</ButtonLink>
      </div>

      {/* KPI şeridi — hepsi tıklanabilir; çubuk/trend yalnız gerçek haftalık kayıt serisinden */}
      <KpiStrip items={kpis} />

      <ListToolbar
        pathname={PATH}
        params={urlParams}
        views={views}
        activeView={view}
        searchPlaceholder="Kod, başlık, portal veya konum ara…"
        searchLabel="Portföy ara"
        panelParamKeys={["status", "saglik", "eklenen"]}
        panel={
          <FilterGrid>
            <FilterSelect
              name="status"
              label="Durum"
              value={statusFilter === "all" ? "" : statusFilter}
              options={STATUS_FILTERS.map((f) => ({ value: f.value === "all" ? "" : f.value, label: f.label }))}
            />
            <FilterSelect
              name="saglik"
              label="Fiyat sağlığı"
              value={saglikFilter ?? ""}
              options={[{ value: "", label: "Tümü" }, ...SAGLIK_FILTERS.map((f) => ({ value: f.value, label: f.label }))]}
            />
            <FilterSelect
              name="eklenen"
              label="Eklenme"
              value={eklenenDays ? String(eklenenDays) : ""}
              options={[{ value: "", label: "Tümü" }, ...ADDED_WINDOWS.map((d) => ({ value: String(d), label: `Son ${d} gün` }))]}
            />
          </FilterGrid>
        }
        sort={view !== "harita" && total > 0 ? <PropertySortSelect value={siralaF} /> : undefined}
        densityParam={view === "liste" ? "yogunluk" : undefined}
        chips={chips}
        resultCount={anyFilter ? totalFilteredCount : undefined}
        resultNoun="sonuç"
        savedViews={<SavedViews route={PATH} views={savedViews} currentParams={savedViewParams} />}
      />

      {/* Tip çipleri (sunucu filtresi, ?kategori=) + fiyat sağlığı dağılımı */}
      {total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <CategoryChips
            className="min-w-0 max-w-full"
            options={typeDefs.map((d) => ({ value: d.value, label: d.label }))}
            counts={typeCounts}
            total={total}
            active={kategoriF}
            pathname={PATH}
            params={urlParams}
            label="Portföy tipi"
          />
          {healthKnownTotal > 0 ? (
            <div className="flex min-w-[15rem] items-center gap-3" aria-label="Fiyat sağlığı dağılımı">
              <Gauge aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-600" />
              <div className="flex h-2 w-24 shrink-0 gap-0.5 overflow-hidden rounded-full bg-canvas">
                {healthSegments.map((s) => (
                  <div key={s.label} className={`pipeline-fill h-full ${s.bar}`} style={{ width: `${(s.count / healthTotal) * 100}%`, animationDelay: s.delay }} />
                ))}
              </div>
              <div className="flex gap-1">
                {healthSegments.map((s) => (
                  <Link
                    key={s.label}
                    href={hrefWith({ saglik: saglikFilter === s.param ? "" : s.param, sayfa: "" })}
                    aria-current={saglikFilter === s.param ? "true" : undefined}
                    className={`focus-ring press inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition hover:bg-canvas ${
                      saglikFilter === s.param ? "border-brand-400 bg-brand-600/10 text-brand-700" : "border-line text-text-muted"
                    } ${s.count === 0 ? "opacity-55" : ""}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                    {s.label} <span className="numeric text-text">{s.count}</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {total === 0 ? (
        <EmptyState
          icon={ICONS.portfoy}
          illustration="start"
          title="Portföy merkezinizi kurun"
          description="İlk portföyünüzü ekleyin; fiyat sağlığı, portal teyidi ve yetki süresi otomatik izlenmeye başlasın."
          action={
            canCreate
              ? {
                  node: (
                    <ButtonLink href="/app/portfoyler/yeni"><Plus className="h-4 w-4" /> Yeni portföy</ButtonLink>
                  ),
                }
              : undefined
          }
          secondary={{ href: "/app/degerleme", label: "Önce değerleme yap" }}
        />
      ) : totalFilteredCount === 0 ? (
        <EmptyState
          icon={Search}
          illustration="search"
          title="Sonuç bulunamadı"
          description="Arama veya filtre kriterlerinize uyan portföy yok. Filtreyi temizleyip tekrar deneyin."
          action={{ href: PATH, label: "Filtreyi temizle" }}
          secondary={{ href: "/app/talepler", label: "Talep havuzuna bak" }}
        />
      ) : view === "harita" ? (
        <>
          <ListLimitNotice shown={mapRows.length} total={mapLocatedTotal} hint="Haritada en fazla bu kadar konum çizilir; listeyi filtreyle daraltın." />
          <MapView properties={mapProperties} missingCount={missingCoordCount} />
        </>
      ) : (
        <>
          {view === "liste" ? (
            /* key: sayfa/filtre değişince seçim sıfırlanır — bayat id'lerle toplu işlem yapılmasın */
            <PropertyBulkProvider key={`${page}|${Object.values(urlParams).join("|")}`}>
              {canEditProperty ? <PropertyBulkBar /> : null}
              <PropertyTable rows={viewModels} ids={pageIds} canBulk={canEditProperty} canEdit={canEditProperty} density={density} />
              <PropertyMobileList rows={viewModels} />
            </PropertyBulkProvider>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((property, i) => {
                const vm = viewModels[i]!;
                const portals = property.portal_listings ?? [];
                const healthGood = property.price_health === "green" || property.price_health === "Yeşil";
                return (
                  <PropertyCompareShell
                    key={property.id}
                    item={vm.compareItem}
                    actions={
                      /* Malik portalı linki — createOwnerPortalToken'ın tek girişi.
                         Action properties.edit istiyor, buton da aynı kapıda. */
                      canEditProperty ? (
                        <OwnerPortalLinkButton propertyId={property.id} propertyLabel={vm.title} />
                      ) : null
                    }
                  >
                    <IntentLink
                      href={vm.href}
                      className="group overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)] transition hover:-translate-y-1 hover:border-brand-300 hover:shadow-[var(--shadow-card)]"
                    >
                      <div className="relative flex h-36 items-center justify-center overflow-hidden bg-[image:var(--grad-brand-soft)]">
                        {vm.coverSrc ? (
                          <Image
                            src={vm.coverSrc}
                            alt={vm.title}
                            fill
                            sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                            className="object-cover transition duration-500 group-hover:scale-105"
                            unoptimized
                          />
                        ) : (
                          <>
                            <div className="pointer-events-none absolute inset-0 dot-overlay opacity-60" />
                            <Building2 className="h-12 w-12 text-brand-600/35 transition duration-500 group-hover:scale-110" />
                          </>
                        )}
                        <span className="absolute left-3 top-3 flex max-w-[60%] items-center gap-1.5">
                          <span className="truncate rounded-full bg-surface/90 px-2.5 py-1 text-xs font-bold text-ink-950 shadow-[var(--shadow-xs)] backdrop-blur">{property.property_code}</span>
                          {vm.isNew ? (
                            <span className="shrink-0 rounded-full bg-mint-500 px-2 py-0.5 text-xs font-bold text-white shadow-[var(--shadow-xs)]">Yeni</span>
                          ) : null}
                        </span>
                        {/* Fiyat sağlığı — ham değer yerine Türkçe etiket, kesilmez; bilinmiyorsa gösterilmez */}
                        {vm.health ? (
                          <Badge
                            variant={healthGood ? "success" : vm.health.tone === "danger" ? "danger" : "warning"}
                            dot
                            className="absolute right-3 top-3 whitespace-nowrap bg-surface/90 shadow-[var(--shadow-xs)]"
                          >
                            Fiyat: {vm.health.label}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.08em] text-brand-600">{vm.tx} · {vm.type}</p>
                            <h2 className="mt-1 font-display text-lg font-bold text-ink-950">{vm.title}</h2>
                            <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted"><MapPin className="h-3.5 w-3.5" />{vm.location}</p>
                          </div>
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-canvas text-text-faint transition group-hover:bg-brand-600/10 group-hover:text-brand-600" aria-hidden><ArrowUpRight className="h-4 w-4" /></span>
                        </div>
                        <p className="mt-4 font-display text-2xl font-extrabold text-ink-950">{vm.price}</p>
                        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4">
                          <span className="flex items-center gap-2 text-xs text-text-muted"><FileCheck2 className="h-4 w-4 text-mint-600" />{vm.statusLabel}</span>
                          <span className="flex items-center justify-end gap-2 text-xs text-text-muted"><Gauge className="h-4 w-4 text-brand-600" />{portals.length} portal</span>
                        </div>
                      </div>
                    </IntentLink>
                  </PropertyCompareShell>
                );
              })}
            </div>
          )}

          {/* Sayfalama — filtre parametreleri linklerde korunur */}
          {totalFilteredCount > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <p className="numeric text-text-muted">
                {rangeStart.toLocaleString("tr-TR")}–{rangeEnd.toLocaleString("tr-TR")} / Toplam{" "}
                {totalFilteredCount.toLocaleString("tr-TR")}
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

          {/* Karşılaştırma alt çubuğu + tam ekran tablo — seçim varken görünür (oturumluk) */}
          <CompareBar />
        </>
      )}
    </div>
  );
}
