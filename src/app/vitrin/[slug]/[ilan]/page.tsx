import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Avatar } from "@/components/ui/avatar";
import { notFound } from "next/navigation";
import { OPEN_LISTING_OR_FILTER } from "@/lib/closed-listing";
import {
  ArrowLeft,
  BedDouble,
  CalendarClock,
  ClipboardList,
  UserRound,
  Bath,
  Building2,
  MapPin,
  MessageCircle,
  Phone,
  Ruler,
  ShieldCheck,
} from "lucide-react";
import { formatMoney } from "@/lib/format";
import { formatPublicPrice, listingCurrency, type ListingCurrency } from "@/lib/public-price";
import { PUBLIC_EXACT_LOCATION, osmEmbedSrc, osmOpenHref as osmOpenHrefOf, publicLocation } from "@/lib/public-location";
import { resolvePublicContact } from "@/lib/public-contact";
import { PublicContactActions } from "@/components/public/public-contact-actions";
import { removedListingSlot, type RemovedListingCtx } from "./removed-listing";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  listingKodIdRange,
  listingSlugInput,
  parseListingKod,
  pickUniqueByKod,
  vitrinListingPath,
  vitrinListingUrl,
} from "@/lib/vitrin/listing-slug";
import { isVitrinEnabled, loadVitrinSettings } from "@/lib/vitrin-settings";
import { getSeoSettings } from "@/lib/seo/store";
import { resolveSeoPattern, vitrinRobots } from "@/lib/seo/patterns";
import { serializeJsonLd } from "@/lib/seo/jsonld";
import { listingFactLine, listingSeoVars } from "@/lib/vitrin-seo/describe";
import { buildVitrinListingLd } from "@/lib/vitrin-seo/listing-ld";
import { listingImageAlt } from "@/lib/vitrin-seo/alt-text";
import { isNeverIndexTenant } from "@/lib/vitrin-seo/never-index";
import { loadNeverIndexList } from "@/lib/vitrin-seo/store";
import dynamicImport from "next/dynamic";
import { LazyLeadForm } from "../lazy-islands";
import { ShareButton } from "@/components/public/share-button";
import { FavButton } from "@/components/public/fav-button";
import { VitrinCardShell } from "@/components/public/vitrin-fav";
import { FavNavBadge } from "../fav-nav-badge";
import { PriceAlertForm } from "./price-alert-form";
import { MapEmbed } from "./map-embed";
import { NearbyPanel } from "./nearby-panel";
import { parseNearbyPlaces } from "@/lib/vitrin/nearby";
import { PurchaseCalculator } from "./purchase-calculator";
import { InvestmentPanel } from "./investment-panel";
import { DAY_MS, msSince, now } from "@/lib/clock";
import { fetchLatestRates, fxAgeLabel, fxApproxLine } from "@/lib/fx";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { PublicModuleClosed } from "@/components/modules/public-module-closed";
import { isPublicFeatureClosed } from "@/lib/modules/public";
import { getBaseUrl } from "@/lib/base-url";
import { LicenseNotice } from "@/components/public/license-notice";
import { readPropertyDescription } from "@/lib/property-description";
import { VitrinChat } from "@/components/public/vitrin-chat";
import { readTenantSettings } from "@/lib/settings/tenant-read";
import { VITRIN_AI_CHAT_KEY } from "@/lib/settings/registry/tenant";
import { normalizeExternalHref } from "@/lib/external-href";
import { VirtualTourEmbed } from "@/components/public/virtual-tour-embed";
import { provinceOptionsResult } from "@/lib/geo/reader";
import {
  PUBLIC_COVER_COLUMNS,
  firstPublicImageByProperty,
  isPublicListingImage,
  selectWithDocumentFlag,
  type PublicCoverCandidate,
} from "@/lib/public-property-media";

type VitrinMediaRow = {
  id: string;
  kind: string;
  file_type: string | null;
  file_name: string | null;
  external_url: string | null;
  is_cover: boolean;
  sort_order: number | null;
  is_document?: boolean | null;
};

// Lightbox etkileşimli client komponenti — dynamic import ile ayrı chunk'a
// alınır, galeri alanı yüklenene dek en-boy oranını koruyan iskelet görünür.
const GalleryLightbox = dynamicImport(
  () => import("@/components/public/gallery-lightbox").then((m) => m.GalleryLightbox),
  { loading: () => <div className="aspect-[16/10] w-full animate-pulse bg-ink-950/8" /> },
);

// ISR: vitrin herkese acik — CDN onbellekli, 2 dk tazelenir (jet hiz)
export const revalidate = 60;

const BASE_URL = getBaseUrl();

// SK8 B094: fiyat ilanın para biriminden (features.currency) formatMoney ile basılır.
function money(n: number | null, tx: string | null | undefined, currency: ListingCurrency) {
  return formatPublicPrice(n, tx, currency);
}

type Rel = { name?: string } | { name?: string }[] | null;
function relName(v: Rel) {
  if (!v) return null;
  const r = Array.isArray(v) ? v[0] : v;
  return r?.name ?? null;
}

type Feat = {
  rooms?: string;
  sqm?: number;
  baths?: number;
  description?: string;
  floor?: number | string;
  building_age?: number | string;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; ilan: string }>;
}): Promise<Metadata> {
  const { slug, ilan } = await params;
  // Adres parçasının yalnız `{kod}` kısmı çözülür; açıklayıcı kısım dekoratiftir (canonical doğru adresi gösterir).
  const kod = parseListingKod(ilan);
  if (!kod) return { title: "İlan bulunamadı" };
  const kodRange = listingKodIdRange(kod);
  const admin = createAdminClient();

  // Paylaşım görseli dosya kuralından gelir (opengraph-image.tsx / twitter-image.tsx: ofis markalı kart, ilk public
  // fotoğraf arka plan). openGraph/twitter içinde `images` anahtarı YAZILMAZ: Next anahtar varsa (undefined bile)
  // dosya tabanlı görseli eklemez (resolve-metadata hasOwnProperty('images')) — SK8 B151.
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, slug, status, sample_seeded_at, sample_cleared_at")
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant || !isPublicTenantActive(tenant.status)) return { title: "İlan bulunamadı" };

  // Vitrin ayarı (açık mı + arama onayı), ilan, SEO kalıpları ve kalıcı noindex listesi bağımsız: paralel.
  const [{ settings: vitrinCfg }, { data: propertyRows }, seo, neverIndexList] = await Promise.all([
    loadVitrinSettings(admin, tenant.id),
    admin
      .from("properties")
      .select(
        "id, title, property_code, transaction_type, property_type, list_price, address_line, features, province:geo_provinces(name), district:geo_districts(name)",
      )
      .gte("id", kodRange.lo)
      .lte("id", kodRange.hi)
      .eq("tenant_id", tenant.id)
      .eq("status", "live")
      .is("deleted_at", null)
      .eq("is_sample", false)
      .or(OPEN_LISTING_OR_FILTER)
      .limit(2),
    getSeoSettings(),
    loadNeverIndexList(),
  ]);
  if (!vitrinCfg.enabled) return { title: "İlan bulunamadı" };
  const property = pickUniqueByKod(propertyRows, kod);
  if (!property) return { title: "İlan bulunamadı" };
  const canonicalPath = vitrinListingPath(slug, listingSlugInput(property));

  const priceText = money(
    property.list_price != null ? Number(property.list_price) : null,
    property.transaction_type,
    listingCurrency(property.features),
  );
  const feat = (property.features ?? {}) as Feat;
  // Kalıp yoksa varsayılan: markalı başlık (60 karakter) + oda/m²/fiyat/ilçeden açıklama; ham adres alanı yalnız
  // yöneticinin {konum} kalıbında kullanılır (src/lib/seo/patterns.ts DEFAULT_SEO_PATTERNS, vitrin-seo/describe.ts).
  const vars = listingSeoVars({
    office: tenant.name,
    title: property.title,
    code: property.property_code,
    priceText,
    province: relName(property.province as Rel),
    district: relName(property.district as Rel),
    tx: property.transaction_type,
    type: property.property_type,
    rooms: feat.rooms ?? null,
    sqm: feat.sqm ?? null,
    // Açık adres yalnız ofis açık konumu yayınladığında (SK8 B152); varsayılan gizlilikte {konum} mahalle/ilçedir.
    addressLine: PUBLIC_EXACT_LOCATION ? property.address_line : null,
  });
  const title = resolveSeoPattern(seo.patterns, "listing", "title", vars);
  const rawDesc = readPropertyDescription(property.features);
  const description = (rawDesc ?? resolveSeoPattern(seo.patterns, "listing", "description", vars))
    .replace(/\s+/g, " ")
    .slice(0, 160);

  return {
    title: { absolute: title },
    description,
    // Arama motoru görünürlüğü: kalıcı noindex kuralı (örnek/demo/test/platform kiracısı) ÖNCE, sonra ofisin açık
    // onayı (tenants.vitrin_seo_optin); sitemap ile aynı ölçüt.
    robots: vitrinRobots(vitrinCfg.seoOptin, isNeverIndexTenant(tenant, neverIndexList)),
    alternates: { canonical: canonicalPath },
    openGraph: {
      type: "website",
      locale: "tr_TR",
      siteName: tenant.name ?? "EmlakSoft",
      title,
      description,
      url: canonicalPath,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * İlan detayı. 404 yollarında (`notFound()`) ofis bağlamı istek kapsamlı yuvaya yazılır; `not-found.tsx` ofis markalı
 * "Bu ilan yayından kalktı" görünümünü GERÇEK HTTP 404 ile basar (SK8 B153). Yuva her yolda kapanır (finally).
 */
export default async function VitrinPropertyPage(props: { params: Promise<{ slug: string; ilan: string }> }) {
  const slot = removedListingSlot();
  try {
    return await renderVitrinProperty(props, createAdminClient(), slot.settle);
  } finally {
    slot.settle(null);
  }
}

async function renderVitrinProperty(
  { params }: { params: Promise<{ slug: string; ilan: string }> },
  admin: ReturnType<typeof createAdminClient>,
  settleNotFound: (ctx: RemovedListingCtx | null) => void,
) {
  const { slug, ilan } = await params;
  // Yalnız `{kod}` çözülür (açıklayıcı kısım dekoratif); biçim dışı parça → ofis markalı 404.
  const kod = parseListingKod(ilan);

  // tenant (slug) ve provinces (bağımsız) yalnızca params'a bağlı → paralel
  const [{ data: tenant }, { data: provinces }] = await Promise.all([
    admin
      .from("tenants")
      .select("id, name, status, phone, logo_url, brand_color, license_no, address_line, lead_capture_token, lead_capture_enabled")
      .eq("slug", slug)
      .maybeSingle(),
    provinceOptionsResult(),
  ]);
  if (!tenant || !isPublicTenantActive(tenant.status)) notFound();
  if (await isPublicFeatureClosed(admin, tenant.id, "vitrin")) return <PublicModuleClosed officeName={tenant.name} />;
  // Ofis vitrinini kapattıysa (vitrin_enabled=false; sütun yoksa açık) ilan detayı da 404.
  if (!(await isVitrinEnabled(admin, tenant.id))) notFound();

  const kodRange = kod ? listingKodIdRange(kod) : null;
  const { data: propertyRows } = kodRange
    ? await admin
        .from("properties")
        .select(
          "id, title, property_code, transaction_type, property_type, status, list_price, address_line, lat, lng, created_at, published_at, assigned_to, features, province_id, district_id, province:geo_provinces(name), district:geo_districts(name), neighborhood:geo_neighborhoods(name)",
        )
        .gte("id", kodRange.lo)
        .lte("id", kodRange.hi)
        .eq("tenant_id", tenant.id)
        .eq("status", "live")
        .is("deleted_at", null)
        .eq("is_sample", false)
        .or(OPEN_LISTING_OR_FILTER)
        .limit(2)
    : { data: null };
  const property = kod ? pickUniqueByKod(propertyRows, kod) : null;
  if (!property) {
    settleNotFound(await loadRemovedListingCtx(admin, tenant, slug, kod, provinces ?? []));
    notFound();
  }
  const listingUrl = vitrinListingUrl(BASE_URL, slug, listingSlugInput(property));

  // Medya (ilan çözüldükten sonra, ilan id'siyle) ve EİDS taşınmaz no (20260826002950: sütun yoksa sorgu hata verir →
  // gösterilmez, sayfa bozulmaz) bağımsız → paralel. KVKK P0-9: is_document seçilir (sütun yoksa sütunsuz tekrar).
  const [{ data: mediaRows }, { data: eidsRow, error: eidsError }, { data: nearbyRow, error: nearbyError }] = await Promise.all([
    selectWithDocumentFlag<VitrinMediaRow[]>("id, kind, file_type, file_name, external_url, is_cover, sort_order", (columns) =>
      admin
        .from("property_media")
        .select(columns)
        .eq("property_id", property.id)
        .order("is_cover", { ascending: false })
        .order("sort_order", { ascending: true }),
    ),
    admin
      .from("properties")
      .select("eids_property_no")
      .eq("id", property.id)
      .eq("tenant_id", tenant.id)
      .eq("is_sample", false)
      .maybeSingle(),
    // PUB-8: danışmanın girdiği çevre noktaları (20261019010001; sütun yoksa hata → bölüm gizlenir, sayfa bozulmaz).
    admin.from("properties").select("nearby_places").eq("id", property.id).eq("tenant_id", tenant.id).eq("is_sample", false).maybeSingle(),
  ]);
  const nearbyPlaces = nearbyError ? [] : parseNearbyPlaces((nearbyRow as { nearby_places?: unknown } | null)?.nearby_places);
  const eidsNo = eidsError ? null : ((eidsRow?.eids_property_no as string | null | undefined) ?? null);

  const price = property.list_price != null ? Number(property.list_price) : null;
  const currency = listingCurrency(property.features);
  const chatEnabled =
    Boolean(process.env.OPENAI_API_KEY) && (await readTenantSettings(admin, tenant.id, [VITRIN_AI_CHAT_KEY]))[VITRIN_AI_CHAT_KEY] === true;

  // Açıklama + benzer ilanlar yalnızca property'ye bağlı → paralel.
  // Benzerlik: aynı işlem türü + aynı İLÇE (ilçe yoksa aynı İL) + fiyat ±%30,
  // kendisi hariç, en fazla 4 adet. İlçe m² fiyatı için ilden çok daha güçlü
  // sinyal olduğundan önce ilçe denenir (resolveGeoHint gerekçesiyle aynı).
  let similarQuery = admin
    .from("properties")
    .select(
      "id, title, property_code, transaction_type, property_type, list_price, features, province:geo_provinces(name), district:geo_districts(name)",
    )
    .eq("tenant_id", tenant.id)
    .eq("status", "live")
    .is("deleted_at", null)
    .eq("is_sample", false)
    .or(OPEN_LISTING_OR_FILTER)
    .neq("id", property.id)
    .eq("transaction_type", property.transaction_type)
    .order("created_at", { ascending: false })
    .limit(4);
  if (property.district_id) similarQuery = similarQuery.eq("district_id", property.district_id);
  else if (property.province_id) similarQuery = similarQuery.eq("province_id", property.province_id);
  if (price != null && price > 0) {
    similarQuery = similarQuery.gte("list_price", Math.round(price * 0.7)).lte("list_price", Math.round(price * 1.3));
  }
  // Danışman kartı yalnız danışman dijital kartvizitini yayına aldıysa (is_public) görünür —
  // aksi halde kişi bilgisi sızmaz, ofis iletişimi kullanılır.
  const advisorPromise = property.assigned_to
    ? admin
        .from("profiles")
        .select("full_name, title, phone, photo_url, public_slug, is_public")
        .eq("id", property.assigned_to)
        .eq("tenant_id", tenant.id)
        .eq("is_active", true)
        .maybeSingle()
    : Promise.resolve({ data: null });
  // Profil avatarı (foto/hazır avatar; kişisel veri değil). Ayrı ve hata-toleranslı: sütun yoksa kart bozulmaz.
  const avatarPromise = property.assigned_to
    ? Promise.resolve(
        admin
          .from("profiles")
          .select("avatar_url, avatar_preset")
          .eq("id", property.assigned_to)
          .eq("tenant_id", tenant.id)
          .maybeSingle(),
      ).then((r) => r, () => ({ data: null }))
    : Promise.resolve({ data: null });
  const bookingPromise = property.assigned_to
    ? admin
        .from("booking_settings")
        .select("public_token")
        .eq("tenant_id", tenant.id)
        .eq("staff_id", property.assigned_to)
        .eq("is_active", true)
        .maybeSingle()
    : Promise.resolve({ data: null });
  // Emsal bilgisi: yalnız bu ofisin yayındaki aynı ilçe + aynı işlem türü ilanlarının
  // gerçek ₺/m² ortalaması (en az 3 örnek; yoksa hiç gösterilmez).
  const compsPromise = property.district_id
    ? admin
        .from("properties")
        .select("list_price, features")
        .eq("tenant_id", tenant.id)
        .eq("status", "live")
        .is("deleted_at", null)
        .eq("is_sample", false)
        .or(OPEN_LISTING_OR_FILTER)
        .eq("district_id", property.district_id)
        .eq("transaction_type", property.transaction_type)
        .neq("id", property.id)
        .gt("list_price", 0)
        .limit(60)
    : Promise.resolve({ data: null });
  const [description, { data: similarData }, fxRates, , { data: advisorRow }, { data: bookingRow }, { data: compRows }, { data: avatarRow }] =
    await Promise.all([
    readPropertyDescription(property.features),
    similarQuery,
    // Döviz karşılığı sunucuda hesaplanır — ISR (revalidate=120) korunur,
    // client'ta kur çekme/hesap YOK. Kur yoksa null → satır hiç basılmaz.
    fetchLatestRates(admin),
    // Günlük görüntülenme sayacı (listing_views): atomik upsert +1.
    // NOT: Sayfa ISR ile 120 sn CDN önbellekli — sayaç yalnızca yeniden
    // doğrulama render'larında artar, yani YAKLAŞIK sayımdır (trend göstergesi).
    // Hata sayfayı düşürmesin diye sonuç yutulur.
    admin
      .rpc("increment_listing_view", { p_tenant_id: tenant.id, p_property_id: property.id })
      .then(({ error }) => {
        if (error) console.error("increment_listing_view", error.message);
      }),
    advisorPromise,
    bookingPromise,
    compsPromise,
    avatarPromise,
  ]);
  const advisorAvatar = avatarRow as { avatar_url?: string | null; avatar_preset?: string | null } | null;
  const advisor =
    advisorRow && (advisorRow as { is_public?: boolean }).is_public
      ? (advisorRow as {
          full_name: string;
          title: string | null;
          phone: string | null;
          photo_url: string | null;
          public_slug: string | null;
        })
      : null;
  const bookingToken = (bookingRow as { public_token?: string } | null)?.public_token ?? null;
  const similar = similarData ?? [];

  // Kur tarihi ipucu — fiyatın altındaki döviz satırının `title` değeri. Döviz ilanda (USD/EUR) TL varsayan kur satırı
  // basılmaz (SK8 B094: fxApproxLine kaynağı TL kabul eder).
  const fxTitle = fxRates ? `TCMB ${fxRates.rateDate} satış kuru — ${fxAgeLabel(fxRates.rateDate, now())}` : undefined;
  const fxLine = currency === "TRY" ? fxApproxLine(price, fxRates) : null;

  let similarCoverMap = new Map<string, string>();
  if (similar.length) {
    // KVKK P0-9: benzer ilan kapağı belge olamaz -> ilk public görsel.
    const { data: similarMedia } = await selectWithDocumentFlag<PublicCoverCandidate[]>(PUBLIC_COVER_COLUMNS, (columns) =>
      admin
        .from("property_media")
        .select(columns)
        .eq("kind", "image")
        .in("property_id", similar.map((p) => p.id))
        .order("is_cover", { ascending: false })
        .order("sort_order", { ascending: true }),
    );
    similarCoverMap = firstPublicImageByProperty(similarMedia);
  }

  const media = mediaRows ?? [];
  // KVKK P0-9: belge (is_document; sütun yoksa belge adlı) görsel vitrinde gösterilmez (tek kural).
  const images = media.filter((m) => isPublicListingImage(m));
  const tours = media.flatMap((item) => {
    const externalUrl = normalizeExternalHref(item.external_url);
    return item.kind !== "image" && externalUrl
      ? [{ ...item, external_url: externalUrl }]
      : [];
  });

  const feat = (property.features ?? {}) as Feat;
  // Konum gizliliği (SK8 B152): mahalle/ilçe metni, yaklaşık koordinat, ilçe araması; açık adres basılmaz.
  const location = publicLocation({
    id: property.id,
    addressLine: property.address_line,
    lat: property.lat,
    lng: property.lng,
    neighborhood: relName((property as { neighborhood?: Rel }).neighborhood ?? null),
    district: relName(property.district as Rel),
    province: relName(property.province as Rel),
  });
  const loc = location.text;
  const mapsHref = location.mapsHref;

  const sqmNum = feat.sqm != null ? Number(feat.sqm) : null;
  const pricePerSqm = price != null && price > 0 && sqmNum && sqmNum > 0 ? Math.round(price / sqmNum) : null;
  const compPerSqm = (compRows ?? [])
    .map((r) => {
      const sq = Number(((r.features ?? {}) as Feat).sqm);
      const pr = Number(r.list_price);
      return sq > 0 && pr > 0 ? pr / sq : null;
    })
    .filter((v): v is number => v != null);
  // Emsal ortalaması TL ilanlardan; döviz ilanda karşılaştırma basılmaz (para birimi karışmasın).
  const compAvg =
    currency === "TRY" && compPerSqm.length >= 3 ? Math.round(compPerSqm.reduce((a, b) => a + b, 0) / compPerSqm.length) : null;
  const tl = (n: number) => formatMoney(n, currency);
  const detailRows = [
    { label: "İlan no", value: property.property_code },
    { label: "İşlem", value: property.transaction_type },
    { label: "Emlak türü", value: property.property_type },
    feat.rooms ? { label: "Oda sayısı", value: feat.rooms } : null,
    sqmNum ? { label: "Alan", value: `${sqmNum} m²` } : null,
    feat.baths ? { label: "Banyo", value: String(feat.baths) } : null,
    feat.floor != null && feat.floor !== "" ? { label: "Bulunduğu kat", value: String(feat.floor) } : null,
    feat.building_age != null && feat.building_age !== "" ? { label: "Bina yaşı", value: String(feat.building_age) } : null,
    pricePerSqm ? { label: "Fiyat / m²", value: tl(pricePerSqm) } : null,
    property.published_at
      ? { label: "Yayın tarihi", value: new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(property.published_at)) }
      : null,
  ].filter((r): r is { label: string; value: string } => r != null && Boolean(r.value));
  // Harita: yaklaşık merkezde geniş kutu, işaretsiz (daire MapEmbed'de); dokunuşla yüklenir.
  const mapEmbed = osmEmbedSrc(location);
  const osmOpenHref = osmOpenHrefOf(location);
  const leadOpen = tenant.lead_capture_enabled !== false && Boolean(tenant.lead_capture_token);
  // İletişim (SK8 B148): yayındaki danışman kartının telefonu → ofisin girdiği telefon; sahip kişisel telefonu yok.
  const contact = resolvePublicContact({
    advisorPhone: advisor?.phone ?? null,
    officePhone: tenant.phone,
    whatsappText: `Merhaba, ${property.title || property.property_code} ilanı hakkında bilgi almak istiyorum. ${listingUrl}`,
  });

  const specs = [
    feat.rooms ? { icon: BedDouble, label: feat.rooms } : null,
    feat.baths ? { icon: Bath, label: `${feat.baths} banyo` } : null,
    feat.sqm ? { icon: Ruler, label: `${feat.sqm} m²` } : null,
  ].filter(Boolean) as { icon: typeof BedDouble; label: string }[];

  // Kiralık ilanda peşinat/kredi hesabı anlamsız — hesaplayıcı yalnız satılıkta.
  const txRaw = (property.transaction_type ?? "").toLowerCase();
  const isSale = !(txRaw === "rent" || txRaw.includes("kira"));

  const hasMobileBar = Boolean(contact) || Boolean(bookingToken) || leadOpen;

  const district = relName(property.district as Rel);
  const province = relName(property.province as Rel);
  const listingName = property.title || property.property_code || "Portföy";
  // JSON-LD: RealEstateListing (image[] yalnız mevcut public görsellerden) + BreadcrumbList (Vitrin › İlçe › İlan).
  const jsonLd = buildVitrinListingLd({
    base: BASE_URL,
    slug,
    listing: listingSlugInput(property),
    name: listingName,
    // Kullanıcı açıklaması yoksa gerçek özellikli tanım (ham adres alanı KULLANILMAZ).
    description:
      description ??
      listingFactLine({
        title: property.title,
        office: tenant.name,
        priceText: money(price, property.transaction_type, currency),
        province,
        district,
        tx: property.transaction_type,
        type: property.property_type,
        rooms: feat.rooms ?? null,
        sqm: sqmNum,
      }),
    officeName: tenant.name,
    imageIds: images.map((m) => m.id),
    createdAt: property.created_at,
    price,
    currency,
    sqm: sqmNum,
    lat: location.approx?.lat ?? null,
    lng: location.approx?.lng ?? null,
    streetAddress: location.streetAddress,
    district,
    province,
  });
  // Görsel alt metni: `{tip} {oda} – {ilçe}, fotoğraf n` (kullanıcı alt metni alanı yok; olursa önceliklidir).
  const altInput = { type: property.property_type, rooms: feat.rooms ?? null, district, province, title: listingName };

  return (
    <div className="min-h-screen bg-canvas">
      <script
        type="application/ld+json"
        // JSON-LD: arama motorları için yapılandırılmış ilan verisi ("<" kaçışı script kırılmasını önler)
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <main id="main-content" className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex items-center justify-between gap-3">
          <Link href={`/vitrin/${slug}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
            <ArrowLeft className="h-4 w-4" /> Tüm portföyler
          </Link>
          {/* Favori sayacı rozeti — localStorage, hydration-güvenli */}
          <FavNavBadge slug={slug} />
        </div>

        <div className="mt-4 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div>
            {images.length > 0 ? (
              <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
                <GalleryLightbox
                  images={images.map((m, i) => ({ id: m.id, alt: listingImageAlt(altInput, i + 1) }))}
                  alt={property.title || property.property_code || "Portföy"}
                  priority
                  sizes="(max-width: 1024px) 100vw, 60vw"
                  mainClassName="relative aspect-[16/10] w-full"
                  thumbsClassName="grid grid-cols-5 gap-2 p-2"
                />
              </div>
            ) : (
              <div className="grid aspect-[16/10] place-items-center rounded-[var(--radius-panel)] border border-line bg-surface text-text-faint">
                <div className="text-center">
                  <Building2 className="mx-auto h-12 w-12" aria-hidden="true" />
                  <p className="mt-2 text-sm font-semibold">Fotoğraf yakında</p>
                </div>
              </div>
            )}

            {tours.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {tours.map((m) => (
                  <a
                    key={m.id}
                    href={m.external_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-brand-300 bg-brand-600/5 px-4 py-2 text-xs font-bold text-brand-600 transition hover:bg-brand-600/10"
                  >
                    {m.kind === "tour" ? "360° Sanal tur" : "Video izle"}
                  </a>
                ))}
              </div>
            ) : null}

            <div className="mt-5 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="rounded-full bg-mint-500/12 px-2.5 py-1 text-xs font-bold uppercase text-mint-600">
                    {property.transaction_type}
                  </span>
                  {/* Son 7 günde yayına giren ilan — published_at gerçek yayın damgası */}
                  {property.published_at != null && msSince(property.published_at) < 7 * DAY_MS ? (
                    <span className="rounded-full bg-mint-700 px-2.5 py-1 text-xs font-bold uppercase text-white">
                      Yeni
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {/* Favori — vitrin listesindeki kalple aynı localStorage anahtarı */}
                  <FavButton slug={slug} propertyId={property.id} label />
                  {/* Web Share: başlık + fiyat + mutlak ilan URL'i */}
                  <ShareButton
                    title={`${property.title || property.property_code} - ${money(price, property.transaction_type, currency)}`}
                    text={loc || undefined}
                    url={listingUrl}
                  />
                </div>
              </div>
              <h1 className="mt-3 font-display text-2xl font-extrabold text-ink-950">{property.title || property.property_code}</h1>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-text-muted">
                <MapPin className="h-4 w-4 text-brand-600 shrink-0" />
                {mapsHref ? (
                  <a
                    href={mapsHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Google Haritalar'da aç"
                    className="underline decoration-line underline-offset-2 transition hover:text-brand-600 hover:decoration-brand-400"
                  >
                    {loc || "Konumu haritada gör"}
                  </a>
                ) : (
                  "Konum belirtilmedi"
                )}
              </p>
              <p className="mt-4 font-display text-3xl font-extrabold text-brand-600">
                {money(price, property.transaction_type, currency)}
              </p>
              {/* Döviz karşılığı — kur yoksa hiç gösterilmez */}
              {fxLine ? (
                <p className="mt-1 text-xs text-text-faint" title={fxTitle}>
                  {fxLine}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-text-muted">{property.property_type}</p>

              {specs.length > 0 ? (
                <div className="mt-4 grid grid-cols-3 divide-x divide-line rounded-[var(--radius-card)] border border-line bg-canvas py-3 text-center">
                  {specs.map((s) => (
                    <span key={s.label} className="flex items-center justify-center gap-1.5 text-sm font-medium text-ink-950">
                      <s.icon className="h-4 w-4 text-brand-600" /> {s.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {description ? (
              <div className="mt-5 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
                <h2 className="font-display text-base font-extrabold text-ink-950">İlan açıklaması</h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-text-muted">{description}</p>
              </div>
            ) : null}

            <VirtualTourEmbed features={property.features} />

            {/* İlan bilgileri — yalnız dolu alanlar; fiyat/m² ve emsal yalnız gerçek veriden */}
            <section className="mt-5 rounded-[var(--radius-panel)] border border-line bg-surface p-5" aria-labelledby="ilan-bilgileri">
              <h2 id="ilan-bilgileri" className="flex items-center gap-2 font-display text-base font-extrabold text-ink-950">
                <ClipboardList className="h-4 w-4 text-brand-600" aria-hidden="true" /> İlan bilgileri
              </h2>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                {detailRows.map((r) => (
                  <div key={r.label} className="flex items-center justify-between gap-3 border-b border-line py-2.5 text-sm">
                    <dt className="text-text-muted">{r.label}</dt>
                    <dd className="text-right font-semibold text-ink-950">{r.value}</dd>
                  </div>
                ))}
              </dl>
              {pricePerSqm && compAvg ? (
                <p className="mt-3 rounded-[var(--radius-card)] bg-canvas px-3 py-2.5 text-xs leading-relaxed text-text-muted">
                  Bu ilan <strong className="text-ink-950">{tl(pricePerSqm)}/m²</strong>; {tenant.name} portföyündeki aynı
                  ilçede {compPerSqm.length} benzer işlem türündeki ilanın ortalaması{" "}
                  <strong className="text-ink-950">{tl(compAvg)}/m²</strong>. Bilgilendirme amaçlıdır, değerleme değildir.
                </p>
              ) : null}
            </section>

            <section className="mt-5 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface" aria-labelledby="konum-baslik">
              <h2 id="konum-baslik" className="flex items-center gap-2 px-5 pt-5 font-display text-base font-extrabold text-ink-950">
                <MapPin className="h-4 w-4 text-brand-600" aria-hidden="true" /> Konum
              </h2>
              {mapEmbed ? (
                // Tek "Haritayı aç" bağlantısı (MapEmbed içinde); Google varsa o, yoksa OSM.
                <MapEmbed
                  src={mapEmbed}
                  openHref={mapsHref ?? (osmOpenHref as string)}
                  areaLabel={loc}
                  approximate={!location.exact}
                />
              ) : (
                <div className="px-5 pb-5">
                  <div className="mt-3 grid h-40 place-items-center rounded-[var(--radius-card)] border border-dashed border-line bg-canvas px-4 text-center text-text-muted">
                    <div>
                      <MapPin className="mx-auto h-7 w-7 text-text-faint" aria-hidden="true" />
                      <p className="mt-2 text-sm font-semibold text-ink-950">{loc || "Konum bilgisi yakında"}</p>
                      <p className="text-xs">Bu ilan için harita konumu henüz eklenmedi.</p>
                    </div>
                  </div>
                  {mapsHref ? (
                    <a href={mapsHref} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs font-semibold text-brand-600 hover:underline">
                      Haritada ara
                    </a>
                  ) : null}
                </div>
              )}
            </section>

            <NearbyPanel places={nearbyPlaces} />

            {/* Alım maliyeti & kredi hesaplayıcısı — yalnız fiyatlı SATILIK ilanda
                (kiralıkta peşinat/taksit kavramı yok). Tamamen client hesap:
                sayfanın ISR önbelleği bozulmaz. */}
            {isSale && price != null && price > 0 ? (
              <PurchaseCalculator price={price} sqm={feat.sqm ?? null} leadAnchorId="talep-formu" />
            ) : null}

            {/* Yatırım getirisi — aynı koşullar (fiyatlı satılık) ve aynı gerekçe:
                %100 client hesap, ISR önbelleği bozulmaz. */}
            {isSale && price != null && price > 0 ? (
              <InvestmentPanel price={price} leadAnchorId="talep-formu" />
            ) : null}

            {/* Vitrin AI ilan asistanı — ofis ayarı (varsayılan kapalı) + AI anahtarı; insan devri talep formuna */}
            {chatEnabled ? <VitrinChat slug={slug} propertyId={property.id} leadAnchorId={leadOpen ? "talep-formu" : undefined} /> : null}
          </div>

          {/* Lead form — id: hesaplayıcının "bize ulaşın" düğmesi buraya kaydırır */}
          <div id="talep-formu" className="scroll-mt-6 lg:sticky lg:top-6 lg:self-start">
            <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line">
              <div className="theme-dark bg-[#071a38] p-6">
                <Link
                  href={`/vitrin/${slug}`}
                  className="flex w-fit items-center gap-2 text-mint-400 transition hover:text-mint-300"
                >
                  <ShieldCheck className="h-5 w-5" />
                  <span className="text-xs font-bold uppercase tracking-wide underline-offset-2 hover:underline">{tenant.name}</span>
                </Link>
                <h2 className="mt-3 font-display text-lg font-extrabold text-white">Bu portföy için bilgi alın</h2>
                <p className="mt-1 text-sm text-white/55">Danışmanımız kısa sürede sizinle iletişime geçsin.</p>

                {advisor ? (
                  <div className="mt-4 flex items-center gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-3">
                    {advisorAvatar?.avatar_url || advisor.photo_url || advisorAvatar?.avatar_preset ? (
                      <Avatar name={advisor.full_name} src={advisorAvatar?.avatar_url || advisor.photo_url} preset={advisorAvatar?.avatar_preset} className="h-11 w-11" />
                    ) : (
                      <span className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white/70">
                        <UserRound className="h-5 w-5" aria-hidden="true" />
                      </span>
                    )}
                    <div className="min-w-0 text-sm">
                      <p className="truncate font-bold text-white">{advisor.full_name}</p>
                      <p className="truncate text-xs text-white/55">{advisor.title || "Gayrimenkul danışmanı"}</p>
                    </div>
                    {advisor.public_slug ? (
                      <Link href={`/danisman/${advisor.public_slug}`} className="ml-auto shrink-0 text-xs font-semibold text-mint-300 hover:underline">
                        Profil
                      </Link>
                    ) : null}
                  </div>
                ) : null}

                <PublicContactActions contact={contact} tone="dark" callLabel="Ara" className="mt-4" />

                {bookingToken ? (
                  <Link
                    href={`/randevu-al/${bookingToken}`}
                    className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] border border-white/15 bg-white/5 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/10"
                  >
                    <CalendarClock className="h-4 w-4" /> Randevu al
                  </Link>
                ) : null}

                {leadOpen && tenant.lead_capture_token ? (
                  <LazyLeadForm token={tenant.lead_capture_token} provinces={provinces ?? []} vitrinSlug={slug} />
                ) : (
                  // Form yoksa müşteri çıkmaza girmesin: kapalı olduğunu söylemeden iletişim yolunu öne çıkar.
                  <div className="mt-4 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-4 py-5 text-center">
                    <p className="text-sm font-semibold text-white">Bu ilan için bizimle hemen iletişime geçin</p>
                    {contact ? (
                      <>
                        <p className="mt-1 text-xs text-white/55">Yukarıdaki düğmelerle arayabilir veya WhatsApp&apos;tan yazabilirsiniz.</p>
                        <a
                          href={contact.telHref}
                          className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-card)] bg-white px-4 text-sm font-bold text-ink-950 transition hover:bg-white/90"
                        >
                          <Phone className="h-4 w-4" aria-hidden="true" /> {contact.display}
                        </a>
                      </>
                    ) : null}
                    <Link
                      href={`/vitrin/${slug}`}
                      className="mt-3 block text-xs font-semibold text-mint-300 underline-offset-2 hover:underline"
                    >
                      {tenant.name} vitrinine dön
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* Fiyat alarmı — yalnız fiyatlı ilanda (baseline gerekli) */}
            {price != null && price > 0 ? <PriceAlertForm slug={slug} propertyId={property.id} /> : null}
          </div>
        </div>

        {similar.length > 0 ? (
          <section className="mt-10">
            <h2 className="font-display text-xl font-extrabold text-ink-950">Benzer ilanlar</h2>
            <p className="mt-1 text-xs text-text-muted">Aynı bölgede, yakın fiyat aralığındaki diğer portföyler</p>
            <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {similar.map((p) => {
                const sFeat = (p.features ?? {}) as Feat & { floor?: number | string; building_age?: number | string };
                const sCover = similarCoverMap.get(p.id);
                const sLoc = [relName(p.district as Rel), relName(p.province as Rel)].filter(Boolean).join(", ");
                const sCurrency = listingCurrency(p.features);
                const sHref = vitrinListingPath(slug, listingSlugInput(p));
                return (
                  <VitrinCardShell
                    key={p.id}
                    slug={slug}
                    item={{
                      id: p.id,
                      title: p.title || p.property_code,
                      href: sHref,
                      coverId: sCover ?? null,
                      price: p.list_price != null ? Number(p.list_price) : null,
                      tx: p.transaction_type,
                      rooms: sFeat.rooms ?? null,
                      sqm: sFeat.sqm ?? null,
                      floor: sFeat.floor ?? null,
                      buildingAge: sFeat.building_age ?? null,
                      district: relName(p.district as Rel),
                    }}
                  >
                  <Link
                    href={sHref}
                    className="lift group block overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface transition hover:border-brand-300"
                  >
                    <div className="relative aspect-[4/3] overflow-hidden bg-ink-950/5">
                      {sCover ? (
                        <Image
                          src={`/api/property-media/${sCover}`}
                          alt={p.title || "Portföy"}
                          fill
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                          unoptimized
                          className="object-cover transition group-hover:scale-105"
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-text-faint">
                          <div className="text-center">
                            <Building2 className="mx-auto h-10 w-10" aria-hidden="true" />
                            <p className="mt-1 text-xs font-semibold">Fotoğraf yakında</p>
                          </div>
                        </div>
                      )}
                      <span className="absolute left-3 top-3 rounded-full bg-ink-950/80 px-2.5 py-1 text-xs font-bold uppercase text-white">
                        {p.transaction_type}
                      </span>
                    </div>
                    <div className="p-4">
                      <p className="line-clamp-1 font-display font-bold text-ink-950">{p.title || p.property_code}</p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-text-muted">
                        <MapPin className="h-3.5 w-3.5 text-brand-600" /> {sLoc || "Konum belirtilmedi"}
                      </p>
                      <div className="mt-3 flex items-center gap-3 text-xs text-text-muted">
                        {sFeat.rooms ? <span className="flex items-center gap-1"><BedDouble className="h-3.5 w-3.5" /> {sFeat.rooms}</span> : null}
                        {sFeat.sqm ? <span className="flex items-center gap-1"><Ruler className="h-3.5 w-3.5" /> {sFeat.sqm} m²</span> : null}
                      </div>
                      <p className="mt-3 font-display text-lg font-extrabold text-brand-600">
                        {money(p.list_price != null ? Number(p.list_price) : null, p.transaction_type, sCurrency)}
                      </p>
                      {(() => {
                        const line =
                          sCurrency === "TRY" ? fxApproxLine(p.list_price != null ? Number(p.list_price) : null, fxRates) : null;
                        return line ? <p className="mt-0.5 text-xs text-text-faint" title={fxTitle}>{line}</p> : null;
                      })()}
                    </div>
                  </Link>
                  </VitrinCardShell>
                );
              })}
            </div>
          </section>
        ) : null}

        <p className="mt-8 text-center text-xs text-text-faint">
          <Link href="/" className="font-semibold underline-offset-2 transition hover:text-brand-600 hover:underline">
            Powered by EmlakSoft
          </Link>{" "}
          — Türkiye&apos;nin emlak işletim sistemi
        </p>
        <LicenseNotice officeName={tenant.name} licenseNo={tenant.license_no} phone={tenant.phone} addressLine={tenant.address_line} eidsNo={eidsNo} className="mt-6" />
        {/* Mobilde ekrana yapışan aksiyon çubuğu — sayfa sonu dolgusu içeriği örtmesin */}
        {hasMobileBar ? <div aria-hidden="true" className="h-20 lg:hidden" /> : null}
      </main>
      {hasMobileBar ? (
      <nav
        aria-label="Hızlı iletişim"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:hidden"
      >
        <div className="mx-auto flex max-w-xl gap-2">
          {contact ? (
            <a href={contact.telHref} className="focus-ring press inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-card)] bg-brand-600 px-3 text-sm font-bold text-white">
              <Phone className="h-4 w-4" aria-hidden="true" /> Ara
            </a>
          ) : null}
          {contact?.waHref ? (
            <a href={contact.waHref} target="_blank" rel="noopener noreferrer" className="focus-ring press inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-card)] border border-mint-500/40 bg-mint-500/10 px-3 text-sm font-bold text-mint-700">
              <MessageCircle className="h-4 w-4" aria-hidden="true" /> WhatsApp
            </a>
          ) : null}
          {bookingToken ? (
            <Link href={`/randevu-al/${bookingToken}`} className="focus-ring press inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-card)] border border-line bg-surface px-3 text-sm font-bold text-ink-950">
              <CalendarClock className="h-4 w-4" aria-hidden="true" /> Randevu
            </Link>
          ) : leadOpen ? (
            <a href="#talep-formu" className="focus-ring press inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-card)] border border-line bg-surface px-3 text-sm font-bold text-ink-950">
              Talep bırak
            </a>
          ) : null}
        </div>
      </nav>
      ) : null}
    </div>
  );
}

type RemovedTenant = {
  id: string;
  name: string | null;
  logo_url: string | null;
  brand_color: string | null;
  lead_capture_token: string | null;
  lead_capture_enabled: boolean | null;
};

/**
 * Yayında olmayan ilan için 404 bağlamı: ilan ofiste var mı (satıldı/kiralandı/kapatıldı → "yayından kalktı"), aynı
 * işlem türü + ilçede (yoksa ilde) en çok 4 yayındaki benzer ilan ve kapakları. İlanın başlığı/fiyatı BASILMAZ
 * (taslak ya da kapatılmış kaydın ayrıntısı sızmasın).
 */
async function loadRemovedListingCtx(
  admin: ReturnType<typeof createAdminClient>,
  tenant: RemovedTenant,
  slug: string,
  kod: string | null,
  provinces: { id: string; name: string }[],
): Promise<RemovedListingCtx> {
  // Kod biçim dışıysa ilan aranmaz; kod belirsizse (ofiste 2 eşleşme) "yayından kalktı" denmez (removed=false).
  const range = kod ? listingKodIdRange(kod) : null;
  const { data: goneRows } = range
    ? await admin
        .from("properties")
        .select("id, transaction_type, district_id, province_id")
        .gte("id", range.lo)
        .lte("id", range.hi)
        .eq("tenant_id", tenant.id)
        .eq("is_sample", false)
        .is("deleted_at", null)
        .limit(2)
    : { data: null };
  const gone = kod ? pickUniqueByKod(goneRows, kod) : null;
  let similarQuery = admin
    .from("properties")
    .select(
      "id, title, property_code, transaction_type, property_type, list_price, features, district:geo_districts(name), province:geo_provinces(name)",
    )
    .eq("tenant_id", tenant.id)
    .eq("status", "live")
    .is("deleted_at", null)
    .eq("is_sample", false)
    .or(OPEN_LISTING_OR_FILTER)
    .order("created_at", { ascending: false })
    .limit(4);
  if (gone) similarQuery = similarQuery.neq("id", gone.id);
  if (gone?.transaction_type) similarQuery = similarQuery.eq("transaction_type", gone.transaction_type);
  if (gone?.district_id) similarQuery = similarQuery.eq("district_id", gone.district_id);
  else if (gone?.province_id) similarQuery = similarQuery.eq("province_id", gone.province_id);
  const { data: rows } = await similarQuery;
  const similarRows = rows ?? [];
  let covers = new Map<string, string>();
  if (similarRows.length > 0) {
    const { data: media } = await selectWithDocumentFlag<PublicCoverCandidate[]>(PUBLIC_COVER_COLUMNS, (columns) =>
      admin
        .from("property_media")
        .select(columns)
        .eq("kind", "image")
        .in("property_id", similarRows.map((p) => p.id as string))
        .order("is_cover", { ascending: false })
        .order("sort_order", { ascending: true }),
    );
    covers = firstPublicImageByProperty(media);
  }
  return {
    slug,
    office: tenant.name ?? "Emlak ofisi",
    logoUrl: tenant.logo_url,
    brandColor: tenant.brand_color,
    removed: Boolean(gone),
    similar: similarRows.map((p) => ({
      id: p.id as string,
      href: vitrinListingPath(slug, listingSlugInput(p)),
      title: String(p.title || p.property_code || "Portföy"),
      price: money(p.list_price != null ? Number(p.list_price) : null, p.transaction_type, listingCurrency(p.features)),
      tx: p.transaction_type ?? null,
      district: relName(p.district as Rel),
      coverId: covers.get(p.id as string) ?? null,
    })),
    leadToken: tenant.lead_capture_enabled !== false && tenant.lead_capture_token ? tenant.lead_capture_token : null,
    provinces,
  };
}
