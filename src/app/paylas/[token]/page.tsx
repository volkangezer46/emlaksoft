import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { after } from "next/server";
import { Bath, BedDouble, Building2, Check, MapPin, Ruler, ShieldCheck } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPast } from "@/lib/clock";
import { recordShareOpen } from "@/lib/presentation-open";
import { isLinkPreviewHeaders } from "@/lib/link-preview";
import { officeMessageHref, resolvePublicContact } from "@/lib/public-contact";
import { PublicContactActions } from "@/components/public/public-contact-actions";
import { formatPublicPrice, listingCurrency, type ListingCurrency } from "@/lib/public-price";
import { publicLocation } from "@/lib/public-location";
import dynamicImport from "next/dynamic";
import { ShareFeedback } from "@/components/public/share-feedback";
import { ShareButton } from "@/components/public/share-button";
import { createShortLivedPropertyMediaUrl } from "@/lib/property-media-access";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { isPublicListingImage, selectWithDocumentFlag } from "@/lib/public-property-media";
import { PublicModuleClosed } from "@/components/modules/public-module-closed";
import { isPublicFeatureClosed } from "@/lib/modules/public";
import { normalizeExternalHref } from "@/lib/external-href";
import { LicenseNotice } from "@/components/public/license-notice";
import { readPropertyDescription } from "@/lib/property-description";

type ShareMediaRow = {
  id: string;
  kind: string;
  file_type: string | null;
  file_name: string | null;
  external_url: string | null;
  is_cover: boolean;
  is_document?: boolean | null;
};

export const dynamic = "force-dynamic";

// Lightbox etkileşimli client komponenti — dynamic import ile ayrı chunk'a
// alınır, galeri alanı yüklenene dek en-boy oranını koruyan iskelet görünür.
const GalleryLightbox = dynamicImport(
  () => import("@/components/public/gallery-lightbox").then((m) => m.GalleryLightbox),
  { loading: () => <div className="aspect-[16/10] w-full animate-pulse rounded-[var(--radius-card)] bg-white/10" /> },
);

// SK8 B094: ilanın para birimi (features.currency) formatMoney ile.
function money(n: number | null, currency: ListingCurrency) {
  return formatPublicPrice(n, null, currency);
}

// Paylaşım linkleri kişiye özeldir → arama motorlarına kapalı; ana dağıtım kanalı
// WhatsApp olduğundan önizleme kartı kritiktir: görsel `opengraph-image.tsx` (ofis markası + kapak fotoğrafı,
// fotoğrafsız ilanda markalı yedek kart; tek kaynak src/lib/public-link-og.ts).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const noindex: Metadata = { robots: { index: false, follow: false } };
  const { token } = await params;
  const admin = createAdminClient();

  const { data: share } = await admin
    .from("share_links")
    .select("tenant_id, entity_type, entity_id, expires_at, tenant:tenants(name, status)")
    .eq("token", token)
    .maybeSingle();
  const metadataTenant = share && (Array.isArray(share.tenant) ? share.tenant[0] : share.tenant);
  if (
    !share ||
    share.entity_type !== "property" ||
    isPast(share.expires_at) ||
    !metadataTenant ||
    !isPublicTenantActive(metadataTenant.status)
  ) return noindex;

  const { data: property } = await admin
    .from("properties")
    .select("title, property_code, transaction_type, property_type, list_price, features")
    .eq("id", share.entity_id)
    .eq("tenant_id", share.tenant_id)
    .eq("is_sample", false)
    .is("deleted_at", null)
    .maybeSingle();
  if (!property) return noindex;

  const tenantRel = share.tenant as { name?: string; status?: string } | { name?: string; status?: string }[] | null;
  const office = (Array.isArray(tenantRel) ? tenantRel[0]?.name : tenantRel?.name) ?? "EmlakSoft";
  const priceText = money(property.list_price != null ? Number(property.list_price) : null, listingCurrency(property.features));
  const title = `${property.title || property.property_code} - ${priceText}`;
  const rawDesc = readPropertyDescription(property.features);
  const description = (
    rawDesc ?? `${property.transaction_type} ${property.property_type} · ${priceText} — ${office} tarafından paylaşıldı.`
  )
    .replace(/\s+/g, " ")
    .slice(0, 160);

  return {
    ...noindex,
    title: { absolute: title },
    description,
    openGraph: {
      type: "website",
      locale: "tr_TR",
      siteName: office,
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default async function PublicSharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: share } = await admin
    .from("share_links")
    .select("id, tenant_id, entity_type, entity_id, expires_at, created_by, tenant:tenants(name, status, phone, license_no, address_line, lead_capture_token, lead_capture_enabled)")
    .eq("token", token)
    .maybeSingle();

  const shareTenant = share && (Array.isArray(share.tenant) ? share.tenant[0] : share.tenant);
  if (
    !share ||
    share.entity_type !== "property" ||
    !shareTenant ||
    !isPublicTenantActive(shareTenant.status)
  ) notFound();
  if (await isPublicFeatureClosed(admin, share.tenant_id, "presentations")) return <PublicModuleClosed officeName={shareTenant.name} />;
  // Süresi dolmuş link de geçersiz bağlantıdır: gerçek 404 + ortak "bağlantı geçersiz" ekranı (SK8 B153).
  if (isPast(share.expires_at)) notFound();

  // property + media + oluşturan danışman + istek başlıkları yalnızca share'e bağlı → paralel. Görüntülenme sayacı
  // render yolunda DEĞİL: yanıttan sonra atomik RPC ile (after, SK8 B150).
  const [{ data: property }, { data: mediaRows }, { data: shareCreator }, eidsRes, requestHeaders] = await Promise.all([
    admin
      .from("properties")
      .select(
        "title, property_code, transaction_type, property_type, list_price, address_line, lat, lng, features, assigned_to, province:geo_provinces(name), district:geo_districts(name)",
      )
      .eq("id", share.entity_id)
      .eq("tenant_id", share.tenant_id)
      .eq("is_sample", false)
      .is("deleted_at", null)
      .maybeSingle(),
    // KVKK P0-9: is_document seçilir (sütun yoksa sütunsuz tekrar -> ad kuralı).
    selectWithDocumentFlag<ShareMediaRow[]>("id, kind, file_type, file_name, external_url, is_cover", (columns) =>
      admin
        .from("property_media")
        .select(columns)
        .eq("property_id", share.entity_id)
        .eq("tenant_id", share.tenant_id)
        .order("is_cover", { ascending: false })
        .order("sort_order", { ascending: true }),
    ),
    share.created_by
      ? admin
          .from("profiles")
          .select("id")
          .eq("id", share.created_by)
          .eq("tenant_id", share.tenant_id)
          .eq("is_active", true)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // EİDS taşınmaz no (20260826002950) AYRI sorgu: sütun yoksa yalnız bu satır düşer, sayfa bozulmaz (vitrin ilan detayı ile aynı kural).
    admin
      .from("properties")
      .select("eids_property_no")
      .eq("id", share.entity_id)
      .eq("tenant_id", share.tenant_id)
      .eq("is_sample", false)
      .maybeSingle(),
    headers(),
  ]);

  if (!property) notFound();
  const eidsNo = eidsRes.error ? null : ((eidsRes.data?.eids_property_no as string | null | undefined) ?? null);

  // Paylaşım istihbaratı (SK8 B150): yanıttan SONRA atomik +1; İLK açılışta (RPC 1 döndürürse) linki oluşturan aktif
  // danışmana tek bildirim. WhatsApp/Telegram önizleme botu ve ön-yükleme ne sayaca ne bildirime girer.
  const isPreviewBot = isLinkPreviewHeaders(requestHeaders);
  const shareLabel = property.title || property.property_code || "Portföy";
  after(() =>
    recordShareOpen(
      admin,
      {
        token,
        tenant_id: share.tenant_id,
        entity_id: share.entity_id,
        notifyUserId: (shareCreator as { id?: string } | null)?.id ?? null,
        label: shareLabel,
      },
      { isPreviewBot },
    ),
  );

  const description = readPropertyDescription(property.features);

  const media = mediaRows ?? [];
  // KVKK P0-9: belge (is_document; sütun yoksa belge adlı) görsel paylaşım linkinde gösterilmez (tek kural).
  const images = media.filter((m) => isPublicListingImage(m));
  const tours = media.flatMap((item) => {
    const externalUrl = normalizeExternalHref(item.external_url);
    return item.kind !== "image" && externalUrl
      ? [{ ...item, external_url: externalUrl }]
      : [];
  });

  type ShareTenant = {
    name?: string;
    phone?: string | null;
    license_no?: string | null;
    address_line?: string | null;
    lead_capture_token?: string | null;
    lead_capture_enabled?: boolean | null;
  };
  const tenantRaw = share.tenant as ShareTenant | ShareTenant[] | null;
  const tenantRow = Array.isArray(tenantRaw) ? tenantRaw[0] : tenantRaw;
  const office = tenantRow?.name;
  const province = property.province as { name?: string } | { name?: string }[] | null;
  const district = property.district as { name?: string } | { name?: string }[] | null;
  const pName = Array.isArray(province) ? province[0]?.name : province?.name;
  const dName = Array.isArray(district) ? district[0]?.name : district?.name;
  const feat = property.features as { rooms?: string; sqm?: number; baths?: number } | null;
  const assignedTo = (property.assigned_to as string | null) ?? null;
  const { data: agent } = assignedTo
    ? await admin
        .from("profiles")
        .select("full_name, phone")
        .eq("id", assignedTo)
        .eq("tenant_id", share.tenant_id)
        .eq("is_active", true)
        .maybeSingle()
    : { data: null };
  // İletişim (SK8 B148): ilana atanmış danışman → ofisin girdiği telefon; yoksa "Ofise mesaj bırakın" (sahte düğme yok).
  const listingLabel = property.title || property.property_code || "Portföy";
  const contact = resolvePublicContact({
    advisorPhone: agent?.phone ?? null,
    officePhone: tenantRow?.phone ?? null,
    whatsappText: `Merhaba, paylaştığınız "${listingLabel}" ilanı hakkında bilgi almak istiyorum.`,
  });
  const questionHref = resolvePublicContact({
    advisorPhone: agent?.phone ?? null,
    officePhone: tenantRow?.phone ?? null,
    whatsappText: `Merhaba, paylaştığınız "${listingLabel}" ilanı hakkında bir sorum var.`,
  })?.waHref ?? null;
  const currency = listingCurrency(property.features);
  const priceLabel = money(property.list_price != null ? Number(property.list_price) : null, currency);

  // Konum gizliliği (SK8 B152): mahalle/ilçe düzeyi; açık adres ve tam koordinat basılmaz, Google bağlantısı ilçe araması.
  const location = publicLocation({
    id: share.entity_id,
    addressLine: property.address_line,
    lat: property.lat,
    lng: property.lng,
    district: dName ?? null,
    province: pName ?? null,
  });
  const locText = location.text;
  const mapsHref = location.mapsHref;

  const specs = [
    feat?.rooms ? { icon: BedDouble, label: feat.rooms } : null,
    feat?.baths ? { icon: Bath, label: `${feat.baths} banyo` } : null,
    feat?.sqm ? { icon: Ruler, label: `${feat.sqm} m²` } : null,
  ].filter(Boolean) as { icon: typeof BedDouble; label: string }[];

  return (
    <div className="min-h-screen bg-[image:var(--grad-ink)] px-4 py-10 text-white sm:py-16">
      <div className="pointer-events-none fixed inset-0 -z-10 grid-overlay-dark opacity-30" />
      <div className="pointer-events-none fixed -right-20 -top-20 -z-10 h-72 w-72 rounded-full bg-brand-600/25 blur-[110px]" />
      <div className="pointer-events-none fixed -left-16 bottom-0 -z-10 h-64 w-64 rounded-full bg-mint-500/20 blur-[110px]" />

      <div className="mx-auto max-w-2xl">
        <div className="mb-5 flex items-center justify-center gap-2 text-xs font-semibold text-white/50">
          <span className="grid h-6 w-6 place-items-center rounded-[var(--radius-control)] bg-white/10 text-xs font-bold text-white">
            {office ? office[0] : "E"}
          </span>
          {office || "EmlakSoft"} tarafından paylaşıldı
        </div>

        <div className="overflow-hidden rounded-[var(--radius-hero)] border border-white/15 bg-white/[0.06] shadow-[0_30px_80px_-40px_rgba(0,0,0,0.7)] backdrop-blur-xl">
          {/* theme-dark: katmansız h1 kuralı (--heading) koyu zeminde beyaza döner (SK8 B147; alttaki açık kartlar etkilenmez). */}
          <div className="theme-dark relative border-b border-white/10 bg-white/[0.03] px-6 py-6">
            <div className="flex items-center justify-between gap-3">
              <span className="rounded-full border border-mint-400/25 bg-mint-500/12 px-3 py-1 text-xs font-bold uppercase tracking-[0.08em] text-mint-400">
                {property.transaction_type}
              </span>
              <span className="flex items-center gap-2">
                <span className="hidden items-center gap-1.5 text-xs font-semibold text-white/40 sm:flex">
                  <ShieldCheck className="h-3.5 w-3.5 text-mint-400" /> {office ? `${office} portföyü` : "Ofis portföyü"}
                </span>
                {/* Web Share: link o anki paylaşım adresi (window.location) */}
                <ShareButton
                  tone="dark"
                  title={`${property.title || property.property_code} - ${priceLabel}`}
                />
              </span>
            </div>
            <h1 className="mt-3 font-display text-2xl font-extrabold leading-tight text-white sm:text-3xl">
              {property.title || property.property_code}
            </h1>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-white/60">
              <MapPin className="h-4 w-4 text-cyan-400 shrink-0" />
              {mapsHref ? (
                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Google Haritalar'da aç"
                  className="underline decoration-white/20 underline-offset-2 transition hover:text-white hover:decoration-cyan-400"
                >
                  {locText || "Konumu haritada gör"}
                </a>
              ) : (
                "Konum belirtilmedi"
              )}
            </p>
          </div>

          {images.length > 0 ? (
            <div className="border-b border-white/10 p-4">
              <GalleryLightbox
                images={images.map((m) => ({
                  id: m.id,
                  src: createShortLivedPropertyMediaUrl(m.id, "share"),
                }))}
                alt={property.title || property.property_code || "Portföy"}
                priority
                sizes="(max-width: 640px) 100vw, 600px"
                mainClassName="relative aspect-[16/10] w-full overflow-hidden rounded-[var(--radius-card)]"
                thumbsClassName="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6"
              />
              {tours.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {tours.map((m) => (
                    <a
                      key={m.id}
                      href={m.external_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-mint-400/30 bg-mint-500/10 px-3 py-1.5 text-xs font-bold text-mint-300 transition hover:bg-mint-500/20"
                    >
                      {m.kind === "tour" ? "360° Sanal tur" : "Video izle"}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="px-6 py-6">
            <p className="font-display text-4xl font-extrabold text-mint-300 sm:text-5xl">{priceLabel}</p>
            <p className="mt-1 text-xs font-medium text-white/40">{property.property_type}</p>

            {specs.length > 0 && (
              <div className="mt-5 grid grid-cols-3 divide-x divide-white/10 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] py-3 text-center">
                {specs.map((s) => (
                  <span key={s.label} className="flex items-center justify-center gap-1.5 text-sm font-medium text-white/75">
                    <s.icon className="h-4 w-4 text-cyan-400" /> {s.label}
                  </span>
                ))}
              </div>
            )}

            {description ? (
              <div className="mt-5 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4">
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-white/40">İlan açıklaması</p>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-white/75">{description}</p>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-2">
              {[...(eidsNo ? ["EİDS no kayıtlı"] : []), "Güncel fiyat", "Aktif ilan"].map((t) => (
                <span key={t} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/60">
                  <Check className="h-3 w-3 text-mint-400" /> {t}
                </span>
              ))}
            </div>

            {agent?.full_name && (
              <div className="mt-6 flex items-center gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[image:var(--grad-brand)] text-sm font-bold text-white">
                  {initials(agent.full_name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-white">{agent.full_name}</p>
                  <p className="text-xs text-white/45">{office || "Yetkili danışman"}</p>
                </div>
                <Building2 className="h-4 w-4 shrink-0 text-white/25" />
              </div>
            )}

            <PublicContactActions
              contact={contact}
              tone="dark"
              callLabel="Ara"
              fallbackHref={officeMessageHref(tenantRow)}
              className="mt-6"
            />

            {/* Mikro-geri bildirim: beğeni → danışmana bildirim; soru → önyazılı WhatsApp (yalnız WhatsApp'lı numarada) */}
            <ShareFeedback token={token} whatsappHref={questionHref} />

            <p className="mt-6 text-center text-xs text-white/35">
              Bu sayfa salt okunur bir paylaşım linkidir · teklif ve randevu için ofisle iletişime geçin
            </p>
          </div>
        </div>

        {/* Taşınmaz Ticareti Yönetmeliği m.14/2-i: unvan + yetki belgesi no; EİDS no yalnız doluysa (tek bileşen). */}
        <LicenseNotice
          officeName={office}
          licenseNo={tenantRow?.license_no}
          phone={tenantRow?.phone}
          addressLine={tenantRow?.address_line}
          eidsNo={eidsNo}
          className="mt-6"
        />

        <p className="mt-6 text-center text-xs text-white/30">
          <Link href="/" className="font-semibold underline-offset-2 transition hover:text-white/70 hover:underline">
            Powered by EmlakSoft
          </Link>{" "}
          — Türkiye&apos;nin emlak işletim sistemi
        </p>
      </div>
    </div>
  );
}
