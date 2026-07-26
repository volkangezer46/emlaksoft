import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  ExternalLink,
  FileCheck2,
  Gauge,
  Landmark,
  MapPin,
  MapPinned,
  Percent,
  Printer,
  RadioTower,
  Siren,
  Sparkles,
  Timer,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { ButtonLink } from "@/components/ui/button";
import { getDefinitions } from "@/lib/definitions";
import { moneyTry } from "@/lib/leak-shield";
import { setPropertyStatus } from "@/app/actions/properties";
import { ClosePortalDialog } from "@/app/app/portallar/portal-dialogs";
import { confirmPortalListing } from "@/app/actions/portal-listings";
import { PropertyWorkflow } from "./property-workflow";
import { EditPropertyDialog } from "./edit-property-dialog";
import { DeletePropertyButton, ReassignProperty } from "./property-admin-actions";
import { PropertyMediaManager, type MediaItem } from "./property-media-manager";
import { AiContentPanel } from "./ai-content-panel";
import { PropertyStatusHistory, PropertyAuthorizationPanel, PublishToPortalsPanel } from "./property-extras";
import { PropertyPriceHistory } from "./property-price-history";
import { PropertyHealthCard, ListingQualityCard } from "@/components/app/property-health-card";
import { RelatedPropertiesWidget } from "./related-properties-widget";
import { TapuInquiryPanel } from "./tapu-inquiry-panel";
import { PropertyMap } from "@/components/app/property-map";
import { computePropertyHealth, computeListingQuality } from "@/lib/property-health";
import { computePriceHealth } from "@/lib/price-health";
import { isEndeksaConfigured } from "@/lib/integrations/endeksa";
import { isTapusorConfigured } from "@/lib/integrations/tapusor";
import { getConfiguredPortals } from "@/app/actions/portal-publish";
import { getPropertyStatusHistory } from "@/app/actions/property-management";
import { getPropertyPriceHistory } from "@/app/actions/property-price-history";
import { getPropertyTimeline } from "@/app/actions/property-timeline";
import { PropertyTimeline } from "./property-timeline";
import type { CSSProperties } from "react";

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

type Closure = {
  id: string;
  reason: string;
  estimated_lost_commission: number | null;
  competitor_closed: boolean | null;
  closed_by_us: boolean | null;
  created_at: string;
  portal_listing_id: string;
};

function relName(value: Rel, key: "name" | "full_name" = "name") {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  return (row?.[key] as string | undefined) ?? null;
}

function daysSince(value: string | null) {
  if (!value) return 999;
  return Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
}

function formatPrice(value: number | null, transaction: string) {
  if (value === null) return "Fiyat girilmedi";
  return `${moneyTry(value)}${transaction === "rent" || transaction === "Kiralık" ? "/ay" : ""}`;
}

const statusOptions = [
  { value: "draft", label: "Taslak" },
  { value: "live", label: "Yayında" },
  { value: "reserved", label: "Rezerve" },
  { value: "sold", label: "Satıldı" },
  { value: "rented", label: "Kiralandı" },
  { value: "archived", label: "Arşiv" },
];

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { perms, tenantId } = await requireModulePage("properties");
  const canEdit = (perms.properties ?? []).includes("edit");
  const canDelete = (perms.properties ?? []).includes("delete");
  const { id } = await params;
  const supabase = await createClient();

  // 1. tur — hepsi yalnızca `id`'ye bağlı, tam paralel
  const [{ data: property }, { data: portalsData }, { data: dealsData }, statusHistory, priceHistory, timeline, configuredPortals, propertyTypeDefs, transactionTypeDefs] = await Promise.all([
    supabase
      .from("properties")
      .select(
        "id, property_code, title, transaction_type, property_type, status, list_price, min_price, commission_rate, address_line, province_id, district_id, neighborhood_id, parcel_block, parcel_lot, lat, lng, features, price_health, created_at, updated_at, assigned_to, province:geo_provinces(name), district:geo_districts(name)",
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
    getPropertyStatusHistory(id),
    getPropertyPriceHistory(id),
    getPropertyTimeline(id),
    getConfiguredPortals(),
    getDefinitions("property_type"),
    getDefinitions("transaction_type"),
  ]);

  if (!property) notFound();

  const propertyTypeOptions = propertyTypeDefs.length ? propertyTypeDefs.map((d) => d.value) : undefined;
  const transactionTypeOptions = transactionTypeDefs.length ? transactionTypeDefs.map((d) => d.value) : undefined;

  const portals = (portalsData ?? []) as Portal[];
  const portalIds = portals.map((p) => p.id);

  // Yatırım görünümü için bölge medyanları — ilçe yoksa hiç sorgulanmaz
  const regionStatsFor = (txType: string) =>
    property.district_id && tenantId
      ? supabase.rpc("region_stats", { p_tenant_id: tenantId, p_transaction_type: txType, p_months_back: 12 })
      : Promise.resolve({ data: null });

  const [{ data: closuresData }, { data: assigneeProfile }, { data: provinces }, { data: teamMembers }, { data: mediaData }, regionSaleRes, regionRentRes] = await Promise.all([
    portalIds.length
      ? supabase
          .from("listing_closures")
          .select("id, reason, estimated_lost_commission, competitor_closed, closed_by_us, created_at, portal_listing_id")
          .in("portal_listing_id", portalIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Closure[] }),
    property.assigned_to
      ? supabase.from("profiles").select("full_name").eq("id", property.assigned_to).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("geo_provinces").select("id, name").order("name"),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase
      .from("property_media")
      .select("id, kind, storage_path, external_url, is_cover")
      .eq("property_id", id)
      .order("is_cover", { ascending: false })
      .order("sort_order", { ascending: true }),
    regionStatsFor("Satılık"),
    regionStatsFor("Kiralık"),
  ]);

  const closures = (closuresData ?? []) as Closure[];
  const media = (mediaData ?? []) as MediaItem[];
  const dealRows = (dealsData ?? []) as { id: string; stage: string }[];
  const relatedDeal = dealRows.find((d) => d.stage !== "won" && d.stage !== "lost") ?? dealRows[0] ?? null;
  const pipelineHref = relatedDeal ? `/app/anlasmalar/${relatedDeal.id}` : "/app/anlasmalar";
  const livePortals = portals.filter((p) => p.status === "live");
  const overdue = livePortals.filter((p) => daysSince(p.last_confirmed_at) >= 7);
  const lostTotal = closures.reduce((s, c) => s + Number(c.estimated_lost_commission || 0), 0);

  const features = (property.features ?? {}) as { rooms?: string | null; sqm?: number | null };
  const province = relName(property.province as Rel);
  const district = relName(property.district as Rel);
  const assignee = assigneeProfile?.full_name ?? null;

  const healthGood = property.price_health === "green" || property.price_health === "Yeşil";
  const healthWarn = property.price_health === "yellow" || property.price_health === "Sarı" || property.price_health === "red";
  const portalHealth = livePortals.length ? (livePortals.length - overdue.length) / livePortals.length : 1;

  const commissionPreview =
    property.list_price && property.commission_rate
      ? Math.round(Number(property.list_price) * (Number(property.commission_rate) / 100))
      : property.list_price
        ? Math.round(Number(property.list_price) * 0.02)
        : 0;

  const endeksaOn = isEndeksaConfigured();
  const tapusorOn = isTapusorConfigured();

  const priceSignal = computePriceHealth({
    listPrice: property.list_price != null ? Number(property.list_price) : null,
    sqm: features.sqm != null ? Number(features.sqm) : null,
    districtHint: district ?? province,
  });

  // ---- Yatırım görünümü (bölge kira çarpanı + tahmini satış süresi) --------
  // Kaynak: yalnızca ofisin kendi verisinden hesaplanan region_stats medyanları.
  type RegionStatLite = { district_id: string; median_sqm_price: number | string | null; avg_days_listed: number | string | null };
  const findRegionRow = (res: { data: unknown } | null) =>
    ((res?.data ?? []) as RegionStatLite[]).find((r) => r.district_id === property.district_id) ?? null;
  const saleRegion = findRegionRow(regionSaleRes);
  const rentRegion = findRegionRow(regionRentRes);
  const saleMedianSqm = saleRegion?.median_sqm_price != null && Number(saleRegion.median_sqm_price) > 0 ? Number(saleRegion.median_sqm_price) : null;
  const rentMedianSqm = rentRegion?.median_sqm_price != null && Number(rentRegion.median_sqm_price) > 0 ? Number(rentRegion.median_sqm_price) : null;

  const isRentListing =
    property.transaction_type === "rent" || property.transaction_type === "Kiralık" || property.transaction_type === "kiralik";
  const sqmNum = features.sqm != null && Number(features.sqm) > 0 ? Number(features.sqm) : null;
  const listPriceNum = property.list_price != null && Number(property.list_price) > 0 ? Number(property.list_price) : null;

  // Bölge kira çarpanı: satılık medyan ₺/m² ÷ (kiralık medyan aylık ₺/m² × 12)
  const regionMultiplier = saleMedianSqm != null && rentMedianSqm != null ? saleMedianSqm / (rentMedianSqm * 12) : null;

  // Portföye özgü amortisman: kendi fiyatı + karşı tipin bölge medyanı.
  // m² veya fiyat yoksa bölge çarpanına düşülür; o da yoksa hesap yapılmaz.
  let amortYears: number | null = null;
  if (isRentListing) {
    amortYears =
      listPriceNum != null && sqmNum != null && saleMedianSqm != null
        ? (saleMedianSqm * sqmNum) / (listPriceNum * 12)
        : regionMultiplier;
  } else {
    amortYears =
      listPriceNum != null && sqmNum != null && rentMedianSqm != null
        ? listPriceNum / (rentMedianSqm * sqmNum * 12)
        : regionMultiplier;
  }
  if (amortYears != null && (!Number.isFinite(amortYears) || amortYears <= 0)) amortYears = null;
  const grossYieldPct = amortYears != null ? 100 / amortYears : null;

  // Tahmini satış/kiralama süresi: bölge ort. listede kalma × fiyat sağlığı
  // düzeltmesi (yeşil −%25'e kadar hızlı, kırmızı +%25'e kadar yavaş).
  const regionDaysRaw = (isRentListing ? rentRegion : saleRegion)?.avg_days_listed;
  const baseDays = regionDaysRaw != null && Number(regionDaysRaw) > 0 ? Number(regionDaysRaw) : null;
  let daysRange: [number, number] | null = null;
  if (baseDays != null) {
    const [lo, hi] =
      priceSignal.health === "green" ? [0.75, 1] : priceSignal.health === "red" ? [1, 1.25] : [0.85, 1.15];
    daysRange = [Math.max(1, Math.round(baseDays * lo)), Math.max(1, Math.round(baseDays * hi))];
  }

  // Veri yetersizse kart tamamen gizli
  const showInvestmentCard = Boolean(property.district_id) && (amortYears != null || daysRange != null);
  const oneDecimal = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

  // Portföy sağlık skoru
  const propertyHealth = computePropertyHealth({
    title:              property.title,
    property_type:      property.property_type,
    transaction_type:   property.transaction_type,
    list_price:         property.list_price != null ? Number(property.list_price) : null,
    address_line:       property.address_line,
    province_id:        property.province_id,
    parcel_block:       property.parcel_block,
    parcel_lot:         property.parcel_lot,
    commission_rate:    property.commission_rate != null ? Number(property.commission_rate) : null,
    features:           property.features as Record<string, unknown> | null,
    authorization_start: (property as unknown as Record<string, string | null>).authorization_start,
    authorization_end:   (property as unknown as Record<string, string | null>).authorization_end,
    authorization_type:  (property as unknown as Record<string, string | null>).authorization_type,
    mediaCount:         (mediaData ?? []).length,
    hasActivePortal:    livePortals.length > 0,
  });

  // İlan kalite puanı (ilk aktif portal için)
  const firstPortal = portals[0];
  const listingQuality = firstPortal ? computeListingQuality({
    title:       property.title,
    description: (property as unknown as Record<string, string | null>).description ?? null,
    mediaCount:  (mediaData ?? []).length,
    hasPortalId: Boolean(firstPortal.portal_listing_id),
    hasPortalUrl: Boolean(firstPortal.portal_url),
    priceSet:    Boolean(property.list_price),
    locationSet: Boolean(property.province_id && property.address_line),
  }) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/app/portfoyler" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
          <ArrowLeft className="h-4 w-4" /> Portföy merkezine dön
        </Link>
        {/* Sayfa içi çapa navigasyonu — bölüm id'leri scroll-mt-24 ile sabit üst çubuğu telafi eder */}
        <nav aria-label="Sayfa içi bölümler" className="flex flex-wrap items-center gap-1 rounded-full border border-line bg-surface p-1 text-xs font-semibold text-text-muted shadow-[var(--shadow-xs)]">
          {([
            ["#medya", "Medya"],
            ["#fiyat", "Fiyat"],
            ["#portallar", "Portallar"],
            ["#saglik", "Sağlık"],
            ["#harita", "Harita"],
            ["#gecmis", "Geçmiş"],
          ] as const).map(([href, label]) => (
            <Link key={href} href={href} className="focus-ring rounded-full px-2.5 py-1 transition hover:bg-canvas hover:text-ink-950">
              {label}
            </Link>
          ))}
        </nav>
      </div>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-mint-500/20 blur-[90px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.35fr_1fr] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/80">{property.property_code}</span>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${healthGood ? "bg-mint-500/20 text-mint-300" : healthWarn ? "bg-amber-400/20 text-amber-300" : "bg-white/10 text-white/60"}`}>
                Fiyat {property.price_health ?? "bekliyor"}
              </span>
              <span className="rounded-full bg-brand-600/20 px-2.5 py-1 text-[11px] font-bold text-cyan-300">{property.status}</span>
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
                  className="group mt-2 inline-flex items-center gap-1.5 text-sm text-white/70 transition hover:text-mint-300"
                  title="Haritada göster"
                >
                  <MapPin className="h-3.5 w-3.5 text-mint-400" />
                  <span className="underline-offset-2 group-hover:underline">{label}</span>
                  <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold text-mint-300">Haritada göster</span>
                </a>
              );
            })()}
            <p className="mt-4 font-display text-3xl font-extrabold text-white">
              {formatPrice(property.list_price != null ? Number(property.list_price) : null, property.transaction_type)}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/app/portallar?property=${property.id}`} className="btn-shine inline-flex items-center gap-1.5 rounded-[10px] bg-white px-3.5 py-2 text-sm font-semibold text-ink-950">
                <RadioTower className="h-4 w-4" /> Portal bağla
              </Link>
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
              <Link href={`/app/portfoyler/sunumlar?portfoy=${property.id}`} className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white">
                Sunuma ekle
              </Link>
              <Link href="/app/kayip-kacak" className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white">
                <Siren className="h-4 w-4" /> Kayıp-kaçak
              </Link>
              <Link href={`/app/eslestirme?property=${property.id}`} className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white">
                Eşleştir
              </Link>
              <Link href={pipelineHref} className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white">
                Pipeline{relatedDeal ? <ArrowUpRight className="h-3.5 w-3.5 text-white/60" /> : null}
              </Link>
              {canDelete ? <DeletePropertyButton propertyId={property.id} /> : null}
            </div>
          </div>

          <div className="flex items-center gap-5 rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="relative grid h-28 w-28 place-items-center">
              <div
                className="conic-spin pointer-events-none absolute inset-2 rounded-full opacity-25 blur-md"
                style={{ background: "conic-gradient(from 0deg, var(--mint-400), var(--brand-500), var(--mint-400))" }}
              />
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
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
                <p className="text-[10px] text-white/45">teyit</p>
              </div>
            </div>
            <div className="space-y-2 text-xs text-white/70">
              <div className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5 text-mint-400" /> {livePortals.length} canlı portal</div>
              <div className="flex items-center gap-2"><FileCheck2 className="h-3.5 w-3.5 text-amber-300" /> {overdue.length} teyit gecikmiş</div>
              <div className="flex items-center gap-2"><Siren className="h-3.5 w-3.5 text-danger-400" /> {moneyTry(lostTotal)} kayıp</div>
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

      <div id="medya" className="scroll-mt-24">
        <PropertyMediaManager propertyId={property.id} media={media} canEdit={canEdit} />
      </div>

      <AiContentPanel propertyId={property.id} />

      <PropertyWorkflow
        propertyId={property.id}
        listPrice={property.list_price != null ? Number(property.list_price) : null}
        transactionType={property.transaction_type}
      />

      {/* Fiyat geçmişi — trigger ile otomatik biriken tarihçe */}
      <div id="fiyat" className="scroll-mt-24">
        <PropertyPriceHistory
          propertyId={property.id}
          initialHistory={priceHistory}
          isRent={property.transaction_type === "rent" || property.transaction_type === "Kiralık" || property.transaction_type === "kiralik"}
        />
      </div>

      <section className="rounded-[20px] border border-line bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-violet-600">
            <Sparkles className="h-4 w-4" /> Endeksa &amp; Tapusor derin değerleme
          </p>
          <Link
            href={`/app/degerleme?property=${property.id}`}
            className="inline-flex items-center gap-1.5 rounded-[9px] bg-ink-950 px-3.5 py-2 text-xs font-semibold text-white hover:bg-ink-800"
          >
            Bu portföy için değerleme oluştur
          </Link>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className={`flex items-center gap-3 rounded-[12px] border px-3 py-2.5 ${endeksaOn ? "border-cyan-400/30 bg-cyan-400/5" : "border-line bg-canvas/60"}`}>
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${endeksaOn ? "bg-cyan-500/15 text-cyan-700" : "bg-ink-950/6 text-text-faint"}`}>
              <Landmark className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-950">Endeksa bölge endeksi</p>
              <p className="text-[11px] text-text-muted">{endeksaOn ? "Canlı — değerlemede otomatik kullanılır" : "Bağlantı bekliyor (ENDEKSA_CLIENT_ID)"}</p>
            </div>
          </div>
          <div className={`flex items-center gap-3 rounded-[12px] border px-3 py-2.5 ${tapusorOn ? "border-violet-400/30 bg-violet-400/5" : "border-line bg-canvas/60"}`}>
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${tapusorOn ? "bg-violet-500/15 text-violet-700" : "bg-ink-950/6 text-text-faint"}`}>
              <MapPinned className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-950">Tapusor EDİ + yatırım puanı</p>
              <p className="text-[11px] text-text-muted">
                {tapusorOn
                  ? `Ada ${property.parcel_block ?? "—"} / Parsel ${property.parcel_lot ?? "—"} ile sorgulanır`
                  : "Bağlantı bekliyor (TAPUSOR_API_KEY)"}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Yatırım görünümü — bölge medyanlarından getiri + satış süresi tahmini.
          Veri yetersizse (ilçe yok / bölge medyanı yok) kart hiç görünmez. */}
      {showInvestmentCard ? (
        <section className="rounded-[20px] border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-mint-600">
                <TrendingUp className="h-4 w-4" /> Yatırım görünümü
              </p>
              <h2 className="mt-1 font-display font-bold text-ink-950">Bölge verisine göre tahmin</h2>
            </div>
            <Link href={`/app/bolge-analizi?district=${property.district_id}#trend`} className="text-xs font-semibold text-brand-600">
              Bölge analizi
            </Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {grossYieldPct != null ? (
              <div
                className="rounded-[12px] border border-line bg-canvas/60 px-3 py-2.5"
                title={
                  isRentListing
                    ? "Yıllık kira (liste fiyatı × 12) ÷ tahmini değer (bölge satılık medyan ₺/m² × m²). m² veya fiyat yoksa bölge kira çarpanı kullanılır."
                    : "Tahmini yıllık kira (bölge kiralık medyan ₺/m² × m² × 12) ÷ liste fiyatı. m² veya fiyat yoksa bölge kira çarpanı kullanılır."
                }
              >
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-faint">
                  <Percent className="h-3.5 w-3.5 text-mint-600" /> Tahmini yıllık getiri
                </p>
                <p className="mt-1 font-display text-2xl font-extrabold text-ink-950">~%{oneDecimal.format(grossYieldPct)}</p>
                <p className="text-[11px] text-text-muted">brüt kira getirisi</p>
              </div>
            ) : null}
            {amortYears != null ? (
              <div
                className="rounded-[12px] border border-line bg-canvas/60 px-3 py-2.5"
                title="Amortisman = satılık değerin kaç yıllık kira geliriyle karşılandığı (bölge kira çarpanı esaslı)."
              >
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-faint">
                  <Landmark className="h-3.5 w-3.5 text-brand-600" /> Amortisman
                </p>
                <p className="mt-1 font-display text-2xl font-extrabold text-ink-950">{oneDecimal.format(amortYears)} yıl</p>
                <p className="text-[11px] text-text-muted">kira ile geri dönüş süresi</p>
              </div>
            ) : null}
            {daysRange ? (
              <div
                className="rounded-[12px] border border-line bg-canvas/60 px-3 py-2.5"
                title={`Bölgedeki ${isRentListing ? "kiralık" : "satılık"} portföylerin ortalama listede kalma süresi (${Math.round(baseDays ?? 0)} gün), fiyat sağlığına göre ±%25 düzeltilir: yeşil fiyat hızlandırır, kırmızı yavaşlatır.`}
              >
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-faint">
                  <Timer className="h-3.5 w-3.5 text-amber-600" /> Tahmini {isRentListing ? "kiralama" : "satış"} süresi
                </p>
                <p className="mt-1 font-display text-2xl font-extrabold text-ink-950">
                  ~{daysRange[0]}–{daysRange[1]} gün
                </p>
                <p className="text-[11px] text-text-muted">bölge ortalaması + fiyat sağlığı</p>
              </div>
            ) : null}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
            Tahminler yalnızca ofisinizin kendi bölge verisinden (ilçe medyanları) üretilir; dış piyasa endeksi değildir.
          </p>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><Gauge className="h-4 w-4" /> Portföy özeti</p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Detaylar</h2>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              ["Oda", features.rooms ?? "—"],
              ["m²", features.sqm != null ? String(features.sqm) : "—"],
              ["Min. fiyat", property.min_price != null ? moneyTry(Number(property.min_price)) : "—"],
              ["Komisyon", property.commission_rate != null ? `%${property.commission_rate}` : "%2 (varsayılan)"],
              ["Ada / parsel", [property.parcel_block, property.parcel_lot].filter(Boolean).join(" / ") || "—"],
              ["Oluşturma", new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(property.created_at))],
            ].map(([k, v]) => (
              <div key={k} className="rounded-[12px] border border-line bg-canvas/60 px-3 py-2.5">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-faint">{k}</dt>
                <dd className="mt-0.5 text-sm font-semibold text-ink-950">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 rounded-[14px] border border-amber-400/25 bg-amber-400/5 p-4">
            <p className="flex items-center gap-2 text-xs font-semibold text-amber-700">
              <Percent className="h-3.5 w-3.5" /> Tahmini ofis komisyonu
            </p>
            <p className="mt-1 font-display text-2xl font-extrabold text-ink-950">{moneyTry(commissionPreview)}</p>
            <p className="mt-1 text-[11px] text-text-muted">Liste fiyatı × komisyon oranı (kayıp-kaçak hesabında da kullanılır)</p>
          </div>
          <div className="mt-3 rounded-[14px] border border-line bg-canvas/60 px-3 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">Price Health</p>
            <p className="mt-1 text-sm font-semibold text-ink-950">
              {priceSignal.health === "green" ? "Yeşil" : priceSignal.health === "yellow" ? "Sarı" : priceSignal.health === "red" ? "Kırmızı" : "Bekliyor"}
              {priceSignal.deltaPct != null ? ` · %${priceSignal.deltaPct}` : ""}
            </p>
            <p className="mt-0.5 text-[11px] text-text-muted">{priceSignal.note}</p>
          </div>
        </section>

        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <p className="text-xs font-semibold text-mint-600">Durum yönetimi</p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Portföy durumu</h2>
          {canEdit ? (
            <form action={setPropertyStatus} className="mt-5 flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={property.id} />
              <label className="min-w-[160px] flex-1 text-xs font-medium text-text-muted">
                Durum
                <select name="status" defaultValue={property.status} className="mt-1.5 w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm font-semibold outline-none focus:border-brand-400">
                  {statusOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <button type="submit" className="rounded-[10px] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800">
                Kaydet
              </button>
            </form>
          ) : (
            <p className="mt-3 text-sm text-text-muted">Durum: <span className="font-semibold text-ink-950">{statusOptions.find((o) => o.value === property.status)?.label ?? property.status}</span></p>
          )}
          <p className="mt-4 text-xs leading-relaxed text-text-muted">
            Yayına alındığında Portal Kontrol üzerinden ilan no/URL bağlayın. Kapanış formu zorunlu tutulur; rakip kapanışlar kayıp-kaçağa düşer.
          </p>
        </section>
      </div>

      <section id="portallar" className="scroll-mt-24 overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <RadioTower className="h-4 w-4 text-brand-600" /> Portal kayıtları
            </h2>
            <p className="text-xs text-text-muted">{portals.length} kayıt · {livePortals.length} canlı</p>
          </div>
          <Link href="/app/portallar" className="text-xs font-semibold text-brand-600">Portal Kontrol</Link>
        </div>
        {portals.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-text-muted">
            Bu portföye henüz portal bağlanmamış. Portal Kontrol’den ilan no veya link ekleyin.
          </p>
        ) : (
          <div className="divide-y divide-line">
            {portals.map((p) => {
              const overdueDays = daysSince(p.last_confirmed_at);
              const isLive = p.status === "live";
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
                      <a href={p.portal_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600">
                        İlanı aç <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </div>
                  <div>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${isLive ? "bg-mint-500/12 text-mint-600" : "bg-ink-950/8 text-text-muted"}`}>
                      {isLive ? "Canlı" : p.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {isLive && canEdit ? (
                      <>
                        <form action={confirmPortalListing}>
                          <input type="hidden" name="id" value={p.id} />
                          <button type="submit" className="rounded-[9px] border border-line px-3 py-2 text-xs font-semibold text-brand-600 hover:border-brand-300">
                            Teyit et
                          </button>
                        </form>
                        <ClosePortalDialog listingId={p.id} label={`${p.portal_name} · ${property.property_code}`} />
                      </>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {closures.length > 0 ? (
        <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Siren className="h-4 w-4 text-danger-500" /> Kapanış / kayıp kayıtları
            </h2>
            <Link href="/app/kayip-kacak" className="text-xs font-semibold text-brand-600">Kayıp-kaçak panosu</Link>
          </div>
          <div className="divide-y divide-line">
            {closures.map((c) => (
              // Satır kayıp-kaçak panosuna gider; ?neden= değeri listing_closures.reason kolonunun ham hali
              <Link
                key={c.id}
                href={`/app/kayip-kacak?neden=${encodeURIComponent(c.reason)}#kapanislar`}
                className="group flex flex-wrap items-center justify-between gap-2 px-5 py-3 transition hover:bg-canvas/60"
              >
                <div>
                  <p className="text-sm font-semibold text-ink-950">{c.reason}</p>
                  <p className="text-xs text-text-muted">
                    {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(c.created_at))}
                    {c.competitor_closed ? " · Rakip" : ""}
                    {c.closed_by_us ? " · Bizim" : ""}
                  </p>
                </div>
                <span className="flex items-center gap-2">
                  <span className={`font-display text-sm font-extrabold ${Number(c.estimated_lost_commission || 0) > 0 ? "text-danger-500" : "text-mint-600"}`}>
                    {Number(c.estimated_lost_commission || 0) > 0
                      ? `−${moneyTry(Number(c.estimated_lost_commission))}`
                      : "Kayıp yok"}
                  </span>
                  <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Portföy sağlık skoru + ilan kalite puanı */}
      <div id="saglik" className="grid scroll-mt-24 gap-4 lg:grid-cols-2">
        <PropertyHealthCard health={propertyHealth} />
        {listingQuality && <ListingQualityCard quality={listingQuality} />}
      </div>

      {/* Yetki belgesi */}
      <PropertyAuthorizationPanel
        propertyId={id}
        initial={{
          authStart: (property as unknown as Record<string, string | null>).authorization_start ?? null,
          authEnd:   (property as unknown as Record<string, string | null>).authorization_end   ?? null,
          authType:  (property as unknown as Record<string, string | null>).authorization_type  ?? null,
          authNotes: (property as unknown as Record<string, string | null>).authorization_notes ?? null,
        }}
      />

      {/* Portale yayınla */}
      <PublishToPortalsPanel
        propertyId={id}
        configuredPortals={configuredPortals}
      />

      {/* Zaman tuneli: fiyat ve durum gecmisi ayri ayri dogruydu ama HIKAYEYI
          anlatmiyorlardi. Portal yayini, teklif, randevu ve acik ev ise
          hicbir kronolojide gorunmuyordu. */}
      <div id="gecmis" className="scroll-mt-24">
        <PropertyTimeline events={timeline} simdi={new Date().getTime()} />
      </div>

      {/* Durum geçmişi */}
      <PropertyStatusHistory
        propertyId={id}
        initialHistory={statusHistory as Parameters<typeof PropertyStatusHistory>[0]["initialHistory"]}
      />

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

      {/* Tapu & parsel sorgusu (TAKBİS/Tapusor) */}
      <TapuInquiryPanel
        provinceName={province}
        districtName={district}
        defaultAda={property.parcel_block}
        defaultParsel={property.parcel_lot}
      />

      {/* Benzer portföyler */}
      <RelatedPropertiesWidget
        currentId={id}
        transactionType={property.transaction_type}
        propertyType={property.property_type}
        provinceId={property.province_id}
      />
    </div>
  );
}
