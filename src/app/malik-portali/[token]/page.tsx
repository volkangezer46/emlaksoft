import { APPOINTMENT_TYPE_LABELS } from "@/lib/appointment-labels";
import Image from "next/image";
import {
  Building2,
  CalendarDays,
  ExternalLink,
  History,
  MapPin,
  MessageCircle,
  Phone,
  RadioTower,
  Tag,
} from "lucide-react";
import { getOwnerPortalData } from "@/app/actions/owner-portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { PublicModuleClosed } from "@/components/modules/public-module-closed";
import { isPublicFeatureClosed } from "@/lib/modules/public";
import { toTelHref, toWhatsAppLink } from "@/lib/phone";
import { OfferActions } from "./offer-actions";
import {
  PortalContactBar,
  PortalEmpty,
  PortalFooterNote,
  PortalInvalidLink,
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
import { BuildingDuesSection } from "@/components/public/building-dues-section";
import { now as clockNow, trDayKey } from "@/lib/clock";
import {
  PUBLIC_COVER_COLUMNS,
  firstPublicImageByProperty,
  selectWithDocumentFlag,
  type PublicCoverCandidate,
} from "@/lib/public-property-media";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Malik Paneli",
  robots: { index: false, follow: false },
};

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
type TenantRel = { phone?: string | null } | { phone?: string | null }[] | null;

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
  const data = await getOwnerPortalData(token);

  if (!data) {
    return (
      <PortalInvalidLink
        icon={Building2}
        description="Bu malik paneli bağlantısı artık geçerli değil. Danışmanınızla iletişime geçin."
      />
    );
  }

  const { property, tenant, ownerName, portalListings, offers, appointments } = data;
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
  const ownerSettings = await readTenantSettings(admin, tenant.id, [OWNER_WEEKLY_REPORT_KEY]);
  const weeklyReportOn = ownerSettings[OWNER_WEEKLY_REPORT_KEY] === true;
  const [{ data: propertyRel }, { data: coverRows }, { data: priceRows }] = await Promise.all([
    admin
      .from("properties")
      .select("assigned_to, tenant:tenants(phone)")
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

  // Danışman telefonu öncelikli; yoksa ofis telefonu
  const contactPhone = advisor?.phone || tenantRel?.phone || null;
  const contactLabel = advisor?.phone ? "Danışmanı Ara" : "Ofisi Ara";
  const contactTel = toTelHref(contactPhone);
  const contactWhatsApp = toWhatsAppLink(
    contactPhone,
    `Merhaba, ${property.title ?? property.code} malik paneli üzerinden yazıyorum.`,
  );
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
            {/* Danışman / ofis iletişimi */}
            {(contactTel || contactWhatsApp) && (
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                {contactTel && (
                  <a
                    href={contactTel}
                    className="btn-shine inline-flex items-center justify-center gap-2 rounded-[var(--radius-card)] bg-white px-4 py-2.5 text-sm font-bold text-ink-950 transition hover:bg-white/90"
                  >
                    <Phone className="h-4 w-4" /> {contactLabel}
                  </a>
                )}
                {contactWhatsApp && (
                  <a
                    href={contactWhatsApp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-card)] border border-mint-400/30 bg-mint-500/10 px-4 py-2.5 text-sm font-bold text-mint-300 transition hover:bg-mint-500/20"
                  >
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </a>
                )}
              </div>
            )}
            {advisor?.full_name && (
              <p className="mt-3 text-xs text-white/55">Sorumlu danışmanınız: {advisor.full_name}</p>
            )}
          </div>
        </section>

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
                      {o.notes && <p className="mt-1 text-xs text-text-muted line-clamp-2">{o.notes}</p>}
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
          {appointments.length === 0 ? (
            <PortalEmpty icon={CalendarDays} title="Planlanmış randevu bulunmuyor." />
          ) : (
            <div className="space-y-2">
              {appointments.map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-xs)]">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
                    <CalendarDays className="h-4 w-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink-950">{APPT_TYPE[a.type] ?? a.type}</p>
                    <p className="text-xs text-text-muted">{formatDateTime(a.scheduledAt)}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                    a.status === "confirmed" ? "bg-mint-500/12 text-mint-700" : "bg-amber-400/15 text-amber-700"
                  }`}>
                    {a.status === "confirmed" ? "Onaylandı" : "Teyit Bekliyor"}
                  </span>
                </div>
              ))}
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

        <PortalFooterNote office={tenant.name} />
        <PortalStickySpacer active={Boolean(contactTel || contactWhatsApp)} />
      </main>
      <PortalContactBar telHref={contactTel} whatsAppHref={contactWhatsApp} callLabel={contactLabel} />
    </div>
  );
}
