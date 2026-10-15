import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { loadExpiredPortalLink } from "@/lib/portal-link-renew";
import { ExpiredPortalLinkScreen } from "@/components/public/expired-portal-link";
import { APPOINTMENT_TYPE_LABELS } from "@/lib/appointment-labels";
import Image from "next/image";
import {
  CalendarDays,
  ExternalLink,
  History,
  MapPin,
  RadioTower,
  Tag,
} from "lucide-react";
import { getOwnerPortalData } from "@/app/actions/owner-portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { PublicModuleClosed } from "@/components/modules/public-module-closed";
import { isPublicFeatureClosed } from "@/lib/modules/public";
import { isLinkPreviewHeaders } from "@/lib/link-preview";
import { officeMessageHref, resolvePublicContact } from "@/lib/public-contact";
import { PublicContactActions } from "@/components/public/public-contact-actions";
import { loadDocLinkOg, publicLinkMetadata } from "@/lib/public-link-og";
import { OfferActions } from "./offer-actions";
import {
  PortalContactBar,
  PortalEmpty,
  PortalFooterNote,
  PortalSection,
  PortalStickySpacer,
} from "@/components/public/portal-kit";
import { createShortLivedPropertyMediaUrl } from "@/lib/property-media-access";
import { formatDateTr, formatDateTimeTr } from "@/lib/format";
import { readTenantSettings } from "@/lib/settings/tenant-read";
import { OWNER_WEEKLY_REPORT_KEY } from "@/lib/settings/registry/tenant";
import { OwnerRentStatementSection, OwnerWeeklyReportSection } from "./owner-extras";
import { OwnerRentStatementView } from "./rent-statement-view";
import { OwnerPayoutSection } from "./owner-payout-section";
import { OwnerPriceProposalSection } from "./owner-price-proposal";
import { BuildingDuesSection } from "@/components/public/building-dues-section";
import { now as clockNow, trDayKey } from "@/lib/clock";
import { OWNER_APPT_TONE_CLASSES, ownerAppointmentBadge, ownerShowingSummaryText } from "@/lib/owner-portal-appointments";
import {
  PUBLIC_COVER_COLUMNS,
  firstPublicImageByProperty,
  selectWithDocumentFlag,
  type PublicCoverCandidate,
} from "@/lib/public-property-media";

export const dynamic = "force-dynamic";

// Kişiye özel link → arama motorlarına kapalı. WhatsApp önizlemesi ofis markalı ("Malik paneliniz · <ofis>", kişi adı
// yok); görsel `opengraph-image.tsx` (tek kaynak public-link-og, SK8 B151).
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return {
    ...publicLinkMetadata(await loadDocLinkOg("owner_portal", token), "Malik Paneli"),
    robots: { index: false, follow: false },
  };
}

const PORTAL_STATUS: Record<string, string> = {
  live:    "Yayında",
  removed: "Kaldırıldı",
  draft:   "Taslak",
};

const OFFER_STATUS: Record<string, string> = {
  submitted: "Değerlendiriliyor",
  accepted:  "Kabul edildi",
  rejected:  "Reddedildi",
  countered: "Karşı teklif yapıldı",
  withdrawn: "Geri çekildi",
  draft:     "Taslak",
};

const APPT_TYPE = APPOINTMENT_TYPE_LABELS;

function money(n: number | null) {
  if (!n) return "—";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

function formatDate(iso: string) {
  return formatDateTr(iso, { day: "2-digit", month: "long", year: "numeric" });
}

function formatDateTime(iso: string) {
  return formatDateTimeTr(iso, { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

type Advisor = { full_name?: string; phone?: string | null } | null;
type TenantContact = { phone?: string | null; lead_capture_token?: string | null; lead_capture_enabled?: boolean | null };
type TenantRel = TenantContact | TenantContact[] | null;

export default async function MalikPortaliPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const ekstreRaw = Array.isArray(sp.ekstre) ? sp.ekstre[0] : sp.ekstre;
  // "Son görülme" yalnız gerçek ziyaretçide yazılır; WhatsApp/Telegram önizleme botu yan etki üretmez (SK8 B150).
  const isPreviewBot = isLinkPreviewHeaders(await headers());
  const data = await getOwnerPortalData(token, { recordSeen: !isPreviewBot });

  // Süresi dolmuş (kayıtlı) token: ofis adı + iletişim + "Yeni bağlantı iste" (PUB-7). Bilinmeyen token: gerçek 404 +
  // ortak "bağlantı geçersiz" ekranı (../not-found.tsx, SK8 B153).
  if (!data) {
    const expired = await loadExpiredPortalLink("owner", token, clockNow());
    if (expired) return <ExpiredPortalLinkScreen link={expired} token={token} />;
    notFound();
  }

  const { property, tenant, ownerName, portalListings, offers, appointments, showingSummary } = data;
  const nowMs = clockNow();
  const liveListings = portalListings.filter((l) => l.status === "live");

  // Sayfaya özel ek veriler — paylaşılan portal aksiyonuna dokunmadan burada:
  // kapak görseli + atanmış danışman ve ofis telefonu (Ara / WhatsApp için)
  // + liste fiyatı geçmişi (yalnızca list_price — min/gizli fiyat malike sızmaz).
  const admin = createAdminClient();
  if (await isPublicFeatureClosed(admin, tenant.id, "client_portals")) return <PublicModuleClosed officeName={tenant.name} />;

  // Kira ekstresi görünümü (?ekstre=<yıl>): aynı token + aynı modül kapısı; yazdırılabilir tek sayfa.
  if (ekstreRaw !== undefined) {
    return (
      <OwnerRentStatementView
        db={admin}
        token={token}
        tenantId={tenant.id}
        tenantName={tenant.name}
        propertyId={property.id}
        propertyLabel={property.title ?? property.code}
        ownerName={ownerName}
        rawYear={Number(ekstreRaw)}
      />
    );
  }
  // Haftalık rapor: portföy anahtarı (danışman tek tıkla açar/kapatır) varsa o, yoksa ofis ayarı. Sütun yoksa hata -> ofis ayarı.
  const [ownerSettings, switchRes] = await Promise.all([
    readTenantSettings(admin, tenant.id, [OWNER_WEEKLY_REPORT_KEY]),
    admin.from("owner_portal_tokens").select("weekly_report_enabled").eq("token", token).eq("tenant_id", tenant.id).maybeSingle(),
  ]);
  const tokenSwitch = switchRes.error ? null : ((switchRes.data as { weekly_report_enabled?: boolean | null } | null)?.weekly_report_enabled ?? null);
  const weeklyReportOn = (tokenSwitch ?? ownerSettings[OWNER_WEEKLY_REPORT_KEY] === true) === true;
  const [{ data: propertyRel }, { data: coverRows }, { data: priceRows }] = await Promise.all([
    admin
      .from("properties")
      .select("assigned_to, tenant:tenants(phone, lead_capture_token, lead_capture_enabled)")
      .eq("id", property.id)
      .eq("tenant_id", tenant.id)
      .eq("is_sample", false)
      .is("deleted_at", null)
      .maybeSingle(),
    // KVKK P0-9: kapak belge olamaz (is_document; sütun yoksa ad kuralı) -> ilk public görsel.
    selectWithDocumentFlag<PublicCoverCandidate[]>(PUBLIC_COVER_COLUMNS, (columns) =>
      admin
        .from("property_media")
        .select(columns)
        .eq("property_id", property.id)
        .eq("tenant_id", tenant.id)
        .eq("kind", "image")
        .order("is_cover", { ascending: false })
        .order("sort_order", { ascending: true })
        .limit(50),
    ),
    admin
      .from("property_price_history")
      .select("id, old_price, new_price, change_pct, created_at")
      .eq("property_id", property.id)
      .eq("tenant_id", tenant.id)
      .eq("price_field", "list_price")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const advisorId = (propertyRel?.assigned_to as string | null) ?? null;
  const { data: advisor } = advisorId
    ? await admin
        .from("profiles")
        .select("full_name, phone")
        .eq("id", advisorId)
        .eq("tenant_id", tenant.id)
        .eq("is_active", true)
        .maybeSingle()
    : { data: null as Advisor };
  const tenantRelRaw = (propertyRel?.tenant ?? null) as TenantRel;
  const tenantRel = Array.isArray(tenantRelRaw) ? tenantRelRaw[0] : tenantRelRaw;

  // İletişim (SK8 B148): danışman → ofisin girdiği telefon (sahip kişisel telefonu yok); yoksa "Ofise mesaj bırakın".
  const contact = resolvePublicContact({
    advisorPhone: advisor?.phone ?? null,
    officePhone: tenantRel?.phone ?? null,
    whatsappText: `Merhaba, ${property.title ?? property.code} malik paneli üzerinden yazıyorum.`,
  });
  const coverId = firstPublicImageByProperty(coverRows).get(property.id) ?? null;
  const coverSrc = coverId
    ? createShortLivedPropertyMediaUrl(coverId, "owner-portal")
    : null;

  const priceHistory = (priceRows ?? []).map((h) => ({
    id:        h.id,
    oldPrice:  h.old_price != null ? Number(h.old_price) : null,
    newPrice:  Number(h.new_price),
    changePct: h.change_pct != null ? Number(h.change_pct) : null,
    createdAt: h.created_at as string,
  }));

  return (
    <div className="min-h-screen bg-canvas">
      {/* Header */}
      <header className="theme-dark border-b border-white/10 bg-[image:var(--grad-ink)] px-4 py-4 text-white">
        <div className="mx-auto max-w-3xl flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-mint-400">{tenant.name}</p>
            <h1 className="mt-0.5 font-display font-extrabold">Malik Paneli</h1>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-sm font-bold text-white">
            {ownerName.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto max-w-3xl space-y-6 p-4 py-6">
        {/* Portföy özeti */}
        <section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] text-white shadow-[var(--shadow-lg)]">
          <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-brand-600/25 blur-[90px]" />
          {coverSrc && (
            <div className="relative aspect-[16/8] w-full">
              <Image
                src={coverSrc}
                alt={property.title ?? property.code}
                fill
                priority
                sizes="(max-width: 768px) 100vw, 720px"
                unoptimized
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#071a38] to-transparent" />
            </div>
          )}
          <div className="relative p-5">
            <p className="text-xs text-white/55">Sayın {ownerName},</p>
            <h2 className="mt-1 font-display text-xl font-extrabold">{property.title ?? property.code}</h2>
            {(property.province || property.district) && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-white/60">
                <MapPin className="h-3.5 w-3.5 text-mint-400" />
                {[property.district, property.province].filter(Boolean).join(", ")}
              </p>
            )}
            {/* KPI kutuları — sayı, ilgili bölüme iner */}
            <div className="mt-4 flex flex-wrap gap-3">
              <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/8 px-4 py-3 text-center">
                <p className="text-xs text-white/55">Liste fiyatı</p>
                <p className="mt-0.5 font-bold text-white">{money(property.listPrice)}</p>
              </div>
              <a href="#yayinlar" className="rounded-[var(--radius-card)] border border-white/10 bg-white/8 px-4 py-3 text-center transition hover:bg-white/15">
                <p className="text-xs text-white/55">Yayın sayısı</p>
                <p className="mt-0.5 font-bold text-white">{liveListings.length}</p>
              </a>
              <a href="#teklifler" className="rounded-[var(--radius-card)] border border-white/10 bg-white/8 px-4 py-3 text-center transition hover:bg-white/15">
                <p className="text-xs text-white/55">Gelen teklif</p>
                <p className="mt-0.5 font-bold text-white">{offers.length}</p>
              </a>
              <a href="#randevular" className="rounded-[var(--radius-card)] border border-white/10 bg-white/8 px-4 py-3 text-center transition hover:bg-white/15">
                <p className="text-xs text-white/55">Randevu</p>
                <p className="mt-0.5 font-bold text-white">{appointments.length}</p>
              </a>
            </div>
            {/* Danışman / ofis iletişimi (tek bileşen) */}
            <PublicContactActions
              contact={contact}
              tone="dark"
              fallbackHref={officeMessageHref(tenantRel)}
              className="mt-4"
            />
            {advisor?.full_name && (
              <p className="mt-3 text-xs text-white/55">Sorumlu danışmanınız: {advisor.full_name}</p>
            )}
          </div>
        </section>

        {/* Fiyat önerisi: danışmanın bekleyen önerisi varsa onay kartı (yoksa kısa süre karar özeti) */}
        <Suspense fallback={null}>
          <OwnerPriceProposalSection db={admin} tenantId={tenant.id} propertyId={property.id} token={token} />
        </Suspense>

        {/* Haftalık pazarlama raporu (ofis ayarı açıksa) */}
        {weeklyReportOn ? <OwnerWeeklyReportSection db={admin} tenantId={tenant.id} propertyId={property.id} /> : null}

        {/* Yayın durumu */}
        <PortalSection id="yayinlar" icon={RadioTower} title="Portal Yayınları" iconClassName="text-brand-600">
          {portalListings.length === 0 ? (
            <PortalEmpty icon={RadioTower} title="Henüz portal yayını bulunmuyor." />
          ) : (
            <div className="space-y-2">
              {portalListings.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-xs)]">
                  <div className="flex items-center gap-3">
                    <span className={`grid h-8 w-8 place-items-center rounded-[var(--radius-control)] ${l.status === "live" ? "bg-mint-500/12 text-mint-600" : "bg-canvas text-text-faint"}`}>
                      <RadioTower className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-ink-950">{l.portalName}</p>
                      {l.publishedAt && (
                        <p className="text-xs text-text-muted">Yayın: {formatDate(l.publishedAt)}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                      l.status === "live" ? "bg-mint-500/12 text-mint-700" : "bg-canvas text-text-muted"
                    }`}>
                      {PORTAL_STATUS[l.status] ?? l.status}
                    </span>
                    {l.portalUrl && (
                      <a href={l.portalUrl} target="_blank" rel="noreferrer" className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-line text-text-faint transition hover:text-brand-600" aria-label="İlanı görüntüle">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </PortalSection>

        {/* Teklifler */}
        <PortalSection id="teklifler" icon={Tag} title="Gelen Teklifler" iconClassName="text-amber-600">
          {offers.length === 0 ? (
            <PortalEmpty icon={Tag} title="Henüz teklif gelmedi. Teklifler geldiğinde burada görünür." />
          ) : (
            <div className="space-y-2">
              {offers.map((o) => (
                <div key={o.id} className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-xs)]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-ink-950">{money(o.amount)}</p>
                      {/* Yalnız danışmanın malike yazdığı açıklama; iç not (offers.notes) burada YOK (SK8 B149). */}
                      {o.ownerNote && <p className="mt-1 text-xs text-text-muted line-clamp-3">{o.ownerNote}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold ${
                        o.status === "accepted"  ? "bg-mint-500/12 text-mint-700" :
                        o.status === "rejected"  ? "bg-danger-500/10 text-danger-600" :
                        o.status === "countered" ? "bg-amber-400/15 text-amber-700" :
                        "bg-brand-600/10 text-brand-700"
                      }`}>
                        {OFFER_STATUS[o.status] ?? o.status}
                      </span>
                      {o.submittedAt && (
                        <p className="mt-1 text-xs text-text-muted">{formatDateTime(o.submittedAt)}</p>
                      )}
                    </div>
                  </div>
                  {/* Malik aksiyonları — yalnızca değerlendirmedeki teklifler */}
                  {o.status === "submitted" && (
                    <div className="mt-3 border-t border-line pt-3">
                      <OfferActions token={token} offerId={o.id} amountLabel={money(o.amount)} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </PortalSection>

        {/* Fiyat geçmişi — kayıt varsa (yalnızca liste fiyatı serisi) */}
        {priceHistory.length > 0 && (
          <PortalSection id="fiyat-gecmisi" icon={History} title="Fiyat Geçmişi" iconClassName="text-mint-600">
            <div className="space-y-2">
              {priceHistory.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-xs)]">
                  <div>
                    <p className="text-sm font-semibold text-ink-950">
                      {h.oldPrice != null ? (
                        <>
                          <span className="font-medium text-text-faint line-through">{money(h.oldPrice)}</span>
                          <span className="mx-1.5 text-text-faint">→</span>
                          {money(h.newPrice)}
                        </>
                      ) : (
                        money(h.newPrice)
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {formatDate(h.createdAt)}
                      {h.oldPrice == null ? " · İlk fiyat" : ""}
                    </p>
                  </div>
                  {h.changePct != null && h.changePct !== 0 && (
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                      h.changePct < 0 ? "bg-danger-500/10 text-danger-600" : "bg-mint-500/12 text-mint-700"
                    }`}>
                      {h.changePct > 0 ? "+" : "−"}%
                      {Math.abs(h.changePct).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </PortalSection>
        )}

        {/* Randevular */}
        <PortalSection id="randevular" icon={CalendarDays} title="Randevular" iconClassName="text-brand-600">
          <p className="mb-3 text-xs font-semibold text-text-muted">{ownerShowingSummaryText(showingSummary)}</p>
          {appointments.length === 0 ? (
            <PortalEmpty icon={CalendarDays} title="Son 30 günde randevu bulunmuyor." />
          ) : (
            <div className="space-y-2">
              {appointments.map((a) => {
                const badge = ownerAppointmentBadge(a.status, a.scheduledAt, nowMs);
                return (
                  <div key={a.id} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-xs)]">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
                      <CalendarDays className="h-4 w-4" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink-950">{APPT_TYPE[a.type] ?? a.type}</p>
                      <p className="text-xs text-text-muted">{formatDateTime(a.scheduledAt)}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${OWNER_APPT_TONE_CLASSES[badge.tone]}`}>
                      {badge.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </PortalSection>

        {/* Kira ekstresi (portföyde kira kaydı varsa) */}
        <OwnerRentStatementSection db={admin} tenantId={tenant.id} propertyId={property.id} token={token} />

        {/* Hakediş ekstresi (ofis bu mülkü yönetiyorsa) */}
        <OwnerPayoutSection db={admin} tenantId={tenant.id} propertyId={property.id} />

        {/* Bina aidatım (mülk bir bina dairesine bağlıysa; salt-okunur) */}
        <BuildingDuesSection db={admin} tenantId={tenant.id} propertyId={property.id} role="owner" today={trDayKey(clockNow())} />

        {/* Açıklama */}
        {property.description && (
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
            <h2 className="mb-2 text-sm font-bold text-ink-950">İlan Açıklaması</h2>
            <p className="text-sm leading-relaxed text-text-muted">{property.description}</p>
          </section>
        )}

        <PortalFooterNote office={tenant.name} asOf={formatDateTimeTr(clockNow())} />
        <PortalStickySpacer active={Boolean(contact)} />
      </main>
      <PortalContactBar telHref={contact?.telHref} whatsAppHref={contact?.waHref} callLabel={contact?.callLabel} />
    </div>
  );
}
