import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BedDouble,
  Bath,
  Building2,
  MapPin,
  MessageCircle,
  Phone,
  Ruler,
  ShieldCheck,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { toTelHref, toWhatsAppLink } from "@/lib/phone";
import dynamicImport from "next/dynamic";
import { LeadForm } from "@/app/lead/[token]/lead-form";
import { ShareButton } from "@/components/public/share-button";
import { FavButton } from "@/components/public/fav-button";
import { VitrinCardShell } from "@/components/public/vitrin-fav";
import { FavNavBadge } from "../fav-nav-badge";
import { PriceAlertForm } from "./price-alert-form";
import { DAY_MS, msSince } from "@/lib/clock";

// Lightbox etkileşimli client komponenti — dynamic import ile ayrı chunk'a
// alınır, galeri alanı yüklenene dek en-boy oranını koruyan iskelet görünür.
const GalleryLightbox = dynamicImport(
  () => import("@/components/public/gallery-lightbox").then((m) => m.GalleryLightbox),
  { loading: () => <div className="aspect-[16/10] w-full animate-pulse bg-ink-950/8" /> },
);

// ISR: vitrin herkese acik — CDN onbellekli, 2 dk tazelenir (jet hiz)
export const revalidate = 120;

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function money(n: number | null, tx?: string | null) {
  if (n == null) return "Fiyat için sorun";
  const s = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
  return tx === "rent" || (tx ?? "").toLowerCase().includes("kira") ? `${s}/ay` : s;
}

type Rel = { name?: string } | { name?: string }[] | null;
function relName(v: Rel) {
  if (!v) return null;
  const r = Array.isArray(v) ? v[0] : v;
  return r?.name ?? null;
}

type Feat = { rooms?: string; sqm?: number; baths?: number; description?: string };

/**
 * İlan açıklaması: `description` kolonu her kurulumda bulunmayabilir → ana sorgudan
 * ayrı ve hataya toleranslı okunur (kolon yoksa data null kalır, sayfa çalışmaya
 * devam eder). Eski kayıtlar için features.description'a düşülür.
 */
async function fetchDescription(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  features: unknown,
): Promise<string | null> {
  const { data } = await admin.from("properties").select("description").eq("id", id).maybeSingle();
  const col = (data as { description?: string | null } | null)?.description;
  const feat = ((features ?? {}) as Feat).description;
  const text = String(col ?? feat ?? "").trim();
  return text || null;
}

function buildLoc(property: { address_line?: string | null; district?: unknown; province?: unknown }) {
  return [property.address_line, relName(property.district as Rel), relName(property.province as Rel)]
    .filter(Boolean)
    .join(", ");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}): Promise<Metadata> {
  const { slug, id } = await params;
  const admin = createAdminClient();

  const [{ data: tenant }, { data: cover }] = await Promise.all([
    admin.from("tenants").select("id, name").eq("slug", slug).maybeSingle(),
    admin
      .from("property_media")
      .select("id")
      .eq("property_id", id)
      .eq("kind", "image")
      .order("is_cover", { ascending: false })
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!tenant) return { title: "İlan bulunamadı" };

  const { data: property } = await admin
    .from("properties")
    .select(
      "id, title, property_code, transaction_type, property_type, list_price, address_line, features, province:geo_provinces(name), district:geo_districts(name)",
    )
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .eq("status", "live")
    .is("deleted_at", null)
    .maybeSingle();
  if (!property) return { title: "İlan bulunamadı" };

  const priceText = money(property.list_price != null ? Number(property.list_price) : null, property.transaction_type);
  const title = `${property.title || property.property_code} - ${priceText}`;
  const loc = buildLoc(property);
  const rawDesc = await fetchDescription(admin, id, property.features);
  const description = (
    rawDesc ??
    `${loc || "Türkiye"} · ${property.property_type} · ${property.transaction_type} · ${priceText} — ${tenant.name} güvencesiyle.`
  )
    .replace(/\s+/g, " ")
    .slice(0, 160);

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/vitrin/${slug}/${id}` },
    openGraph: {
      type: "website",
      locale: "tr_TR",
      siteName: tenant.name ?? "EmlakSoft",
      title,
      description,
      url: `/vitrin/${slug}/${id}`,
      // metadataBase sayesinde mutlak URL'e çevrilir — WhatsApp önizleme kartı bunu okur
      images: cover ? [{ url: `/api/property-media/${cover.id}`, width: 1200, height: 750, alt: title }] : undefined,
    },
    twitter: cover
      ? { card: "summary_large_image", title, description, images: [`/api/property-media/${cover.id}`] }
      : { card: "summary", title, description },
  };
}

export default async function VitrinPropertyPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const admin = createAdminClient();

  // tenant (slug), media (params id) ve provinces (bağımsız) yalnızca params'a bağlı → paralel
  const [{ data: tenant }, { data: mediaRows }, { data: provinces }] = await Promise.all([
    admin
      .from("tenants")
      .select("id, name, phone, lead_capture_token, lead_capture_enabled")
      .eq("slug", slug)
      .maybeSingle(),
    admin
      .from("property_media")
      .select("id, kind, external_url, is_cover, sort_order")
      .eq("property_id", id)
      .order("is_cover", { ascending: false })
      .order("sort_order", { ascending: true }),
    admin.from("geo_provinces").select("id, name").eq("is_active", true).order("name"),
  ]);
  if (!tenant) notFound();

  const { data: property } = await admin
    .from("properties")
    .select(
      "id, title, property_code, transaction_type, property_type, status, list_price, address_line, lat, lng, created_at, published_at, features, province_id, district_id, province:geo_provinces(name), district:geo_districts(name)",
    )
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .eq("status", "live")
    .is("deleted_at", null)
    .maybeSingle();
  if (!property) notFound();

  const price = property.list_price != null ? Number(property.list_price) : null;

  // Açıklama + benzer ilanlar yalnızca property'ye bağlı → paralel.
  // Benzerlik: aynı işlem türü + aynı İLÇE (ilçe yoksa aynı İL) + fiyat ±%30,
  // kendisi hariç, en fazla 4 adet. İlçe m² fiyatı için ilden çok daha güçlü
  // sinyal olduğundan önce ilçe denenir (resolveGeoHint gerekçesiyle aynı).
  let similarQuery = admin
    .from("properties")
    .select(
      "id, title, property_code, transaction_type, list_price, features, province:geo_provinces(name), district:geo_districts(name)",
    )
    .eq("tenant_id", tenant.id)
    .eq("status", "live")
    .is("deleted_at", null)
    .neq("id", property.id)
    .eq("transaction_type", property.transaction_type)
    .order("created_at", { ascending: false })
    .limit(4);
  if (property.district_id) similarQuery = similarQuery.eq("district_id", property.district_id);
  else if (property.province_id) similarQuery = similarQuery.eq("province_id", property.province_id);
  if (price != null && price > 0) {
    similarQuery = similarQuery.gte("list_price", Math.round(price * 0.7)).lte("list_price", Math.round(price * 1.3));
  }
  const [description, { data: similarData }] = await Promise.all([
    fetchDescription(admin, id, property.features),
    similarQuery,
    // Günlük görüntülenme sayacı (listing_views): atomik upsert +1.
    // NOT: Sayfa ISR ile 120 sn CDN önbellekli — sayaç yalnızca yeniden
    // doğrulama render'larında artar, yani YAKLAŞIK sayımdır (trend göstergesi).
    // Hata sayfayı düşürmesin diye sonuç yutulur.
    admin
      .rpc("increment_listing_view", { p_tenant_id: tenant.id, p_property_id: property.id })
      .then(({ error }) => {
        if (error) console.error("increment_listing_view", error.message);
      }),
  ]);
  const similar = similarData ?? [];

  const similarCoverMap = new Map<string, string>();
  if (similar.length) {
    const { data: similarMedia } = await admin
      .from("property_media")
      .select("id, property_id, is_cover, sort_order")
      .eq("kind", "image")
      .in("property_id", similar.map((p) => p.id))
      .order("is_cover", { ascending: false })
      .order("sort_order", { ascending: true });
    for (const m of similarMedia ?? []) {
      if (!similarCoverMap.has(m.property_id)) similarCoverMap.set(m.property_id, m.id);
    }
  }

  const media = mediaRows ?? [];
  const images = media.filter((m) => m.kind === "image");
  const tours = media.filter((m) => m.kind !== "image");

  const feat = (property.features ?? {}) as Feat;
  const loc = buildLoc(property);

  const mapsHref =
    property.lat != null && property.lng != null
      ? `https://www.google.com/maps?q=${property.lat},${property.lng}`
      : loc
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`
        : null;

  const specs = [
    feat.rooms ? { icon: BedDouble, label: feat.rooms } : null,
    feat.baths ? { icon: Bath, label: `${feat.baths} banyo` } : null,
    feat.sqm ? { icon: Ruler, label: `${feat.sqm} m²` } : null,
  ].filter(Boolean) as { icon: typeof BedDouble; label: string }[];

  const officeTel = toTelHref(tenant.phone);
  const officeWhatsApp = toWhatsAppLink(
    tenant.phone,
    `Merhaba, ${property.title || property.property_code} ilanı hakkında bilgi almak istiyorum. ${BASE_URL}/vitrin/${slug}/${id}`,
  );

  const coverId = images[0]?.id ?? null;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: property.title || property.property_code,
    description: description ?? `${loc || "Türkiye"} · ${property.property_type} · ${property.transaction_type}`,
    url: `${BASE_URL}/vitrin/${slug}/${id}`,
    ...(coverId ? { image: [`${BASE_URL}/api/property-media/${coverId}`] } : {}),
    ...(property.created_at ? { datePosted: property.created_at } : {}),
    ...(price != null
      ? {
          offers: {
            "@type": "Offer",
            price,
            priceCurrency: "TRY",
            availability: "https://schema.org/InStock",
          },
        }
      : {}),
    address: {
      "@type": "PostalAddress",
      ...(property.address_line ? { streetAddress: property.address_line } : {}),
      ...(relName(property.district as Rel) ? { addressLocality: relName(property.district as Rel) } : {}),
      ...(relName(property.province as Rel) ? { addressRegion: relName(property.province as Rel) } : {}),
      addressCountry: "TR",
    },
    provider: { "@type": "RealEstateAgent", name: tenant.name ?? "EmlakSoft" },
  };

  return (
    <div className="min-h-screen bg-canvas">
      <script
        type="application/ld+json"
        // JSON-LD: arama motorları için yapılandırılmış ilan verisi ("<" kaçışı script kırılmasını önler)
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <div className="mx-auto max-w-5xl px-4 py-8">
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
              <div className="overflow-hidden rounded-[18px] border border-line bg-surface">
                <GalleryLightbox
                  images={images.map((m) => ({ id: m.id }))}
                  alt={property.title || property.property_code || "Portföy"}
                  priority
                  sizes="(max-width: 1024px) 100vw, 60vw"
                  mainClassName="relative aspect-[16/10] w-full"
                  thumbsClassName="grid grid-cols-5 gap-2 p-2"
                />
              </div>
            ) : (
              <div className="grid aspect-[16/10] place-items-center rounded-[18px] border border-line bg-surface text-text-faint">
                <Building2 className="h-12 w-12" />
              </div>
            )}

            {tours.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {tours.map((m) => (
                  <a
                    key={m.id}
                    href={m.external_url ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-brand-300 bg-brand-600/5 px-4 py-2 text-xs font-bold text-brand-600 transition hover:bg-brand-600/10"
                  >
                    {m.kind === "tour" ? "360° Sanal tur" : "Video izle"}
                  </a>
                ))}
              </div>
            ) : null}

            <div className="mt-5 rounded-[18px] border border-line bg-surface p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="rounded-full bg-mint-500/12 px-2.5 py-1 text-[11px] font-bold uppercase text-mint-600">
                    {property.transaction_type}
                  </span>
                  {/* Son 7 günde yayına giren ilan — published_at gerçek yayın damgası */}
                  {property.published_at != null && msSince(property.published_at) < 7 * DAY_MS ? (
                    <span className="rounded-full bg-mint-500 px-2.5 py-1 text-[11px] font-bold uppercase text-white">
                      Yeni
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {/* Favori — vitrin listesindeki kalple aynı localStorage anahtarı */}
                  <FavButton slug={slug} propertyId={property.id} label />
                  {/* Web Share: başlık + fiyat + mutlak ilan URL'i */}
                  <ShareButton
                    title={`${property.title || property.property_code} - ${money(price, property.transaction_type)}`}
                    text={loc || undefined}
                    url={`${BASE_URL}/vitrin/${slug}/${id}`}
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
                {money(price, property.transaction_type)}
              </p>
              <p className="mt-1 text-xs text-text-muted">{property.property_type}</p>

              {specs.length > 0 ? (
                <div className="mt-4 grid grid-cols-3 divide-x divide-line rounded-[14px] border border-line bg-canvas py-3 text-center">
                  {specs.map((s) => (
                    <span key={s.label} className="flex items-center justify-center gap-1.5 text-sm font-medium text-ink-950">
                      <s.icon className="h-4 w-4 text-brand-600" /> {s.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {description ? (
              <div className="mt-5 rounded-[18px] border border-line bg-surface p-5">
                <h2 className="font-display text-base font-extrabold text-ink-950">İlan açıklaması</h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-text-muted">{description}</p>
              </div>
            ) : null}
          </div>

          {/* Lead form */}
          <div className="lg:sticky lg:top-6 lg:self-start">
            <div className="overflow-hidden rounded-[18px] border border-line">
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

                {officeTel || officeWhatsApp ? (
                  <div className={`mt-4 grid gap-2 ${officeTel && officeWhatsApp ? "grid-cols-2" : ""}`}>
                    {officeTel ? (
                      <a
                        href={officeTel}
                        className="btn-shine inline-flex items-center justify-center gap-2 rounded-[12px] bg-white px-4 py-3 text-sm font-bold text-ink-950 transition hover:bg-white/90"
                      >
                        <Phone className="h-4 w-4" /> Ara
                      </a>
                    ) : null}
                    {officeWhatsApp ? (
                      <a
                        href={officeWhatsApp}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 rounded-[12px] border border-mint-400/30 bg-mint-500/10 px-4 py-3 text-sm font-bold text-mint-300 transition hover:bg-mint-500/20"
                      >
                        <MessageCircle className="h-4 w-4" /> WhatsApp
                      </a>
                    ) : null}
                  </div>
                ) : null}

                {tenant.lead_capture_enabled !== false && tenant.lead_capture_token ? (
                  <LeadForm token={tenant.lead_capture_token} provinces={provinces ?? []} vitrinSlug={slug} />
                ) : (
                  <p className="mt-4 rounded-[12px] border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60">
                    Talep formu şu anda kapalı.
                  </p>
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
                return (
                  <VitrinCardShell
                    key={p.id}
                    slug={slug}
                    item={{
                      id: p.id,
                      title: p.title || p.property_code,
                      href: `/vitrin/${slug}/${p.id}`,
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
                    href={`/vitrin/${slug}/${p.id}`}
                    className="lift group block overflow-hidden rounded-[18px] border border-line bg-surface transition hover:border-brand-300"
                  >
                    <div className="relative aspect-[4/3] overflow-hidden bg-ink-950/5">
                      {sCover ? (
                        <Image
                          src={`/api/property-media/${sCover}`}
                          alt={p.title || "Portföy"}
                          fill
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                          className="object-cover transition group-hover:scale-105"
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-text-faint">
                          <Building2 className="h-10 w-10" />
                        </div>
                      )}
                      <span className="absolute left-3 top-3 rounded-full bg-ink-950/80 px-2.5 py-1 text-[11px] font-bold uppercase text-white">
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
                        {money(p.list_price != null ? Number(p.list_price) : null, p.transaction_type)}
                      </p>
                    </div>
                  </Link>
                  </VitrinCardShell>
                );
              })}
            </div>
          </section>
        ) : null}

        <p className="mt-8 text-center text-[11px] text-text-faint">
          <Link href="/" className="font-semibold underline-offset-2 transition hover:text-brand-600 hover:underline">
            Powered by EmlakSoft
          </Link>{" "}
          — Türkiye&apos;nin emlak işletim sistemi
        </p>
      </div>
    </div>
  );
}
