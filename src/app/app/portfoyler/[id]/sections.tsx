/**
 * Portföy detayının AKAN bölümleri.
 *
 * NEDEN: `page.tsx` tek bir sunucu bileşeniydi; künye (hero) çizilmeden önce
 * zaman tüneli, emsal/bölge RPC'leri, medya, anahtar takibi ve tapu paneli
 * dahil ~20 sorgunun TAMAMININ dönmesi bekleniyordu. En yavaş sorgu ilk
 * boyamayı rehin alıyordu.
 *
 * ÇÖZÜM: Ağır ve ikincil bölümler ayrı async sunucu bileşenlerine taşındı;
 * `page.tsx` her birini kendi `<Suspense>` sınırına alıyor. Kritik künye
 * anında basılır, bu bölümler hazır oldukça akarak gelir. Her bölüm KENDİ
 * sorgusunu atar — hero'nun sorgu batch'i küçüldü.
 *
 * Görünüm ve davranış değişmedi: bu dosyadaki JSX, eski `page.tsx` içindeki
 * ilgili blokların birebir taşınmış hâlidir.
 */
import Link from "next/link";
import { ArrowUpRight, Landmark, Percent, Siren, Timer, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { moneyTry } from "@/lib/leak-shield";
import { DAY_MS, now } from "@/lib/clock";
import { sanitizeWatermarkSettings } from "@/lib/watermark";
import { computeListingQuality, computePropertyHealth } from "@/lib/property-health";
import { PropertyHealthCard, ListingQualityCard } from "@/components/app/property-health-card";
import { getConfiguredPortals } from "@/app/actions/portal-publish";
import { getPropertyStatusHistory } from "@/app/actions/property-management";
import { getPropertyPriceHistory } from "@/app/actions/property-price-history";
import { getPropertyTimeline } from "@/app/actions/property-timeline";
import { getPropertyKeys } from "@/app/actions/property-keys";
import { PropertyMediaManager, type MediaItem } from "./property-media-manager";
import { PropertyPriceHistory } from "./property-price-history";
import { PropertyStatusHistory, PublishToPortalsPanel } from "./property-extras";
import { PropertyTimeline } from "./property-timeline";
import { PropertyKeysSection } from "./property-keys-section";

// ---------------------------------------------------------------------------
// İskeletler — her Suspense sınırının anlamlı fallback'i
// ---------------------------------------------------------------------------

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-[20px] bg-ink-950/[0.06] ${className}`} aria-hidden />;
}

export const MediaSkeleton = () => <Skeleton className="h-64" />;
export const PriceHistorySkeleton = () => <Skeleton className="h-56" />;
export const KeysSkeleton = () => <Skeleton className="h-48" />;
export const HealthSkeleton = () => (
  <div className="grid gap-4 lg:grid-cols-2">
    <Skeleton className="h-56" />
    <Skeleton className="h-56" />
  </div>
);
export const PublishSkeleton = () => <Skeleton className="h-40" />;
export const TimelineSkeleton = () => <Skeleton className="h-64" />;
export const StatusHistorySkeleton = () => <Skeleton className="h-44" />;
export const RelatedSkeleton = () => <Skeleton className="h-52" />;

// ---------------------------------------------------------------------------
// Medya yöneticisi — property_media + filigran markası
// ---------------------------------------------------------------------------

export async function MediaSection({
  propertyId,
  tenantId,
  canEdit,
}: {
  propertyId: string;
  tenantId: string | null;
  canEdit: boolean;
}) {
  const supabase = await createClient();
  const [{ data: mediaData }, { data: tenantBrand }] = await Promise.all([
    // Sıralama sürükle-bırak ile yönetiliyor → `sort_order` TEK ölçüt.
    supabase
      .from("property_media")
      .select("id, kind, storage_path, external_url, is_cover, has_watermark, sort_order")
      .eq("property_id", propertyId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    // Filigran: yükleme sırasında istemcide basılır — ayar + logo + ofis adı gerekir
    tenantId
      ? supabase.from("tenants").select("name, logo_url, watermark_settings").eq("id", tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const brand = (tenantBrand ?? null) as { name: string | null; logo_url: string | null; watermark_settings: unknown } | null;

  return (
    <PropertyMediaManager
      propertyId={propertyId}
      media={(mediaData ?? []) as MediaItem[]}
      canEdit={canEdit}
      watermark={sanitizeWatermarkSettings(brand?.watermark_settings ?? null)}
      officeName={brand?.name ?? ""}
      logoUrl={brand?.logo_url ?? null}
    />
  );
}

// ---------------------------------------------------------------------------
// Fiyat geçmişi — trigger ile otomatik biriken tarihçe
// ---------------------------------------------------------------------------

export async function PriceHistorySection({ propertyId, isRent }: { propertyId: string; isRent: boolean }) {
  const priceHistory = await getPropertyPriceHistory(propertyId);
  return <PropertyPriceHistory propertyId={propertyId} initialHistory={priceHistory} isRent={isRent} />;
}

// ---------------------------------------------------------------------------
// Yatırım görünümü — region_stats RPC'leri (sayfanın en pahalı iki sorgusu)
// ---------------------------------------------------------------------------

type RegionStatLite = { district_id: string; median_sqm_price: number | string | null; avg_days_listed: number | string | null };

export async function InvestmentSection({
  tenantId,
  districtId,
  isRentListing,
  listPrice,
  sqm,
  priceHealth,
}: {
  tenantId: string | null;
  districtId: string | null;
  isRentListing: boolean;
  listPrice: number | null;
  sqm: number | null;
  priceHealth: string;
}) {
  if (!districtId || !tenantId) return null;

  const supabase = await createClient();
  const [regionSaleRes, regionRentRes] = await Promise.all([
    supabase.rpc("region_stats", { p_tenant_id: tenantId, p_transaction_type: "Satılık", p_months_back: 12 }),
    supabase.rpc("region_stats", { p_tenant_id: tenantId, p_transaction_type: "Kiralık", p_months_back: 12 }),
  ]);

  const findRegionRow = (res: { data: unknown } | null) =>
    ((res?.data ?? []) as RegionStatLite[]).find((r) => r.district_id === districtId) ?? null;
  const saleRegion = findRegionRow(regionSaleRes);
  const rentRegion = findRegionRow(regionRentRes);
  const saleMedianSqm =
    saleRegion?.median_sqm_price != null && Number(saleRegion.median_sqm_price) > 0 ? Number(saleRegion.median_sqm_price) : null;
  const rentMedianSqm =
    rentRegion?.median_sqm_price != null && Number(rentRegion.median_sqm_price) > 0 ? Number(rentRegion.median_sqm_price) : null;

  const sqmNum = sqm != null && sqm > 0 ? sqm : null;
  const listPriceNum = listPrice != null && listPrice > 0 ? listPrice : null;

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
    const [lo, hi] = priceHealth === "green" ? [0.75, 1] : priceHealth === "red" ? [1, 1.25] : [0.85, 1.15];
    daysRange = [Math.max(1, Math.round(baseDays * lo)), Math.max(1, Math.round(baseDays * hi))];
  }

  // Veri yetersizse kart tamamen gizli
  if (amortYears == null && daysRange == null) return null;
  const oneDecimal = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-mint-600">
            <TrendingUp className="h-4 w-4" /> Yatırım görünümü
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Bölge verisine göre tahmin</h2>
        </div>
        <Link href={`/app/bolge-analizi?district=${districtId}#trend`} className="text-xs font-semibold text-brand-600">
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
  );
}

// ---------------------------------------------------------------------------
// Anahtar & emanet takibi — "anahtar kimde?"
// ---------------------------------------------------------------------------

export async function KeysSection({
  propertyId,
  canEdit,
  canDelete,
}: {
  propertyId: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const supabase = await createClient();
  const [propertyKeys, { data: teamMembers }] = await Promise.all([
    getPropertyKeys(propertyId),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);

  return (
    <PropertyKeysSection
      propertyId={propertyId}
      keys={propertyKeys.keys}
      events={propertyKeys.events}
      staff={teamMembers ?? []}
      defaultDueDate={new Date(now() + 2 * DAY_MS).toISOString().slice(0, 10)}
      nowMs={now()}
      canEdit={canEdit}
      canDelete={canDelete}
    />
  );
}

// ---------------------------------------------------------------------------
// Kapanış / kayıp kayıtları — portal id'lerine bağlı
// ---------------------------------------------------------------------------

type Closure = {
  id: string;
  reason: string;
  estimated_lost_commission: number | null;
  competitor_closed: boolean | null;
  closed_by_us: boolean | null;
  created_at: string;
  portal_listing_id: string;
};

export async function ClosuresSection({ portalIds }: { portalIds: string[] }) {
  if (portalIds.length === 0) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("listing_closures")
    .select("id, reason, estimated_lost_commission, competitor_closed, closed_by_us, created_at, portal_listing_id")
    .in("portal_listing_id", portalIds)
    .order("created_at", { ascending: false });

  const closures = (data ?? []) as Closure[];
  if (closures.length === 0) return null;

  return (
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
  );
}

// ---------------------------------------------------------------------------
// Portföy sağlık skoru + ilan kalite puanı — medya SAYISINA bağlı
// ---------------------------------------------------------------------------

export type HealthInput = {
  title: string | null;
  description: string | null;
  property_type: string | null;
  transaction_type: string | null;
  list_price: number | null;
  address_line: string | null;
  province_id: string | null;
  parcel_block: string | null;
  parcel_lot: string | null;
  commission_rate: number | null;
  features: Record<string, unknown> | null;
  authorization_start: string | null;
  authorization_end: string | null;
  authorization_type: string | null;
};

export async function HealthSection({
  propertyId,
  input,
  hasActivePortal,
  firstPortal,
}: {
  propertyId: string;
  input: HealthInput;
  hasActivePortal: boolean;
  firstPortal: { portal_listing_id: string | null; portal_url: string | null } | null;
}) {
  const supabase = await createClient();
  // Yalnız SAYI gerekiyor — satırları çekmiyoruz (medya yöneticisi kendi sorgusunu atıyor).
  const { count } = await supabase
    .from("property_media")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId);
  const mediaCount = count ?? 0;

  const propertyHealth = computePropertyHealth({
    title: input.title,
    property_type: input.property_type,
    transaction_type: input.transaction_type,
    list_price: input.list_price,
    address_line: input.address_line,
    province_id: input.province_id,
    parcel_block: input.parcel_block,
    parcel_lot: input.parcel_lot,
    commission_rate: input.commission_rate,
    features: input.features,
    authorization_start: input.authorization_start,
    authorization_end: input.authorization_end,
    authorization_type: input.authorization_type,
    mediaCount,
    hasActivePortal,
  });

  const listingQuality = firstPortal
    ? computeListingQuality({
        title: input.title,
        description: input.description,
        mediaCount,
        hasPortalId: Boolean(firstPortal.portal_listing_id),
        hasPortalUrl: Boolean(firstPortal.portal_url),
        priceSet: Boolean(input.list_price),
        locationSet: Boolean(input.province_id && input.address_line),
      })
    : null;

  return (
    <>
      <PropertyHealthCard health={propertyHealth} />
      {listingQuality && <ListingQualityCard quality={listingQuality} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Portale yayınla — yapılandırılmış portal listesi
// ---------------------------------------------------------------------------

export async function PublishSection({ propertyId }: { propertyId: string }) {
  const configuredPortals = await getConfiguredPortals();
  return <PublishToPortalsPanel propertyId={propertyId} configuredPortals={configuredPortals} />;
}

// ---------------------------------------------------------------------------
// Zaman tüneli — portal yayını, teklif, randevu, açık ev tek kronolojide
// ---------------------------------------------------------------------------

export async function TimelineSection({ propertyId }: { propertyId: string }) {
  const timeline = await getPropertyTimeline(propertyId);
  return <PropertyTimeline events={timeline} simdi={now()} />;
}

// ---------------------------------------------------------------------------
// Durum geçmişi
// ---------------------------------------------------------------------------

export async function StatusHistorySection({ propertyId }: { propertyId: string }) {
  const statusHistory = await getPropertyStatusHistory(propertyId);
  return (
    <PropertyStatusHistory
      propertyId={propertyId}
      initialHistory={statusHistory as Parameters<typeof PropertyStatusHistory>[0]["initialHistory"]}
    />
  );
}
