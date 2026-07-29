import Link from "next/link";
import Image from "next/image";
import { inFilter, orIlike, safeLike } from "@/lib/pgrst";
import {
  ArrowUpRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  Gauge,
  LayoutGrid,
  Map as MapIcon,
  MapPin,
  Radio,
  Search,
} from "lucide-react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { getDefinitions } from "@/lib/definitions";
import { getProvincesCached } from "@/lib/geo";
import { exportPropertiesCsv } from "@/app/actions/export";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { listSavedViews } from "@/app/actions/saved-views";
import { SavedViews } from "@/components/app/saved-views";
import { CompareBar } from "@/components/public/compare-select";
import type { CompareItem } from "@/components/public/compare-table";
import { NewPropertyDialog } from "./new-property-dialog";
import { PropertyCompareShell } from "./compare-shell";
import { PropertyBulkActions } from "./property-bulk-actions";
import { OwnerPortalLinkButton } from "@/components/app/portal-link-dialog";
import { ListLimitNotice } from "@/components/app/list-limit-notice";
import { EmptyState } from "@/components/app/empty-state";
import { ICONS } from "@/lib/icons";
import { DAY_MS, msSince, now } from "@/lib/clock";
import { fetchLatestRates, formatFx, fxAgeLabel, fxApproxLine } from "@/lib/fx";

// Harita ağır bir client komponenti ve yalnız ?gorunum=harita'da görünür —
// dynamic import ile liste görünümünün ilk yükünden çıkarılır (ayrı chunk).
const MapView = dynamic(() => import("./map-view").then((m) => m.MapView), {
  loading: () => <div className="h-[520px] animate-pulse rounded-[20px] border border-line bg-ink-950/8" />,
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

/** Sayfa başına kayıt — gerçek sunucu sayfalaması (200'lük dilim yerine). */
const PAGE_SIZE = 50;
/** Harita görünümü tek seferde en çok bu kadar konumlu portföy çizer. */
const MAP_LIMIT = 1000;
/** Toplam portföy değeri hesabında taranan azami kayıt (tek kolon, hafif). */
const VALUE_SUM_LIMIT = 2000;

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
  if (health === "green" || health === "Yeşil") return "İyi";
  if (health === "yellow" || health === "Sarı") return "İzle";
  if (health === "red" || health === "Kırmızı") return "Riskli";
  return "Bekliyor";
}

const PAGER_BTN =
  "focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 shadow-[var(--elev-1)] transition hover:bg-canvas";
const PAGER_BTN_DISABLED =
  "inline-flex items-center gap-1 rounded-[9px] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 opacity-40";

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; status?: string; saglik?: string; gorunum?: string; sayfa?: string }>;
}) {
  const { perms } = await requireModulePage("properties");
  const canCreate = (perms.properties ?? []).includes("create");
  const canEditProperty = (perms.properties ?? []).includes("edit");
  const params = (await searchParams) ?? {};
  const q = (params.q ?? "").trim();
  const statusFilter = STATUS_FILTERS.some((f) => f.value === params.status) ? params.status! : "all";
  const saglikFilter = SAGLIK_FILTERS.some((f) => f.value === params.saglik) ? (params.saglik as SaglikValue) : null;
  const view = params.gorunum === "harita" ? "harita" : "liste";
  const page = Math.max(1, Number.parseInt(params.sayfa ?? "", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const supabase = await createClient();
  const savedViews = await listSavedViews("/app/portfoyler");
  // Kayıtlı görünümler için aktif filtre paramları (varsayılanlar hariç)
  const savedViewParams: Record<string, string> = {};
  if (q) savedViewParams.q = q;
  if (statusFilter !== "all") savedViewParams.status = statusFilter;
  if (saglikFilter) savedViewParams.saglik = saglikFilter;
  if (view === "harita") savedViewParams.gorunum = "harita";

  /*
   * BULUNAN HATA (sessiz veri kaybı): eskiden 200 kayıt çekilip status/sağlık
   * BELLEKTE (array.filter) eleniyor, portal adı araması da bellekte augment
   * ediliyordu. 200'ü aşan ofiste filtre yalnız ilk 200 kayıtta çalışıp
   * kullanıcıya yanlışlıkla "sonuç yok" diyordu; ötesi hiç görünmüyordu.
   * Gerçek sayfalama da yoktu.
   *
   * ÇÖZÜM: bütün kullanıcı filtreleri (durum, sağlık, arama + konum/portal)
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

  // Ortak filtre kurucu — deleted_at + durum + arama. Sağlık HARİÇ: sağlık
  // dağılımı çipleri her sağlık değeri için ayrı sayıldığından temel sorguda
  // sağlık filtresi olmaz (aksi halde çip sayıları kendi filtresini yer).
  const buildBaseQuery = (select: string, opts?: { count: "exact"; head?: boolean }) => {
    let query = supabase.from("properties").select(select, opts).is("deleted_at", null);
    if (statusValues) query = query.in("status", statusValues);
    if (qOrClause) query = query.or(qOrClause);
    return query;
  };
  const buildFilteredQuery = (select: string, opts?: { count: "exact"; head?: boolean }) => {
    let query = buildBaseQuery(select, opts);
    if (saglikValues) query = query.in("price_health", saglikValues);
    return query;
  };

  const LIST_COLS =
    "id, property_code, title, transaction_type, property_type, status, list_price, price_health, features, created_at, published_at, province_id, district_id, lat, lng, province:geo_provinces(name), district:geo_districts(name), portal_listings(portal_name,status,last_confirmed_at)";
  const MAP_COLS = "id, property_code, title, transaction_type, list_price, lat, lng";

  // Liste görünümü sunucu-sayfalı; harita görünümü tüm konumlu sonuçları (cap) çeker.
  const listQuery =
    view === "liste"
      ? buildFilteredQuery(LIST_COLS)
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1)
      : Promise.resolve({ data: null });
  const mapQuery =
    view === "harita"
      ? buildFilteredQuery(MAP_COLS, { count: "exact" })
          .not("lat", "is", null)
          .not("lng", "is", null)
          .order("created_at", { ascending: false })
          .limit(MAP_LIMIT)
      : Promise.resolve({ data: null, count: null });

  const [
    { data },
    { data: mapData, count: mapLocatedTotal },
    { count: filteredTotal },
    provinces,
    { data: branches },
    propertyTypeDefs,
    transactionTypeDefs,
    fxRates,
    { count: totalCount },
    { count: liveCount },
    { count: portalCount },
    { count: greenCount },
    { count: yellowCount },
    { count: redCount },
    { data: valueRows },
  ] = await Promise.all([
    listQuery,
    mapQuery,
    // Filtrelenmiş gerçek toplam — hem sayfalama ("X-Y / Toplam Z") hem de
    // harita görünümünde konumsuz portföy sayısı için tek doğruluk kaynağı.
    buildFilteredQuery("id", { count: "exact", head: true }),
    // İl listesi 81 satırlık sabit referans verisi — istekler arası cache'li (src/lib/geo.ts)
    getProvincesCached(),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    getDefinitions("property_type"),
    getDefinitions("transaction_type"),
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
    // Toplam portföy değeri — hafif tek kolon; sayfa dilimi değil (makul üst sınırla).
    supabase.from("properties").select("list_price").is("deleted_at", null).limit(VALUE_SUM_LIMIT),
  ]);

  const rows = (data ?? []) as unknown as PropertyRow[];
  const totalFilteredCount = filteredTotal ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / PAGE_SIZE));
  const rangeStart = totalFilteredCount === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + rows.length, totalFilteredCount);

  // Toplam portföy değeri + döviz karşılığı. Türk emlak piyasası fiilen
  // dolarize; ofis sahibi "kaç dolarlık portföyüm var" sorusunu soruyor.
  const totalValueTry = (valueRows ?? []).reduce(
    (sum, p) => sum + Number((p as { list_price: number | null }).list_price ?? 0),
    0,
  );
  const totalValueFx = fxApproxLine(totalValueTry, fxRates);
  const fxTitle = fxRates ? `TCMB ${fxRates.rateDate} satış kuru — ${fxAgeLabel(fxRates.rateDate, now())}` : undefined;

  // Kapak görselleri — tek ek sorgu; property_id -> media id eşlemesi.
  // Görsel /api/property-media/[id] üzerinden servis edilir (medya yöneticisiyle aynı yol).
  const coverByProperty = new Map<string, string>();
  if (rows.length > 0) {
    const { data: covers } = await supabase
      .from("property_media")
      .select("id, property_id")
      .in("property_id", rows.map((p) => p.id))
      .eq("kind", "image")
      .eq("is_cover", true);
    for (const cover of (covers ?? []) as { id: string; property_id: string }[]) {
      if (!coverByProperty.has(cover.property_id)) coverByProperty.set(cover.property_id, cover.id);
    }
  }

  const provinceList = provinces;
  const branchList = branches ?? [];
  const propertyTypeOptions = propertyTypeDefs.length ? propertyTypeDefs.map((d) => d.value) : undefined;
  const transactionTypeOptions = transactionTypeDefs.length ? transactionTypeDefs.map((d) => d.value) : undefined;

  // Fiyat sağlığı dağılımı — head-count sorgularından (gerçek toplamlar).
  const greenN = greenCount ?? 0;
  const yellowN = yellowCount ?? 0;
  const redN = redCount ?? 0;
  const warningCount = yellowN + redN;
  const healthKnownTotal = greenN + yellowN + redN;
  const healthTotal = Math.max(1, healthKnownTotal);
  const healthSegments: { label: string; param: SaglikValue; count: number; bar: string; dot: string; text: string; delay: string }[] = [
    { label: "İyi", param: "iyi", count: greenN, bar: "bg-mint-500", dot: "bg-mint-400", text: "text-mint-400", delay: "0s" },
    { label: "İzle", param: "izle", count: yellowN, bar: "bg-amber-400", dot: "bg-amber-400", text: "text-amber-300", delay: "0.12s" },
    { label: "Riskli", param: "riskli", count: redN, bar: "bg-danger-500", dot: "bg-danger-500", text: "text-danger-400", delay: "0.24s" },
  ];

  // Mevcut q/status bağlamını koruyarak ?saglik= linki üret (kayip-kacak filterHref deseni).
  const saglikHref = (value: SaglikValue) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (statusFilter !== "all") sp.set("status", statusFilter);
    sp.set("saglik", value);
    if (view === "harita") sp.set("gorunum", "harita");
    return `/app/portfoyler?${sp.toString()}`;
  };

  // Liste/Harita toggle linki — aktif filtreleri (q/status/saglik) koruyarak görünüm değiştirir.
  const viewHref = (value: "liste" | "harita") => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (statusFilter !== "all") sp.set("status", statusFilter);
    if (saglikFilter) sp.set("saglik", saglikFilter);
    if (value === "harita") sp.set("gorunum", "harita");
    const qs = sp.toString();
    return qs ? `/app/portfoyler?${qs}` : "/app/portfoyler";
  };

  // Sayfalama linki — aktif filtreleri koruyarak yalnız ?sayfa= değiştirir.
  const pageHref = (target: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (statusFilter !== "all") sp.set("status", statusFilter);
    if (saglikFilter) sp.set("saglik", saglikFilter);
    if (target > 1) sp.set("sayfa", String(target));
    const qs = sp.toString();
    return qs ? `/app/portfoyler?${qs}` : "/app/portfoyler";
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

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-12 -top-20 h-60 w-60 rounded-full bg-mint-500/25 blur-[80px]" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400"><Radio className="h-3.5 w-3.5" /> Portföy ağı canlı</span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Portföy operasyonu</h1>
            <p className="mt-1 text-sm text-white/60">Fiyat sağlığı, portal teyidi ve yetki durumu tek merkezde.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center overflow-hidden rounded-[11px] border border-white/12 bg-white/8 backdrop-blur">
              {(
                [
                  { label: "Liste", value: "liste", icon: LayoutGrid },
                  { label: "Harita", value: "harita", icon: MapIcon },
                ] as const
              ).map((option) => (
                <Link
                  key={option.value}
                  href={viewHref(option.value)}
                  aria-current={view === option.value ? "page" : undefined}
                  className={`focus-ring press inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold transition ${
                    view === option.value ? "bg-white/15 text-white" : "text-white/60 hover:text-white"
                  }`}
                >
                  <option.icon className="h-4 w-4" />
                  {option.label}
                </Link>
              ))}
            </div>
            <Link href="/app/yabanci-satis" className="focus-ring press inline-flex items-center gap-1.5 rounded-[11px] border border-white/12 bg-white/8 px-3.5 py-2.5 text-sm font-semibold text-white/80 backdrop-blur transition hover:border-white/30 hover:text-white">Yabancıya satış</Link>
            <Link href="/app/portfoyler/sunumlar" className="focus-ring press inline-flex items-center gap-1.5 rounded-[11px] border border-white/12 bg-white/8 px-3.5 py-2.5 text-sm font-semibold text-white/80 backdrop-blur transition hover:border-white/30 hover:text-white">Sunumlar &amp; portallar</Link>
            <Link href="/app/portfoyler/anahtarlar" className="focus-ring press inline-flex items-center gap-1.5 rounded-[11px] border border-white/12 bg-white/8 px-3.5 py-2.5 text-sm font-semibold text-white/80 backdrop-blur transition hover:border-white/30 hover:text-white">Anahtarlar</Link>
            <ExportCsvButton
              action={exportPropertiesCsv}
              label="Dışa aktar"
              className="focus-ring press inline-flex items-center gap-1.5 rounded-[11px] border border-white/12 bg-white/8 px-3.5 py-2.5 text-sm font-semibold text-white/80 backdrop-blur transition hover:border-white/30 hover:text-white disabled:opacity-50"
            />
            {canCreate ? <NewPropertyDialog provinces={provinceList} branches={branchList} propertyTypes={propertyTypeOptions} transactionTypes={transactionTypeOptions} /> : null}
          </div>
        </div>
        {/* Toplam portföy değeri + döviz karşılığı — kur yoksa satır hiç çizilmez */}
        <p className="relative mt-5 text-sm text-white/70" title={fxTitle}>
          Toplam portföy değeri{" "}
          <span className="font-display font-extrabold text-white">{formatFx(totalValueTry, "TRY")}</span>
          {totalValueFx ? <span className="ml-2 text-xs text-white/45">{totalValueFx}</span> : null}
        </p>
        <div className="relative mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="stagger-grid grid grid-cols-3 gap-3">
            {[
              // İkonografi: "canlı portal" CircleCheck ile çiziliyordu; portal
              // kavramının tek ikonu ICONS.portal (RadioTower) — sidebar ve
              // raporlar ekranıyla aynı.
              { label: "Aktif portföy", value: liveCount ?? 0, icon: ICONS.portfoy, href: q ? `/app/portfoyler?q=${encodeURIComponent(q)}&status=live` : "/app/portfoyler?status=live" },
              { label: "Canlı portal", value: portalCount ?? 0, icon: ICONS.portal, href: "/app/portallar?durum=live" },
              { label: "Fiyat uyarısı", value: warningCount, icon: ICONS.alarm, href: saglikHref("riskli") },
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
              <p className="flex items-center gap-1.5 text-xs font-semibold text-white/75"><Gauge className="h-3.5 w-3.5 text-mint-400" /> Fiyat sağlığı dağılımı</p>
              <span className="text-[11px] text-white/45">{healthKnownTotal} portföy</span>
            </div>
            <div className="mt-4 flex h-3 gap-0.5 overflow-hidden rounded-full bg-white/10">
              {healthSegments.map((s) => (
                <div key={s.label} className={`pipeline-fill h-full ${s.bar}`} style={{ width: `${(s.count / healthTotal) * 100}%`, animationDelay: s.delay }} />
              ))}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {healthSegments.map((s) => (
                <Link
                  key={s.label}
                  href={saglikHref(s.param)}
                  className={`focus-ring press group relative block rounded-[10px] border bg-white/[0.03] px-2 py-2 text-center transition hover:border-white/30 ${
                    saglikFilter === s.param ? "border-white/40" : "border-white/8"
                  }`}
                >
                  <ArrowUpRight className="hover-action absolute right-1.5 top-1.5 h-3 w-3 text-white/50 opacity-0 transition group-hover:opacity-100" />
                  <span className={`mx-auto block h-1.5 w-1.5 rounded-full ${s.dot}`} />
                  <p className={`mt-1.5 font-display text-lg font-extrabold ${s.text}`}>{s.count}</p>
                  <p className="text-[11px] text-white/45">{s.label}</p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <form className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-line bg-surface p-3 shadow-[var(--shadow-xs)]" action="/app/portfoyler">
        {/* Durum butonlarıyla submit edilince aktif sağlık filtresi kaybolmasın */}
        {saglikFilter ? <input type="hidden" name="saglik" value={saglikFilter} /> : null}
        {/* Arama/durum submit'inde aktif harita görünümü korunsun */}
        {view === "harita" ? <input type="hidden" name="gorunum" value="harita" /> : null}
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input
            name="q"
            defaultValue={q}
            aria-label="Portföy ara"
            placeholder="Kod, başlık, portal veya konum ara…"
            className="w-full rounded-[11px] border border-line bg-canvas py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
          />
        </div>
        <div className="flex gap-2">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="submit"
              name="status"
              value={filter.value}
              className={`hidden rounded-[9px] px-3 py-2 text-xs font-semibold transition sm:block ${statusFilter === filter.value ? "bg-ink-950 text-white" : "border border-line text-text-muted hover:text-ink-950"}`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </form>

      {/* Kayıtlı görünümler — aktif filtre kombinasyonu adlandırılıp saklanır */}
      <SavedViews route="/app/portfoyler" views={savedViews} currentParams={savedViewParams} />

      {(q || statusFilter !== "all" || saglikFilter) && (
        <p className="flex items-center gap-2 text-xs text-text-muted">
          <span className="rounded-full bg-brand-600/10 px-2.5 py-1 font-semibold text-brand-600">{totalFilteredCount.toLocaleString("tr-TR")} sonuç</span>
          {q && <span>“{q}” için filtrelendi</span>}
          {saglikFilter && <span>Fiyat sağlığı: {SAGLIK_FILTERS.find((f) => f.value === saglikFilter)?.label}</span>}
          <Link href="/app/portfoyler" className="font-semibold text-brand-600 hover:underline">Filtreyi temizle</Link>
        </p>
      )}

      {(totalCount ?? 0) === 0 ? (
        <EmptyState
          icon={ICONS.portfoy}
          illustration="start"
          title="Portföy merkezinizi kurun"
          description="İlk portföyünüzü ekleyin; fiyat sağlığı, portal teyidi ve yetki süresi otomatik izlenmeye başlasın."
          action={
            canCreate
              ? {
                  node: (
                    <div className="[&>button]:bg-brand-600 [&>button]:text-white">
                      <NewPropertyDialog provinces={provinceList} branches={branchList} propertyTypes={propertyTypeOptions} transactionTypes={transactionTypeOptions} />
                    </div>
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
          action={{ href: "/app/portfoyler", label: "Filtreyi temizle" }}
          secondary={{ href: "/app/talepler", label: "Talep havuzuna bak" }}
        />
      ) : view === "harita" ? (
        <>
          <ListLimitNotice shown={mapRows.length} total={mapLocatedTotal} hint="Haritada en fazla bu kadar konum çizilir; listeyi filtreyle daraltın." />
          <MapView properties={mapProperties} missingCount={missingCoordCount} />
        </>
      ) : (
        <>
        {/* Toplu düzenleme bölümü */}
        <details className="group rounded-[16px] border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-text-muted transition hover:text-ink-950 [&::-webkit-details-marker]:hidden">
            <span>Toplu durum güncelle</span>
            <span className="rounded-full bg-canvas px-2 py-0.5 text-xs text-text-faint group-open:hidden">{rows.length} portföy</span>
            <span className="hidden rounded-full bg-brand-600/10 px-2 py-0.5 text-xs text-brand-600 group-open:block">Kapat</span>
          </summary>
          <div className="border-t border-line px-4 pb-4 pt-3">
            <PropertyBulkActions
              properties={rows.map((p) => ({
                id: p.id,
                property_code: p.property_code,
                title: p.title,
                status: p.status,
              }))}
            />
          </div>
        </details>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((property) => {
            const portals = property.portal_listings ?? [];
            const healthGood = property.price_health === "green" || property.price_health === "Yeşil";
            const coverId = coverByProperty.get(property.id);
            // Karşılaştırma verisi — kartta zaten yüklü alanlardan derlenir.
            // Fiyat sağlığı CompareItem'da ayrı alan olmadığı için (public
            // komponente dokunmuyoruz) rozet etiketi başlığa gömülür: tabloda
            // kolon başlığında "… · Fiyat sağlığı: İyi" olarak görünür.
            const feat = (property.features ?? {}) as {
              rooms?: string;
              sqm?: number;
              floor?: number | string;
              building_age?: number | string;
            };
            const compareItem: CompareItem = {
              id: property.id,
              title: `${property.title ?? property.property_code} · Fiyat sağlığı: ${healthLabel(property.price_health)}`,
              href: `/app/portfoyler/${property.id}`,
              coverId: coverId ?? null,
              price: property.list_price != null ? Number(property.list_price) : null,
              tx: property.transaction_type,
              rooms: feat.rooms ?? null,
              sqm: feat.sqm ?? null,
              floor: feat.floor ?? null,
              buildingAge: feat.building_age ?? null,
              district: relName(property.district),
            };
            return (
              <PropertyCompareShell
                key={property.id}
                item={compareItem}
                actions={
                  /* Malik portalı linki — createOwnerPortalToken'ın tek girişi.
                     Action properties.edit istiyor, buton da aynı kapıda. */
                  canEditProperty ? (
                    <OwnerPortalLinkButton
                      propertyId={property.id}
                      propertyLabel={property.title ?? property.property_code}
                    />
                  ) : null
                }
              >
              <Link
                href={`/app/portfoyler/${property.id}`}
                className="group overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)] transition hover:-translate-y-1 hover:border-brand-300 hover:shadow-[var(--shadow-card)]"
              >
                <div className="relative flex h-36 items-center justify-center overflow-hidden bg-[image:var(--grad-brand-soft)]">
                  {coverId ? (
                    <Image
                      src={`/api/property-media/${coverId}`}
                      alt={property.title ?? property.property_code}
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
                  <span className="absolute left-4 top-4 flex items-center gap-1.5">
                    <span className="rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-bold text-ink-950 shadow-[var(--shadow-xs)] backdrop-blur">{property.property_code}</span>
                    {/* Son 7 günde yayına giren portföy — published_at gerçek yayın damgası (vitrindeki rozetle aynı kural) */}
                    {property.published_at != null && msSince(property.published_at) < 7 * DAY_MS ? (
                      <span className="rounded-full bg-mint-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white shadow-[var(--shadow-xs)]">Yeni</span>
                    ) : null}
                  </span>
                  <span className={`absolute right-4 top-4 rounded-full px-2.5 py-1 text-[11px] font-bold ${healthGood ? "bg-mint-500/15 text-mint-600" : "bg-amber-400/20 text-amber-500"}`}>
                    Fiyat {property.price_health ?? "bekliyor"}
                  </span>
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-brand-600">{property.transaction_type} · {property.property_type}</p>
                      <h2 className="mt-1 font-display text-lg font-bold text-ink-950">{property.title ?? property.property_code}</h2>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted"><MapPin className="h-3.5 w-3.5" />{locationLabel(property)}</p>
                    </div>
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-canvas text-text-faint transition group-hover:bg-brand-600/10 group-hover:text-brand-600" aria-hidden><ArrowUpRight className="h-4 w-4" /></span>
                  </div>
                  <p className="mt-4 font-display text-2xl font-extrabold text-ink-950">{formatPrice(property.list_price, property.transaction_type)}</p>
                  <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4">
                    <span className="flex items-center gap-2 text-xs text-text-muted"><FileCheck2 className="h-4 w-4 text-mint-600" />{property.status}</span>
                    <span className="flex items-center justify-end gap-2 text-xs text-text-muted"><Gauge className="h-4 w-4 text-brand-600" />{portals.length} portal</span>
                  </div>
                </div>
              </Link>
              </PropertyCompareShell>
            );
          })}
        </div>

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
