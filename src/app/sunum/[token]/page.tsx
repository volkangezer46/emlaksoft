import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { after } from "next/server";
import {
  Bath,
  BedDouble,
  Building2,
  CalendarDays,
  Flame,
  Layers,
  MapPin,
  Phone,
  Ruler,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { PublicModuleClosed } from "@/components/modules/public-module-closed";
import { isPublicFeatureClosed } from "@/lib/modules/public";
import { officeMessageHref, resolvePublicContact } from "@/lib/public-contact";
import { PublicContactActions } from "@/components/public/public-contact-actions";
import { formatPublicPrice, listingCurrency } from "@/lib/public-price";
import { PrintButton } from "@/components/ui/print-button";
import { createShortLivedPropertyMediaUrl } from "@/lib/property-media-access";
import { isPublicListingImage } from "@/lib/public-property-media";
import { selectWithMediaMeta } from "@/lib/media/meta-query";
import { isFloorPlan, mediaShortLabel } from "@/lib/media/room-tags";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { LicenseNotice } from "@/components/public/license-notice";
import { readPropertyDescription } from "@/lib/property-description";
import { loadPresentationOg, publicLinkMetadata } from "@/lib/public-link-og";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { recordPresentationOpen } from "@/lib/presentation-open";
import { isLinkPreviewHeaders } from "@/lib/link-preview";
import { PresentationFeedback } from "@/components/public/presentation-feedback";
import { isPresentationFeedbackVerdict, type PresentationFeedbackVerdict } from "@/lib/presentation-feedback";

// Sunum linkleri kişiye özeldir → arama motorlarına kapalı (degerleme-raporu deseni). Ana dağıtım kanalı
// WhatsApp: önizleme ofis markalı (başlık, site adı; görsel `opengraph-image.tsx`, tek kaynak public-link-og).
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return {
    ...publicLinkMetadata(await loadPresentationOg(token), "Portföy sunumu"),
    robots: { index: false, follow: false },
  };
}

// Görüntülenme sayacı her açılışta işlesin; sayfa önbelleğe takılmasın.
export const dynamic = "force-dynamic";

const BRAND_FALLBACK = "#1463FF";

type Rel = { name?: string } | { name?: string }[] | null;
function relName(v: Rel) {
  if (!v) return null;
  const r = Array.isArray(v) ? v[0] : v;
  return r?.name ?? null;
}

type Feat = {
  rooms?: string | null;
  sqm?: number | string | null;
  baths?: number | string | null;
  floor?: number | string | null;
  building_age?: number | string | null;
  heating?: string | null;
  description?: string | null;
};

/**
 * Sunumu açan, sunumu hazırlayan danışmanın kendisi mi? (panelden "yeni sekmede aç" önizlemesi açılış bildirimi
 * üretmesin.) Oturum çerezi yoksa Supabase istemcisi hiç kurulmaz; varsa yerel JWT doğrulaması (getClaims).
 */
async function viewerIsCreator(createdBy: string | null): Promise<boolean> {
  if (!createdBy) return false;
  const jar = await cookies();
  if (!jar.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"))) return false;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    return data?.claims?.sub === createdBy;
  } catch {
    return false;
  }
}

// SK8 B094: fiyat ilanın para biriminden (features.currency) formatMoney ile.
function money(n: number | null, tx: string, features: unknown) {
  return formatPublicPrice(n, tx, listingCurrency(features));
}

/**
 * Müşteriye özel portföy sunumunun PUBLIC sayfası.
 *
 * Token'ı bilen müşteri telefon/masaüstünde şık bir "slayt" akışı görür;
 * yazdırınca her portföy ayrı A4 sayfa olur (globals.css @media print +
 * Tailwind print: varyantları). RLS anon'a açılmadığı için sorgular service
 * role ile yapılır (degerleme-raporu/[token] deseni). Görüntülenme sayacı
 * after() ile yanıttan SONRA artırılır — müşteri sayacı beklemez.
 */
export default async function PublicPresentationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // public_token uuid tipinde; uuid olmayan girdi sorguya gitmeden 404 olsun.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) notFound();

  const admin = createAdminClient();
  const { data: pres } = await admin
    .from("presentations")
    .select("id, tenant_id, title, customer_name, customer_id, property_ids, note, created_by, created_at, view_count")
    .eq("public_token", token)
    .maybeSingle();
  if (!pres) notFound();

  const propertyIds = (pres.property_ids ?? []) as string[];

  const [{ data: tenant }, { data: advisor }, { data: propertyData }] = await Promise.all([
    admin
      .from("tenants")
      .select("name, status, phone, logo_url, brand_color, license_no, address_line, lead_capture_token, lead_capture_enabled")
      .eq("id", pres.tenant_id)
      .maybeSingle(),
    // Sunumu hazırlayan danışman: yalnız bu ofisin AKTİF profili (pasif/başka ofis profili iletişime çıkmaz).
    pres.created_by
      ? admin
          .from("profiles")
          .select("full_name, phone")
          .eq("id", pres.created_by)
          .eq("tenant_id", pres.tenant_id)
          .eq("is_active", true)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    propertyIds.length
      ? admin
          .from("properties")
          .select(
            "id, property_code, title, transaction_type, property_type, status, list_price, features, province:geo_provinces(name), district:geo_districts(name)",
          )
          .in("id", propertyIds)
          .eq("tenant_id", pres.tenant_id)
          .eq("is_sample", false)
          .is("deleted_at", null)
      : Promise.resolve({ data: [] }),
  ]);
  if (!tenant || !isPublicTenantActive(tenant.status)) notFound();
  if (await isPublicFeatureClosed(admin, pres.tenant_id, "presentations")) return <PublicModuleClosed officeName={tenant.name} />;

  // Sunum sonrası taslağa çekilen/silinen portföyler linke sızmasın
  // (public medya API'siyle aynı çizgi); seçim sırası korunur.
  const byId = new Map((propertyData ?? []).filter((p) => p.status !== "draft").map((p) => [p.id as string, p]));
  const properties = propertyIds.map((id) => byId.get(id)).filter((p) => p != null);
  if (properties.length === 0) notFound();

  // Tüm portföylerin görselleri tek sorguda: kapak önde, sonra sort_order.
  type PresentationMediaRow = {
    id: string;
    property_id: string;
    kind: string;
    file_type: string | null;
    file_name: string | null;
    is_document?: boolean | null;
    room_tag?: string | null;
    caption?: string | null;
  };
  // Görseller + müşterinin önceki geri bildirimi bağımsız: paralel. Geri bildirim tablosu yoksa (migration
  // uygulanmadı) hata yutulur, düğmeler boş başlar.
  const [{ data: mediaRows }, { data: feedbackRows }, isCreatorPreview, requestHeaders] = await Promise.all([
    // selectWithMediaMeta: is_document + oda etiketi/açıklama (kat planı ayrı blok); sütun yoksa selectWithDocumentFlag'e düşer.
    selectWithMediaMeta<PresentationMediaRow[]>(
      "id, property_id, is_cover, sort_order, kind, file_type, file_name",
      (columns) =>
        admin
          .from("property_media")
          .select(columns)
          .in("property_id", properties.map((p) => p.id as string))
          .eq("kind", "image")
          .order("is_cover", { ascending: false })
          .order("sort_order", { ascending: true }),
    ),
    admin
      .from("presentation_feedback")
      .select("property_id, verdict, note")
      .eq("presentation_id", pres.id)
      .eq("tenant_id", pres.tenant_id),
    viewerIsCreator((pres.created_by as string | null) ?? null),
    headers(),
  ]);
  const feedbackByProperty = new Map<string, { verdict: PresentationFeedbackVerdict; note: string | null }>();
  for (const f of (feedbackRows ?? []) as { property_id: string; verdict: string; note: string | null }[]) {
    if (isPresentationFeedbackVerdict(f.verdict)) feedbackByProperty.set(f.property_id, { verdict: f.verdict, note: f.note });
  }
  type PresentationMedia = { id: string; src: string; label: string | null };
  const mediaByProperty = new Map<string, PresentationMedia[]>();
  // PF-01 / PUB-9: kat planları kapak/galeriye girmez, slaytta ayrı "Kat planı" bloğunda gösterilir.
  const floorPlansByProperty = new Map<string, PresentationMedia[]>();
  // KVKK P0-9: belge (is_document; sütun yoksa belge adlı) görsel sunum linkinde gösterilmez (tek kural).
  for (const m of (mediaRows ?? []).filter((r) => isPublicListingImage(r))) {
    const target = isFloorPlan(m) ? floorPlansByProperty : mediaByProperty;
    const list = target.get(m.property_id) ?? [];
    list.push({ id: m.id, src: createShortLivedPropertyMediaUrl(m.id, "presentation"), label: mediaShortLabel(m) });
    target.set(m.property_id, list);
  }

  // Görüntülenme: yanıt gönderildikten SONRA atomik +1 (increment_listing_view deseni). Açılış istihbaratı
  // (paylas/[token] deseni): sunumu hazırlayan danışmana "sunumunuz açıldı" bildirimi — günde en çok bir kez
  // (dedupe_key), danışmanın kendi önizlemesi sayılmaz; WhatsApp/Telegram önizleme botu ve ön-yükleme ne sayaca ne
  // bildirime girer (presentation-open.ts). Bildirim hatası ziyaretçi sayfasını düşürmez.
  const isPreviewBot = isLinkPreviewHeaders(requestHeaders);
  after(() =>
    recordPresentationOpen(
      admin,
      {
        id: pres.id as string,
        tenant_id: pres.tenant_id as string,
        title: String(pres.title ?? ""),
        customer_name: (pres.customer_name as string | null) ?? null,
        customer_id: (pres.customer_id as string | null) ?? null,
        created_by: (pres.created_by as string | null) ?? null,
        view_count: (pres.view_count as number | null) ?? null,
      },
      { isPreviewBot, isCreatorPreview },
    ),
  );

  const officeName = tenant?.name ?? "Emlak ofisi";
  const brand = tenant?.brand_color?.trim() || BRAND_FALLBACK;
  // İletişim (SK8 B148): sunumu hazırlayan danışman → ofisin girdiği telefon (sahip kişisel telefonu yok).
  const contact = resolvePublicContact({
    advisorPhone: advisor?.phone ?? null,
    officePhone: tenant?.phone ?? null,
    whatsappText: `Merhaba${advisor?.full_name ? ` ${advisor.full_name} Bey/Hanım` : ""}, "${pres.title}" sunumundaki portföyler hakkında bilgi almak istiyorum.`,
  });
  const tarih = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long" }).format(new Date(pres.created_at));

  return (
    <div className="min-h-screen bg-canvas px-4 py-8 sm:py-12 print:p-0">
      <div className="mx-auto max-w-3xl space-y-5">
        {/* Ekran araç çubuğu — çıktıda yok */}
        <div className="no-print flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-xs font-semibold text-text-muted">
            <ShieldCheck className="h-3.5 w-3.5 text-mint-600" />
            Bu sunum {officeName} tarafından hazırlanmıştır
          </span>
          <PrintButton tone="dark" label="Yazdır / PDF kaydet" />
        </div>

        {/* ============ KAPAK ============ */}
        <article className="print-sheet surface-card overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-lg)]">
          <div className="theme-dark relative overflow-hidden bg-[#071A38] px-6 py-10 text-white sm:px-10">
            <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
            <div
              className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full opacity-25 blur-[90px]"
              style={{ backgroundColor: brand }}
            />
            <div className="relative">
              <div className="flex items-center gap-3">
                {tenant?.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Storage public URL; next/image remote domain konfigürasyonu gerektirir (brosur deseni)
                  <img
                    src={tenant.logo_url}
                    alt={`${officeName} logosu`}
                    className="h-11 w-11 shrink-0 rounded-[var(--radius-control)] bg-white object-contain p-1"
                  />
                ) : (
                  <span
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-control)] font-display text-lg font-extrabold text-white"
                    style={{ backgroundColor: brand }}
                  >
                    {officeName[0]}
                  </span>
                )}
                <div>
                  <p className="font-display text-base font-extrabold leading-tight">{officeName}</p>
                  <p className="text-xs uppercase tracking-[0.14em] text-white/50">Portföy sunumu</p>
                </div>
              </div>

              <h1 className="mt-8 font-display text-3xl font-extrabold tracking-[-0.02em] sm:text-4xl">
                {pres.title}
              </h1>
              {pres.customer_name ? (
                <p className="mt-2 flex items-center gap-2 text-sm text-white/70">
                  <UserRound className="h-4 w-4" style={{ color: brand }} />
                  Sayın <strong className="font-semibold text-white">{pres.customer_name}</strong> için hazırlandı
                </p>
              ) : null}
              {pres.note ? (
                <p className="mt-4 max-w-xl whitespace-pre-line rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-4 py-3 text-sm leading-relaxed text-white/75">
                  {pres.note}
                </p>
              ) : null}

              <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-2 text-xs text-white/55">
                <div className="flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <dt>Tarih</dt>
                  <dd className="font-semibold text-white">{tarih}</dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  <dt>Portföy</dt>
                  <dd className="font-semibold text-white">{properties.length} adet</dd>
                </div>
                {advisor?.full_name ? (
                  <div className="flex items-center gap-1.5">
                    <UserRound className="h-3.5 w-3.5" />
                    <dt>Danışman</dt>
                    <dd className="font-semibold text-white">
                      {advisor.full_name}
                      {contact ? ` · ${contact.display}` : ""}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </div>
        </article>

        {/* ============ PORTFÖY SLAYTLARI — çıktıda her biri yeni sayfa ============ */}
        {properties.map((property, index) => {
          const feat = (property.features ?? {}) as Feat;
          const images = mediaByProperty.get(property.id as string) ?? [];
          const cover = images[0] ?? null;
          const gallery = images.slice(1, 7);
          const floorPlans = (floorPlansByProperty.get(property.id as string) ?? []).slice(0, 4);
          const loc = [relName(property.district as Rel), relName(property.province as Rel)]
            .filter(Boolean)
            .join(" / ");
          const specs = [
            feat.rooms ? { icon: BedDouble, label: `${feat.rooms}` } : null,
            feat.sqm ? { icon: Ruler, label: `${feat.sqm} m²` } : null,
            feat.baths ? { icon: Bath, label: `${feat.baths} banyo` } : null,
            feat.floor != null && `${feat.floor}` !== "" ? { icon: Layers, label: `${feat.floor}. kat` } : null,
            feat.building_age != null && `${feat.building_age}` !== ""
              ? { icon: Building2, label: `${feat.building_age} yaşında` }
              : null,
            feat.heating ? { icon: Flame, label: feat.heating } : null,
          ].filter(Boolean) as { icon: typeof BedDouble; label: string }[];
          const description = readPropertyDescription(feat) ?? "";

          return (
            <article
              key={property.id as string}
              className="print-sheet surface-card overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-lg)] print:break-before-page"
            >
              {/* Kapak fotoğrafı */}
              <div className="relative aspect-[16/9] w-full overflow-hidden bg-[image:var(--grad-brand-soft)]">
                {cover ? (
                  <Image
                    src={cover.src}
                    alt={(property.title as string | null) ?? (property.property_code as string)}
                    fill
                    sizes="(max-width: 768px) 100vw, 768px"
                    className="object-cover"
                    unoptimized
                    priority={index === 0}
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center text-brand-600/35">
                    <Building2 className="h-14 w-14" />
                  </div>
                )}
                <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 text-xs font-bold text-ink-950 shadow-[var(--shadow-xs)] backdrop-blur">
                  {index + 1} / {properties.length}
                </span>
                <span
                  className="absolute right-4 top-4 rounded-full px-3 py-1 text-xs font-bold uppercase text-white shadow-[var(--shadow-xs)]"
                  style={{ backgroundColor: brand }}
                >
                  {property.transaction_type as string}
                </span>
              </div>

              <div className="p-6 sm:p-8">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-[0.08em]" style={{ color: brand }}>
                      {property.property_type as string} · {property.property_code as string}
                    </p>
                    <h2 className="mt-1 font-display text-xl font-extrabold text-ink-950 sm:text-2xl">
                      {(property.title as string | null) ?? (property.property_code as string)}
                    </h2>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-text-muted">
                      <MapPin className="h-4 w-4 shrink-0" style={{ color: brand }} />
                      {loc || "Konum belirtilmedi"}
                    </p>
                  </div>
                  <p className="font-display text-2xl font-extrabold text-ink-950 sm:text-3xl">
                    {money(property.list_price != null ? Number(property.list_price) : null, property.transaction_type as string, property.features)}
                  </p>
                </div>

                {specs.length > 0 ? (
                  <div className="print-avoid-break mt-5 flex flex-wrap gap-2">
                    {specs.map((s) => (
                      <span
                        key={s.label}
                        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-ink-950"
                      >
                        <s.icon className="h-3.5 w-3.5" style={{ color: brand }} /> {s.label}
                      </span>
                    ))}
                  </div>
                ) : null}

                {description ? (
                  <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-text-muted">
                    {description.length > 600 ? `${description.slice(0, 600)}…` : description}
                  </p>
                ) : null}

                {gallery.length > 0 ? (
                  <div className="print-avoid-break mt-5 grid grid-cols-3 gap-2">
                    {gallery.map((media) => (
                      <div key={media.id} className="relative aspect-[4/3] overflow-hidden rounded-[var(--radius-control)] border border-line bg-canvas">
                        <Image
                          src={media.src}
                          alt={media.label ? `${media.label} · portföy fotoğrafı` : "Portföy fotoğrafı"}
                          fill
                          sizes="(max-width: 768px) 33vw, 240px"
                          className="object-cover"
                          unoptimized
                        />
                        {media.label ? (
                          <span className="absolute inset-x-1 bottom-1 truncate rounded-full bg-ink-950/65 px-2 py-0.5 text-center text-xs font-bold text-white">
                            {media.label}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                {floorPlans.length > 0 ? (
                  <section className="print-avoid-break mt-5" aria-label="Kat planı">
                    <h3 className="text-xs font-bold uppercase tracking-[0.08em]" style={{ color: brand }}>
                      {floorPlans.length > 1 ? "Kat planları" : "Kat planı"}
                    </h3>
                    <div className={`mt-2 grid gap-2 ${floorPlans.length > 1 ? "sm:grid-cols-2" : ""}`}>
                      {floorPlans.map((plan, i) => (
                        <figure key={plan.id} className="overflow-hidden rounded-[var(--radius-control)] border border-line bg-white">
                          <div className="relative aspect-[4/3] w-full">
                            <Image
                              src={plan.src}
                              alt={`Kat planı ${i + 1}${plan.label && plan.label !== "Kat planı" ? ` · ${plan.label}` : ""}`}
                              fill
                              sizes="(max-width: 768px) 100vw, 384px"
                              className="object-contain p-2"
                              unoptimized
                            />
                          </div>
                          {plan.label && plan.label !== "Kat planı" ? (
                            <figcaption className="border-t border-line px-3 py-1.5 text-xs font-semibold text-text-muted">
                              {plan.label}
                            </figcaption>
                          ) : null}
                        </figure>
                      ))}
                    </div>
                  </section>
                ) : null}

                {/* Müşteri geri bildirimi: ilgileniyorum / değil + not → danışmana bildirim + müşteri kartı */}
                <PresentationFeedback
                  token={token}
                  propertyId={property.id as string}
                  initialVerdict={feedbackByProperty.get(property.id as string)?.verdict ?? null}
                  initialNote={feedbackByProperty.get(property.id as string)?.note ?? null}
                />
              </div>
            </article>
          );
        })}

        {/* ============ İLETİŞİM CTA ============ */}
        <article className="print-sheet surface-card overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-lg)] print:break-before-page">
          <div className="px-6 py-8 text-center sm:px-10">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-[var(--radius-card)]" style={{ backgroundColor: `${brand}1a` }}>
              <Phone className="h-6 w-6" style={{ color: brand }} />
            </span>
            <h2 className="mt-4 font-display text-xl font-extrabold text-ink-950">Beğendiğiniz portföy oldu mu?</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-muted">
              {advisor?.full_name ? `Danışmanınız ${advisor.full_name}` : officeName} yer gösterimi ve
              detaylar için bir telefon uzağınızda.
            </p>
            {contact ? (
              <p className="numeric mt-3 font-display text-lg font-extrabold text-ink-950">{contact.display}</p>
            ) : null}
            <PublicContactActions
              contact={contact}
              tone="light"
              callLabel="Hemen ara"
              fallbackHref={officeMessageHref(tenant)}
              className="no-print mx-auto mt-5 max-w-sm"
            />
          </div>
        </article>

        <LicenseNotice officeName={tenant.name} licenseNo={tenant.license_no} phone={tenant.phone} addressLine={tenant.address_line} />

        <p className="no-print text-center text-xs text-text-faint">
          Bu sayfa size özel bir sunum linkidir ·{" "}
          <Link href="/" className="font-semibold underline-offset-2 transition hover:text-text-muted hover:underline">
            Powered by EmlakSoft
          </Link>
        </p>
      </div>
    </div>
  );
}
