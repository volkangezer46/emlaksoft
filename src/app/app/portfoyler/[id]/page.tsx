import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  Eye,
  ExternalLink,
  FileCheck2,
  Banknote,
  Gauge,
  History,
  ImageIcon,
  KeyRound,
  LayoutDashboard,
  MapPin,
  Percent,
  Printer,
  RadioTower,
  Siren,
  Sparkles,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { LicenseStatusCard } from "@/components/app/license-status-card";
import { requireModulePage } from "@/lib/require-module-page";
import { ButtonLink } from "@/components/ui/button";
import { DetailTabs, resolveTab, type DetailTabDef } from "@/components/app/detail-tabs";
import { getDefinitions } from "@/lib/definitions";
import { moneyTry } from "@/lib/leak-shield";
import { setPropertyStatus } from "@/app/actions/properties";
import { ClosePortalDialog } from "@/app/app/portallar/portal-dialogs";
import { confirmPortalListing } from "@/app/actions/portal-listings";
import { getConfiguredPortals } from "@/app/actions/portal-publish";
import type { PortalName } from "@/lib/integrations/portals";
import { PortalListingActions } from "./portal-listing-actions";
import { PropertyWorkflow } from "./property-workflow";
import { EditPropertyDialog } from "./edit-property-dialog";
import { DeletePropertyButton, ReassignProperty } from "./property-admin-actions";
import { AiContentPanel } from "./ai-content-panel";
import { PropertyAuthorizationPanel } from "./property-extras";
import { PropertyOwnerCard } from "@/components/app/property-owner-card";
import { RelatedPropertiesWidget } from "./related-properties-widget";
import { PropertyMap } from "@/components/app/property-map";
import { PhotoQualityCard } from "@/components/app/photo-quality-card";
import { NeighborhoodNotesPanel } from "@/components/app/neighborhood-notes-panel";
import { computePriceHealth } from "@/lib/price-health";
import { diagnoseSaleBlockers, isDiagnosable } from "@/lib/sale-diagnostics";
import { SaleDiagnosticsCard } from "@/components/app/sale-diagnostics-card";
import { daysAgoIso, msSince, now } from "@/lib/clock";
import { generateListingText } from "@/lib/listing-text";
import { CopyListingText } from "@/components/app/copy-listing-text";
import { WhatsAppLink } from "@/components/app/whatsapp-link";
import { MoreActions } from "@/components/app/more-actions";
import { fetchLatestRates, fxAgeLabel, fxApproxLine } from "@/lib/fx";
import {
  ClosuresSection,
  HealthSection,
  HealthSkeleton,
  InvestmentSection,
  KeysSection,
  KeysSkeleton,
  MediaSection,
  MediaSkeleton,
  PriceHistorySection,
  PriceHistorySkeleton,
  PublishSection,
  PublishSkeleton,
  RelatedSkeleton,
  TimelineSkeleton,
} from "./sections";
import { PropertyTimelineSection } from "./property-timeline-section";
import { PropertyLifecyclePanel } from "@/components/listing-control/property-lifecycle-panel";
import { PROPERTY_TIMELINE_CATEGORIES } from "./property-events";
import { resolveCategory } from "@/lib/activity-timeline";
import { getStageLabels } from "@/lib/definitions";
import { stageLabelMap } from "@/lib/deal-stage-labels";
import type { CSSProperties } from "react";
import { priceHealthLabel, propertyStatusLabel } from "@/lib/property-labels";
import { provinceOptionsResult } from "@/lib/geo/reader";
import { EmlakFiyatiEndeksPanel } from "@/components/app/emlakfiyati-endeks-panel";
import { mapPropertyTypeToTip } from "@/lib/integrations/emlakfiyati/contract";
import { SampleRecordBadge } from "@/components/ui/sample-data-badge";

const RING_C = 2 * Math.PI * 42;

type Rel = { name?: string; full_name?: string } | { name?: string; full_name?: string }[] | null;

type Portal = {
  id: string;
  portal_name: string;
  portal_listing_id: string | null;
  portal_url: string | null;
  status: string;
  last_confirmed_at: string | null;
  removed_at: string | null;
  removal_reason: string | null;
};

function relName(value: Rel, key: "name" | "full_name" = "name") {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  return (row?.[key] as string | undefined) ?? null;
}

function daysSince(value: string | null) {
  if (!value) return 999;
  return Math.floor(msSince(value) / 86_400_000);
}

function formatPrice(value: number | null, transaction: string) {
  if (value === null) return "Fiyat girilmedi";
  return `${moneyTry(value)}${transaction === "rent" || transaction === "Kiralık" ? "/ay" : ""}`;
}

const statusOptions = [
  { value: "draft", label: "Taslak" },
  { value: "live", label: "Yayında" },
  { value: "reserved", label: "Rezerve" },
  { value: "archived", label: "Arşiv" },
];

/**
 * Portföy detayı — künye (hero) BLOKLAR, geri kalan her şey AKAR.
 *
 * Eskiden tek gövdede ~20 sorgu vardı ve en yavaşı (bölge `region_stats`
 * RPC'leri, zaman tüneli) ilk boyamayı rehin alıyordu. Artık yalnız künyenin
 * gerçekten ihtiyaç duyduğu sorgular bekleniyor; ağır/ikincil bölümler
 * `./sections.tsx` içinde kendi `<Suspense>` sınırlarında akarak geliyor.
 */
const PROPERTY_TAB_IDS = ["ozet", "medya", "fiyat", "portallar", "anahtarlar", "belgeler", "konum", "zaman"] as const;
// Eski çapa/sekme adları
const PROPERTY_TAB_ALIASES: Record<string, string> = { saglik: "belgeler", harita: "konum", gecmis: "zaman" };

export default async function PropertyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { perms, tenantId } = await requireModulePage("properties");
  const canEdit = (perms.properties ?? []).includes("edit");
  const canDelete = (perms.properties ?? []).includes("delete");
  const { id } = await params;
  // Seçili sekme sunucuda çözülür; yalnız aktif sekmenin bölümleri (ve Suspense sorguları) çalışır
  const sp = await searchParams;
  const tab = resolveTab(sp, PROPERTY_TAB_IDS, "ozet", PROPERTY_TAB_ALIASES);
  const timelineCategory = resolveCategory(sp.kategori, PROPERTY_TIMELINE_CATEGORIES.map((c) => c.key));
  const rawLimit = Number(Array.isArray(sp.adet) ? sp.adet[0] : sp.adet);
  const timelineLimit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 40), 400) : 40;
  const supabase = await createClient();

  // KÜNYE BATCH'İ — yalnız hero + üst kartların ihtiyacı. Hepsi `id`'ye bağlı,
  // tam paralel. Zaman tüneli / fiyat geçmişi / bölge RPC'leri artık BURADA DEĞİL.
  const [
    { data: property },
    { data: portalsData },
    { data: dealsData },
    { data: provinces },
    { data: teamMembers },
    propertyTypeDefs,
    transactionTypeDefs,
    fxRates,
    { data: viewRows },
    { data: tenantRow },
    configuredPortals,
    { count: mediaCount },
  ] = await Promise.all([
    supabase
      .from("properties")
      .select(
        "id, is_sample, property_code, title, transaction_type, property_type, status, list_price, min_price, commission_rate, address_line, province_id, district_id, neighborhood_id, parcel_block, parcel_lot, lat, lng, features, price_health, published_at, created_at, updated_at, assigned_to, province:geo_provinces(name), district:geo_districts(name)",
      )
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("portal_listings")
      .select("id, portal_name, portal_listing_id, portal_url, status, last_confirmed_at, removed_at, removal_reason")
      .eq("property_id", id)
      .order("created_at", { ascending: false }),
    // Pipeline butonu için bu portföyün anlaşması: varsa açık olan, yoksa en güncel
    supabase
      .from("deals")
      .select("id, stage")
      .eq("property_id", id)
      .order("updated_at", { ascending: false })
      .limit(20),
    provinceOptionsResult({ includeInactive: true }),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    getDefinitions("property_type"),
    getDefinitions("transaction_type"),
    // TCMB kuru — yoksa null döner ve döviz satırı hiç basılmaz
    fetchLatestRates(supabase),
    // Vitrin görüntülenme sayacı — RLS tenant'a kısıtlar; gün bazlı satırlar toplanır
    supabase.from("listing_views").select("count, day").eq("property_id", id),
    // Vitrin public URL'i için tenant slug'ı
    supabase.from("tenants").select("slug").eq("id", tenantId).maybeSingle(),
    // API yayın adaptörü tanımlı + anahtarı girili portallar (kaldır/güncelle için)
    getConfiguredPortals(),
    // Satış teşhisi için fotoğraf/medya sayısı
    supabase.from("property_media").select("id", { count: "exact", head: true }).eq("property_id", id),
  ]);

  if (!property) notFound();

  // Atanan danışman adı — `property.assigned_to` bilinmeden sorulamıyor.
  const { data: assigneeProfile } = property.assigned_to
    ? await supabase.from("profiles").select("full_name").eq("id", property.assigned_to).maybeSingle()
    : { data: null };

  // Fiyatın altındaki "≈ $X · €Y" satırı; kur tarihi title ipucunda.
  const fxLine = fxApproxLine(property.list_price != null ? Number(property.list_price) : null, fxRates);
  const fxTitle = fxRates ? `TCMB ${fxRates.rateDate} satış kuru — ${fxAgeLabel(fxRates.rateDate, now())}` : undefined;

  const propertyTypeOptions = propertyTypeDefs.length ? propertyTypeDefs.map((d) => d.value) : undefined;
  const transactionTypeOptions = transactionTypeDefs.length ? transactionTypeDefs.map((d) => d.value) : undefined;

  const portals = (portalsData ?? []) as Portal[];
  const portalIds = portals.map((p) => p.id);

  const dealRows = (dealsData ?? []) as { id: string; stage: string }[];
  const relatedDeal = dealRows.find((d) => d.stage !== "won" && d.stage !== "lost") ?? dealRows[0] ?? null;
  const pipelineHref = relatedDeal ? `/app/anlasmalar/${relatedDeal.id}` : "/app/anlasmalar";
  const livePortals = portals.filter((p) => p.status === "live");
  const overdue = livePortals.filter((p) => daysSince(p.last_confirmed_at) >= 7);

  // Vitrin görüntülenme: gün bazlı sayaç satırları toplanır (yaklaşık — ISR).
  const viewCounts = (viewRows ?? []) as { count: number | null; day: string }[];
  const totalViews = viewCounts.reduce((s, r) => s + Number(r.count ?? 0), 0);
  const sevenDayCut = daysAgoIso(7).slice(0, 10);
  const views7d = viewCounts
    .filter((r) => r.day >= sevenDayCut)
    .reduce((s, r) => s + Number(r.count ?? 0), 0);
  const vitrinSlug = (tenantRow as { slug?: string | null } | null)?.slug ?? null;
  const isLiveListing = property.status === "live";
  const vitrinHref = vitrinSlug && isLiveListing ? `/vitrin/${vitrinSlug}/${property.id}` : null;

  // Kapanmış (satılan/kiralanan/arşiv) portföyde hâlâ canlı portal ilanı var mı?
  const isClosedStatus = ["sold", "rented", "archived"].includes(property.status);

  // Stored `portal_name` (ör. "Sahibinden") → yapılandırılmış PortalName eşlemesi.
  const configuredSet = new Set(configuredPortals);
  const portalKeyOf = (name: string): PortalName | null => {
    const key = name.trim().toLowerCase() as PortalName;
    return configuredSet.has(key) ? key : null;
  };

  const features = (property.features ?? {}) as { rooms?: string | null; sqm?: number | null };
  const province = relName(property.province as Rel);
  const district = relName(property.district as Rel);
  const assignee = assigneeProfile?.full_name ?? null;
  const listingText = generateListingText({
    title: property.title,
    transaction_type: property.transaction_type,
    property_type: property.property_type,
    list_price: property.list_price != null ? Number(property.list_price) : null,
    province,
    district,
    features: (property.features ?? null) as Record<string, unknown> | null,
  });

  const healthGood = property.price_health === "green" || property.price_health === "Yeşil";
  const healthWarn = property.price_health === "yellow" || property.price_health === "Sarı" || property.price_health === "red";
  const portalHealth = livePortals.length ? (livePortals.length - overdue.length) / livePortals.length : 1;

  const commissionPreview =
    property.list_price && property.commission_rate
      ? Math.round(Number(property.list_price) * (Number(property.commission_rate) / 100))
      : property.list_price
        ? Math.round(Number(property.list_price) * 0.02)
        : 0;

  // EmlakFiyati endeks türü: yalnız satılık konut/arsa; diğer türler için açık "veri yok" durumu.
  const endeksTip = mapPropertyTypeToTip(property.property_type, property.transaction_type);
  const listSqmPrice =
    property.list_price != null && features.sqm != null && Number(features.sqm) > 0
      ? Math.round(Number(property.list_price) / Number(features.sqm))
      : null;

  const priceSignal = computePriceHealth({
    listPrice: property.list_price != null ? Number(property.list_price) : null,
    sqm: features.sqm != null ? Number(features.sqm) : null,
    districtHint: district ?? province,
  });

  const isRentListing =
    property.transaction_type === "rent" || property.transaction_type === "Kiralık" || property.transaction_type === "kiralik";

  // "Neden satmıyor?" teşhisi — yalnızca aktif pazarlamadaki ilanlar için.
  const daysOnMarket = daysSince(property.published_at ?? property.created_at);
  // Bölge (ilçe) satış hızı — region_stats_history'nin en güncel dönemi.
  const txTypeStat = /kira/i.test(property.transaction_type ?? "")
    ? "Kiralık"
    : /sat/i.test(property.transaction_type ?? "")
      ? "Satılık"
      : "Tümü";
  const { data: regionStat } = isDiagnosable(property.status) && property.district_id
    ? await supabase
        .from("region_stats_history")
        .select("avg_days_listed")
        .eq("district_id", property.district_id)
        .eq("tx_type", txTypeStat)
        .order("period", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };
  const regionAvgDaysListed =
    (regionStat as { avg_days_listed?: number | null } | null)?.avg_days_listed != null
      ? Number((regionStat as { avg_days_listed: number }).avg_days_listed)
      : null;
  const saleDiagnosis = isDiagnosable(property.status)
    ? diagnoseSaleBlockers({
        status: property.status,
        daysOnMarket,
        priceHealth: priceSignal.health,
        priceDeltaPct: priceSignal.deltaPct,
        totalViews,
        views7d,
        livePortals: livePortals.length,
        mediaCount: mediaCount ?? 0,
        transactionType: property.transaction_type,
        regionAvgDaysListed,
      })
    : null;

  // Kayıp toplamı kapanış kayıtlarından gelir; o bölüm akarak geldiği için
  // künyedeki rozet de kendi sınırında bekler.
  const propertyRaw = property as unknown as Record<string, string | null>;
  // EİDS taşınmaz no ayrı, hataya dayanıklı okunur: sütun henüz yoksa (migration uygulanmamış) sayfa düşmez.
  const eidsRes = await supabase.from("properties").select("eids_property_no").eq("id", id).maybeSingle();
  const eidsNo = eidsRes.error ? null : ((eidsRes.data as { eids_property_no?: string | null } | null)?.eids_property_no ?? null);

  // Sağ sütun "sonraki en iyi eylem": teşhisin en öncelikli engeli → ilgili sekme
  const nextBlocker = saleDiagnosis?.blockers[0] ?? null;
  const nextTabByBlocker: Record<string, string> = { photos: "medya", portal: "portallar", price: "fiyat", views: "portallar" };
  const nextTab = nextBlocker
    ? Object.entries(nextTabByBlocker).find(([k]) => nextBlocker.key.includes(k))?.[1] ?? "ozet"
    : "portallar";
  const nextHref = `/app/portfoyler/${property.id}?sekme=${nextTab}`;
  const nextLabel = nextBlocker ? "Düzeltmeye git" : "Portalleri gör";

  const tabDefs: DetailTabDef[] = [
    { id: "ozet", label: "Özet", icon: LayoutDashboard },
    { id: "medya", label: "Medya", icon: ImageIcon, count: mediaCount ?? 0 },
    { id: "fiyat", label: "Fiyat & değerleme", icon: Banknote },
    { id: "portallar", label: "Yayın & portallar", icon: RadioTower, count: portals.length },
    { id: "anahtarlar", label: "Anahtarlar", icon: KeyRound },
    { id: "belgeler", label: "Belgeler & sağlık", icon: FileCheck2 },
    { id: "konum", label: "Konum", icon: MapPin },
    { id: "sahip", label: "İlan sahibi", icon: UserRound },
    { id: "zaman", label: "Zaman çizelgesi", icon: History },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/app/portfoyler" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
          <ArrowLeft className="h-4 w-4" /> Portföy merkezine dön
        </Link>
      </div>

      <LicenseStatusCard />

      <section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-mint-500/20 blur-[90px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.35fr_1fr] lg:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-bold text-white/80">{property.property_code}</span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${healthGood ? "bg-mint-500/20 text-mint-300" : healthWarn ? "bg-amber-400/20 text-amber-300" : "bg-white/10 text-white/60"}`}>
                Fiyat {priceHealthLabel(property.price_health)}
              </span>
              <span className="rounded-full bg-brand-600/20 px-2.5 py-1 text-xs font-bold text-cyan-300">{propertyStatusLabel(property.status)}</span>
              <SampleRecordBadge show={property.is_sample === true} />
            </div>
            <h1 className="mt-3 font-display text-2xl font-extrabold text-white md:text-3xl">
              {property.title ?? property.property_code}
            </h1>
            <p className="mt-1 text-sm text-white/60">
              {property.transaction_type} · {property.property_type}
            </p>
            {(() => {
              const parts = [property.address_line, district, province].filter(Boolean);
              const label = parts.join(" · ") || "Konum belirtilmedi";
              if (parts.length === 0) {
                return (
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-white/70">
                    <MapPin className="h-3.5 w-3.5 text-mint-400" /> {label}
                  </p>
                );
              }
              const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(", "))}`;
              return (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group mt-2 inline-flex max-w-full flex-wrap items-center gap-1.5 text-sm text-white/70 transition hover:text-mint-300"
                  title="Haritada göster"
                >
                  <MapPin className="h-3.5 w-3.5 text-mint-400" />
                  <span className="underline-offset-2 group-hover:underline">{label}</span>
                  <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-xs font-semibold text-mint-300">Haritada göster</span>
                </a>
              );
            })()}
            <p className="mt-4 font-display text-3xl font-extrabold text-white">
              {formatPrice(property.list_price != null ? Number(property.list_price) : null, property.transaction_type)}
            </p>
            {/* Döviz karşılığı — kur yoksa satır hiç çizilmez (uydurma kur yok) */}
            {fxLine ? (
              <p className="mt-1 text-xs text-white/45" title={fxTitle}>
                {fxLine}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/app/portallar?property=${property.id}`} className="btn-shine inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-white px-3.5 py-2 text-sm font-semibold text-ink-950">
                <RadioTower className="h-4 w-4" /> Portal bağla
              </Link>
              <Link href={`/app/randevular?property=${property.id}`} className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white">
                Randevular
              </Link>
              <MoreActions>
              {canEdit ? (
                <EditPropertyDialog
                  property={{
                    id: property.id,
                    title: property.title,
                    transaction_type: property.transaction_type,
                    property_type: property.property_type,
                    list_price: property.list_price != null ? Number(property.list_price) : null,
                    min_price: property.min_price != null ? Number(property.min_price) : null,
                    commission_rate: property.commission_rate != null ? Number(property.commission_rate) : null,
                    address_line: property.address_line,
                    province_id: property.province_id,
                    district_id: property.district_id,
                    neighborhood_id: property.neighborhood_id,
                    parcel_block: property.parcel_block,
                    parcel_lot: property.parcel_lot,
                    lat: property.lat as number | null,
                    lng: property.lng as number | null,
                    features: (property.features ?? {}) as {
                      rooms?: string | null;
                      sqm?: number | null;
                      floor?: number | string | null;
                      heating?: string | null;
                      building_age?: number | string | null;
                      facade?: string | null;
                      description?: string | null;
                    },
                  }}
                  provinces={provinces ?? []}
                  propertyTypes={propertyTypeOptions}
                  transactionTypes={transactionTypeOptions}
                />
              ) : null}
              {/* A4 ilan broşürü — vitrine asılan / müşteriye elden verilen çıktı */}
              <ButtonLink
                href={`/app/portfoyler/${property.id}/brosur`}
                variant="secondary"
                className="h-auto border-white/15 bg-white/5 px-3.5 py-2 text-white hover:bg-white/10"
              >
                <Printer className="h-4 w-4" /> Broşür
              </ButtonLink>
              {/* Müşteriye özel sunum — bu portföy ön seçili olarak sunum sihirbazını açar */}
              <Link href={`/app/portfoyler/sunumlar?portfoy=${property.id}`} className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white">
                Sunuma ekle
              </Link>
              <Link href="/app/kayip-kacak" className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white">
                <Siren className="h-4 w-4" /> Kayıp-kaçak
              </Link>
              <Link href={`/app/eslestirme?property=${property.id}`} className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white">
                Eşleştir
              </Link>
              <Link href={pipelineHref} className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white">
                Pipeline{relatedDeal ? <ArrowUpRight className="h-3.5 w-3.5 text-white/60" /> : null}
              </Link>
              <WhatsAppLink share label="Müşteriye WhatsApp ile gönder" message={listingText.description ? `${listingText.title}\n\n${listingText.description}` : null} />
              {canDelete ? <DeletePropertyButton propertyId={property.id} /> : null}
              {/* Portal ara çözümü: ilan metnini üret, portala yapıştır */}
              <CopyListingText title={listingText.title} description={listingText.description} warnings={listingText.warnings} />
              </MoreActions>
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-5 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="relative grid h-28 w-28 place-items-center">
              <div
                className="conic-spin pointer-events-none absolute inset-2 rounded-full opacity-25 blur-md"
                style={{ background: "conic-gradient(from 0deg, var(--mint-400), var(--brand-500), var(--mint-400))" }}
              />
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--viz-track-inverse)" strokeWidth="8" />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="var(--mint-400)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  className="ring-sweep"
                  style={{ "--circ": RING_C, "--dash": RING_C * (1 - portalHealth) } as CSSProperties}
                />
              </svg>
              <div className="absolute text-center">
                <p className="font-display text-xl font-extrabold">%{Math.round(portalHealth * 100)}</p>
                <p className="text-xs text-white/45">teyit</p>
              </div>
            </div>
            <div className="min-w-0 space-y-2 text-xs text-white/70">
              <div className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5 text-mint-400" /> {livePortals.length} canlı portal</div>
              <div className="flex items-center gap-2"><FileCheck2 className="h-3.5 w-3.5 text-amber-300" /> {overdue.length} teyit gecikmiş</div>
              <div className="flex items-center gap-2">
                <Siren className="h-3.5 w-3.5 text-danger-400" />
                <Suspense fallback={<span className="inline-block h-3 w-20 animate-pulse rounded bg-white/15" />}>
                  <LostTotal portalIds={portalIds} />
                </Suspense>
              </div>
              {canEdit ? (
                <ReassignProperty propertyId={property.id} currentAssignee={property.assigned_to} members={teamMembers ?? []} />
              ) : (
                <div className="flex items-center gap-2">
                  <UserRound className="h-3.5 w-3.5 text-white/50" />
                  {property.assigned_to && assignee ? (
                    <Link href={`/app/ekip/${property.assigned_to}`} className="font-semibold text-white underline-offset-2 hover:underline">
                      {assignee}
                    </Link>
                  ) : (
                    assignee ?? "Atanmadı"
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <DetailTabs basePath={`/app/portfoyler/${property.id}`} tabs={tabDefs} active={tab} label="Portföy sekmeleri" />

          {tab === "ozet" ? (
            <div className="space-y-4">
          {saleDiagnosis ? <SaleDiagnosticsCard diagnosis={saleDiagnosis} /> : null}

          <PropertyWorkflow
            propertyId={property.id}
            listPrice={property.list_price != null ? Number(property.list_price) : null}
            transactionType={property.transaction_type}
          />

          <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
            <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
              <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><Gauge className="h-4 w-4" /> Portföy özeti</p>
              <h2 className="mt-1 font-display font-bold text-ink-950">Detaylar</h2>
              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  ["Oda", features.rooms ?? "—"],
                  ["m²", features.sqm != null ? String(features.sqm) : "—"],
                  ["Min. fiyat", property.min_price != null ? moneyTry(Number(property.min_price)) : "—"],
                  ["Komisyon", property.commission_rate != null ? `%${property.commission_rate}` : "Tanımlanmamış"],
                  ["Ada / parsel", [property.parcel_block, property.parcel_lot].filter(Boolean).join(" / ") || "—"],
                  ["Oluşturma", new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(property.created_at))],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2.5">
                    <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-text-faint">{k}</dt>
                    <dd className="mt-0.5 text-sm font-semibold text-ink-950">{v}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-5 rounded-[var(--radius-card)] border border-amber-400/25 bg-amber-400/5 p-4">
                <p className="flex items-center gap-2 text-xs font-semibold text-amber-700">
                  <Percent className="h-3.5 w-3.5" /> Tahmini ofis komisyonu
                </p>
                <p className="mt-1 font-display text-2xl font-extrabold text-ink-950">{moneyTry(commissionPreview)}</p>
                <p className="mt-1 text-xs text-text-muted">Liste fiyatı × komisyon oranı (kayıp-kaçak hesabında da kullanılır)</p>
              </div>
              <div className="mt-3 rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-3">
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-text-faint">Fiyat sağlığı</p>
                <p className="mt-1 text-sm font-semibold text-ink-950">
                  {priceSignal.health === "green" ? "Yeşil" : priceSignal.health === "yellow" ? "Sarı" : priceSignal.health === "red" ? "Kırmızı" : "Bekliyor"}
                  {priceSignal.deltaPct != null ? ` · %${priceSignal.deltaPct}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">{priceSignal.note}</p>
              </div>
            </section>

            <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
              <p className="text-xs font-semibold text-mint-600">Durum yönetimi</p>
              <h2 className="mt-1 font-display font-bold text-ink-950">Portföy durumu</h2>
              {canEdit && !["sold", "rented"].includes(property.status) ? (
                <form action={setPropertyStatus} className="mt-5 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={property.id} />
                  <label className="min-w-[160px] flex-1 text-xs font-medium text-text-muted">
                    Durum
                    <select name="status" defaultValue={property.status} className="mt-1.5 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm font-semibold outline-none focus:border-brand-400">
                      {statusOptions.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className="rounded-[var(--radius-control)] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800">
                    Kaydet
                  </button>
                </form>
              ) : (
                <p className="mt-3 text-sm text-text-muted">Durum: <span className="font-semibold text-ink-950">{statusOptions.find((o) => o.value === property.status)?.label ?? propertyStatusLabel(property.status)}</span></p>
              )}
              <p className="mt-4 text-xs leading-relaxed text-text-muted">
                Yayına alındığında Portal Kontrol üzerinden ilan no/URL bağlayın. Kapanış formu zorunlu tutulur; rakip kapanışlar kayıp-kaçağa düşer.
              </p>
            </section>
          </div>

          {/* Mahalle notları (F5): ofis içi saha notları, vitrine çıkmaz */}
          <Suspense fallback={null}>
            <NeighborhoodNotesPanel neighborhoodId={property.neighborhood_id} />
          </Suspense>

          {/* Benzer portföyler */}
          <Suspense fallback={<RelatedSkeleton />}>
            <RelatedPropertiesWidget
              currentId={id}
              transactionType={property.transaction_type}
              propertyType={property.property_type}
              provinceId={property.province_id}
            />
          </Suspense>
            </div>
          ) : null}

          {tab === "medya" ? (
            <div className="space-y-4">
          <div id="medya" className="scroll-mt-24">
            <Suspense fallback={<MediaSkeleton />}>
              <MediaSection propertyId={property.id} tenantId={tenantId} canEdit={canEdit} />
            </Suspense>
          </div>

          {/* Foto kalite kartı (F3): kural tabanlı, puansız */}
          <Suspense fallback={null}>
            <PhotoQualityCard propertyId={property.id} />
          </Suspense>

          <AiContentPanel propertyId={property.id} canEdit={canEdit} />
            </div>
          ) : null}

          {tab === "fiyat" ? (
            <div className="space-y-4">
          {/* Fiyat geçmişi — trigger ile otomatik biriken tarihçe */}
          <div id="fiyat" className="scroll-mt-24">
            <Suspense fallback={<PriceHistorySkeleton />}>
              <PriceHistorySection propertyId={property.id} isRent={isRentListing} />
            </Suspense>
          </div>

          {endeksTip ? (
            <Suspense fallback={<div className="h-40 animate-pulse rounded-[var(--radius-panel)] bg-line" role="status" aria-label="EmlakFiyati endeksi yükleniyor" />}>
              <EmlakFiyatiEndeksPanel
                province={province}
                district={district}
                tip={endeksTip}
                stockHref={`/app/portfoyler?q=${encodeURIComponent(district ?? province ?? "")}`}
                compareM2={listSqmPrice}
                showTrend={false}
              />
            </Suspense>
          ) : (
            <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
              <p className="flex items-center gap-2 text-xs font-semibold text-cyan-600">
                <Sparkles className="h-4 w-4" /> EmlakFiyati endeksi
              </p>
              <p className="mt-3 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-canvas/60 px-4 py-5 text-center text-sm text-text-muted">
                EmlakFiyati bölge endeksi yalnız satılık konut ve arsa için sağlanır; bu ilan türü için veri yok.
              </p>
            </section>
          )}
          <Link
            href={`/app/degerleme?property=${property.id}`}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-ink-950 px-3.5 py-2 text-xs font-semibold text-white hover:bg-ink-800"
          >
            Bu portföy için değerleme oluştur
          </Link>

          {/* Yatırım görünümü — bölge medyanlarından getiri + satış süresi tahmini.
              İki `region_stats` RPC'si sayfanın en pahalı sorgusuydu; artık akıyor.
              Veri yetersizse (ilçe yok / bölge medyanı yok) kart hiç görünmez —
              bu yüzden fallback'i de yok (var olmayan kartın iskeleti çizilmemeli). */}
          <Suspense fallback={null}>
            <InvestmentSection
              tenantId={tenantId}
              districtId={property.district_id}
              isRentListing={isRentListing}
              listPrice={property.list_price != null ? Number(property.list_price) : null}
              sqm={features.sqm != null ? Number(features.sqm) : null}
              priceHealth={priceSignal.health}
            />
          </Suspense>
            </div>
          ) : null}

          {tab === "portallar" ? (
            <div className="space-y-4">
          <section id="portallar" className="scroll-mt-24 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
                  <RadioTower className="h-4 w-4 text-brand-600" /> Portal kayıtları
                </h2>
                <p className="text-xs text-text-muted">{portals.length} kayıt · {livePortals.length} canlı</p>
              </div>
              <Link href="/app/portallar" className="text-xs font-semibold text-brand-600">Portal Kontrol</Link>
            </div>
            {isClosedStatus && livePortals.length > 0 ? (
              <div className="flex flex-wrap items-center gap-3 border-b border-danger-500/20 bg-danger-500/[0.06] px-5 py-3.5">
                <Siren className="h-5 w-5 shrink-0 text-danger-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-950">
                    Portföy {statusOptions.find((o) => o.value === property.status)?.label?.toLocaleLowerCase("tr-TR") ?? property.status} ama {livePortals.length} portalda hâlâ yayında
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    Yanlış aramaları ve kayıp-kaçak riskini önlemek için ilanı portallardan kaldırın ya da kapanış formunu doldurun.
                  </p>
                </div>
              </div>
            ) : null}
            {portals.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-text-muted">
                Bu portföye henüz portal bağlanmamış. Portal Kontrol’den ilan no veya link ekleyin.
              </p>
            ) : (
              <div className="divide-y divide-line">
                {portals.map((p) => {
                  const overdueDays = daysSince(p.last_confirmed_at);
                  const isLive = p.status === "live";
                  const portalKey = portalKeyOf(p.portal_name);
                  const canApi = isLive && canEdit && portalKey !== null && Boolean(p.portal_listing_id);
                  return (
                    <article key={p.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[1.3fr_1fr_auto] lg:items-center">
                      <div>
                        <p className="text-sm font-semibold text-ink-950">
                          {p.portal_name} {p.portal_listing_id ? `#${p.portal_listing_id}` : ""}
                        </p>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {isLive
                            ? overdueDays >= 7
                              ? `${overdueDays} gündür teyit yok`
                              : `Son teyit: ${overdueDays === 0 ? "bugün" : `${overdueDays} gün önce`}`
                            : p.removal_reason ?? "Yayından kalktı"}
                        </p>
                        {p.portal_url ? (
                          <a href={p.portal_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
                            İlanı aç <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </div>
                      <div>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${isLive ? "bg-mint-500/12 text-mint-600" : "bg-ink-950/8 text-text-muted"}`}>
                          {isLive ? "Canlı" : p.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {isLive && canEdit ? (
                          <>
                            <form action={confirmPortalListing}>
                              <input type="hidden" name="id" value={p.id} />
                              <button type="submit" className="rounded-[var(--radius-control)] border border-line px-3 py-2 text-xs font-semibold text-brand-600 hover:border-brand-300">
                                Teyit et
                              </button>
                            </form>
                            <ClosePortalDialog listingId={p.id} label={`${p.portal_name} · ${property.property_code}`} />
                            {canApi ? (
                              <PortalListingActions
                                propertyId={property.id}
                                listingId={p.id}
                                portalKey={portalKey!}
                                externalId={p.portal_listing_id!}
                                portalLabel={p.portal_name}
                              />
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* İlan kontrol: yaşam döngüsü, portal geçmişi, sağlık skoru (izole bileşen) */}
          {(perms.portals ?? []).includes("view") ? (
            <PropertyLifecyclePanel propertyId={id} tenantId={tenantId} canCreate={(perms.portals ?? []).includes("create")} />
          ) : null}

          {/* Portale yayınla */}
          <Suspense fallback={<PublishSkeleton />}>
            <PublishSection propertyId={id} />
          </Suspense>

          {/* Vitrin görüntülenme — listing_views gün bazlı sayacın toplamı (yaklaşık, ISR) */}
          <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
                  <Eye className="h-4 w-4 text-brand-600" /> Vitrin görüntülenme
                </h2>
                <p className="text-xs text-text-muted">Halka açık ilan sayfasının izlenme sayacı (yaklaşık — vitrin 2 dk önbellekli)</p>
              </div>
              {vitrinHref ? (
                <a href={vitrinHref} target="_blank" rel="noreferrer" className="focus-ring inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
                  Vitrindeki ilanı aç <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-[auto_1fr] sm:items-center">
              <div className="flex items-center gap-4">
                {vitrinHref ? (
                  <a href={vitrinHref} target="_blank" rel="noreferrer" className="focus-ring press group rounded-[var(--radius-card)] border border-line bg-canvas/60 px-5 py-3 text-center transition hover:border-brand-300">
                    <p className="font-display text-3xl font-extrabold tabular-nums text-ink-950 transition group-hover:text-brand-600">{totalViews.toLocaleString("tr-TR")}</p>
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-faint">toplam görüntülenme</p>
                  </a>
                ) : (
                  <div className="rounded-[var(--radius-card)] border border-line bg-canvas/60 px-5 py-3 text-center">
                    <p className="font-display text-3xl font-extrabold tabular-nums text-ink-950">{totalViews.toLocaleString("tr-TR")}</p>
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-faint">toplam görüntülenme</p>
                  </div>
                )}
                <div className="rounded-[var(--radius-card)] border border-line bg-canvas/60 px-5 py-3 text-center">
                  <p className="flex items-center justify-center gap-1 font-display text-3xl font-extrabold tabular-nums text-ink-950">
                    <TrendingUp className="h-4 w-4 text-mint-600" />{views7d.toLocaleString("tr-TR")}
                  </p>
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-faint">son 7 gün</p>
                </div>
              </div>
              {isLiveListing && totalViews === 0 ? (
                <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-amber-400/30 bg-amber-400/[0.07] px-4 py-3">
                  <Siren className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div>
                    <p className="text-sm font-semibold text-ink-950">Yayında ama henüz hiç görüntülenmemiş</p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      Vitrinde canlı olmasına rağmen izlenme yok. Kapak fotoğrafı, başlık ve fiyatı gözden geçirip ilanı portallarda paylaşın.
                    </p>
                  </div>
                </div>
              ) : !isLiveListing ? (
                <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/50 px-4 py-3">
                  <Eye className="mt-0.5 h-4 w-4 shrink-0 text-text-faint" />
                  <p className="text-xs text-text-muted">
                    Portföy vitrinde yayında değil (durum: {statusOptions.find((o) => o.value === property.status)?.label ?? propertyStatusLabel(property.status)}). Sayaç, ilan tekrar yayına alındığında işlemeye devam eder.
                  </p>
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-mint-500/25 bg-mint-500/[0.06] px-4 py-3">
                  <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-mint-600" />
                  <p className="text-xs text-text-muted">
                    Vitrin ilanı canlı ve izleniyor. Son 7 günde <span className="font-semibold text-ink-950">{views7d.toLocaleString("tr-TR")}</span> görüntülenme aldı.
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Kapanış / kayıp kayıtları — kayıt yoksa bölüm hiç çizilmez, fallback de yok */}
          <Suspense fallback={null}>
            <ClosuresSection portalIds={portalIds} />
          </Suspense>
            </div>
          ) : null}

          {tab === "anahtarlar" ? (
            <div className="space-y-4">
          {/* Anahtar & emanet takibi — "anahtar kimde?" */}
          <Suspense fallback={<KeysSkeleton />}>
            <KeysSection propertyId={property.id} canEdit={canEdit} canDelete={canDelete} />
          </Suspense>
            </div>
          ) : null}

          {tab === "belgeler" ? (
            <div className="space-y-4">
          {/* Portföy sağlık skoru + ilan kalite puanı */}
          <div id="saglik" className="grid scroll-mt-24 gap-4 lg:grid-cols-2">
            <Suspense fallback={<HealthSkeleton />}>
              <HealthSection
                propertyId={property.id}
                hasActivePortal={livePortals.length > 0}
                firstPortal={portals[0] ?? null}
                input={{
                  title: property.title,
                  description: propertyRaw.description ?? null,
                  property_type: property.property_type,
                  transaction_type: property.transaction_type,
                  list_price: property.list_price != null ? Number(property.list_price) : null,
                  address_line: property.address_line,
                  province_id: property.province_id,
                  parcel_block: property.parcel_block,
                  parcel_lot: property.parcel_lot,
                  commission_rate: property.commission_rate != null ? Number(property.commission_rate) : null,
                  features: property.features as Record<string, unknown> | null,
                  authorization_start: propertyRaw.authorization_start ?? null,
                  authorization_end: propertyRaw.authorization_end ?? null,
                  authorization_type: propertyRaw.authorization_type ?? null,
                }}
              />
            </Suspense>
          </div>

          {/* Yetki belgesi */}
          <PropertyAuthorizationPanel
            propertyId={id}
            initial={{
              authStart: propertyRaw.authorization_start ?? null,
              authEnd:   propertyRaw.authorization_end   ?? null,
              authType:  propertyRaw.authorization_type  ?? null,
              authNotes: propertyRaw.authorization_notes ?? null,
              eidsNo,
            }}
          />

            </div>
          ) : null}

          {tab === "konum" ? (
            <div className="space-y-4">
          {/* Konum haritası (OpenStreetMap) */}
          <section id="harita" className="scroll-mt-24">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink-950"><MapPin className="h-4 w-4 text-brand-600" /> Konum</h2>
            <PropertyMap
              lat={property.lat as number | null}
              lng={property.lng as number | null}
              label={[property.address_line, district, province].filter(Boolean).join(" · ") || property.title || undefined}
              addressQuery={[property.address_line, district, province].filter(Boolean).join(", ") || null}
            />
          </section>
            </div>
          ) : null}

          {tab === "sahip" && tenantId ? <PropertyOwnerCard tenantId={tenantId} propertyId={property.id} /> : null}

          {tab === "zaman" ? (
            <Suspense fallback={<TimelineSkeleton />}>
              <PropertyTimelineSection
                propertyId={id}
                stageNames={stageLabelMap(await getStageLabels())}
                category={timelineCategory}
                limit={timelineLimit}
              />
            </Suspense>
          ) : null}
        </div>

        {/* Sağ sütun — her sekmede görünür: sonraki en iyi eylem + hızlı özet */}
        <aside aria-label="Özet ve sonraki eylem" className="space-y-4 lg:sticky lg:top-4">
          <section className="rounded-[var(--radius-panel)] border border-mint-500/30 bg-surface p-4 shadow-[var(--shadow-xs)]">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-mint-600">
              <Sparkles className="h-3.5 w-3.5" /> Sonraki en iyi eylem
            </p>
            {nextBlocker ? (
              <>
                <p className="mt-2 text-sm font-semibold text-ink-950">{nextBlocker.title}</p>
                <p className="mt-1 text-xs text-text-muted">{nextBlocker.action}</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-text-muted">
                {saleDiagnosis
                  ? "Satışı engelleyen belirgin bir sorun yok — aktif takipte kalın."
                  : "Portföy aktif pazarlamada değil; yayına alındığında satış teşhisi burada görünür."}
              </p>
            )}
            <Link
              href={nextHref}
              scroll={false}
              className="btn-shine mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              {nextLabel} <ArrowUpRight className="h-4 w-4" />
            </Link>
          </section>

          <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-text-muted">Hızlı özet</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-muted">Liste fiyatı</dt>
                <dd className="font-semibold text-ink-950">{formatPrice(property.list_price != null ? Number(property.list_price) : null, property.transaction_type)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-muted">Tahmini komisyon</dt>
                <dd className="font-semibold text-ink-950">{moneyTry(commissionPreview)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-muted">Canlı portal</dt>
                <dd>
                  <Link href={`/app/portfoyler/${property.id}?sekme=portallar`} scroll={false} className="font-semibold text-brand-600 hover:underline">
                    {livePortals.length}
                  </Link>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-muted">Vitrin (7 gün)</dt>
                <dd className="font-semibold text-ink-950">{views7d.toLocaleString("tr-TR")}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-muted">Piyasada</dt>
                <dd className="font-semibold text-ink-950">{daysOnMarket >= 999 ? "—" : `${daysOnMarket} gün`}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

/**
 * Künyedeki "kayıp" rozeti — kapanış kayıtlarının toplamı. Tek başına
 * `listing_closures` sorgusu gerektirdiği için hero'yu bekletmiyor.
 */
async function LostTotal({ portalIds }: { portalIds: string[] }) {
  if (portalIds.length === 0) return <>{moneyTry(0)} kayıp</>;
  const supabase = await createClient();
  const { data } = await supabase
    .from("listing_closures")
    .select("estimated_lost_commission")
    .in("portal_listing_id", portalIds);
  const total = (data ?? []).reduce((s, c) => s + Number(c.estimated_lost_commission || 0), 0);
  return <>{moneyTry(total)} kayıp</>;
}
