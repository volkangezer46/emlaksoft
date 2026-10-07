import { APPOINTMENT_TYPE_LABELS } from "@/lib/appointment-labels";
import Link from "next/link";
import Image from "next/image";
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  FileSignature,
  Home,
  KeyRound,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  Star,
  UserRound,
} from "lucide-react";
import { getCustomerPortalData } from "@/app/actions/customer-portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { PublicModuleClosed } from "@/components/modules/public-module-closed";
import { isPublicFeatureClosed } from "@/lib/modules/public";
import { toTelHref, toWhatsAppLink } from "@/lib/phone";
import { AddToCalendarButton } from "@/components/app/add-to-calendar-button";
import { PortalRequestForm } from "@/components/public/portal-request-form";
import {
  MAINTENANCE_LABELS,
  OWNER_OFFER_LABELS,
  PORTAL_TAB_LABELS,
  RENT_CHARGE_LABELS,
  resolvePortalTab,
} from "@/lib/customer-portal/portal-model";
import { MatchFeedback } from "./match-feedback";
import { CompareBar, CompareToggle } from "@/components/public/compare-select";
import {
  PortalContactBar,
  PortalEmpty,
  PortalFooterNote,
  PortalInvalidLink,
  PortalSection,
  PortalStickySpacer,
} from "@/components/public/portal-kit";
import type { MatchFeedbackVerdict } from "@/app/actions/customer-portal-feedback";
import { createShortLivedPropertyMediaUrl } from "@/lib/property-media-access";
import { formatDateTimeTr } from "@/lib/format";
import { readTenantSettings } from "@/lib/settings/tenant-read";
import { HOME_VALUE_SUMMARY_KEY } from "@/lib/settings/registry/tenant";
import { loadHomeValues } from "@/lib/home-value/load";
import { HOME_VALUE_NOTE } from "@/lib/home-value/core";
import {
  PUBLIC_COVER_COLUMNS,
  firstPublicImageByProperty,
  selectWithDocumentFlag,
  type PublicCoverCandidate,
} from "@/lib/public-property-media";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Müşteri Paneli",
  robots: { index: false, follow: false },
};

const DEMAND_TYPE_LABELS: Record<string, string> = {
  buy:    "Satın alma",
  rent:   "Kiralama",
  sell:   "Satış",
  invest: "Yatırım",
};

const APPT_TYPE_LABELS = APPOINTMENT_TYPE_LABELS;

function money(n: number | null) {
  if (!n) return "—";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

function formatDate(iso: string) {
  return formatDateTimeTr(iso, { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function relName(v: { name?: string } | { name?: string }[] | null | undefined) {
  if (!v) return null;
  const r = Array.isArray(v) ? v[0] : v;
  return r?.name ?? null;
}

type Advisor = { full_name?: string; phone?: string | null } | null;
type TenantRel = { slug?: string | null } | { slug?: string | null }[] | null;

export default async function CustomerPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const data = await getCustomerPortalData(token);

  if (!data) {
    return (
      <PortalInvalidLink
        icon={UserRound}
        description="Bu portal linki artık geçerli değil. Danışmanınızla iletişime geçin."
      />
    );
  }

  const { customer, tenant, demands, appointments, matches, tabs, owner, renter, documents, requestsEnabled } = data;
  // TEK PORTAL: rolüne göre sekme (alıcı / malik / kiracı / belgeler); yalnız veri olan sekme görünür.
  const active = resolvePortalTab(sp?.sekme, tabs);

  // Sayfaya özel ek veriler — paylaşılan portal aksiyonuna dokunmadan burada:
  // atanmış danışman iletişimi, vitrin slug'ı, eşleşen portföylerin kapak
  // görselleri, yayın durumu (vitrin yalnızca "live" portföyleri gösterir)
  // ve müşterinin daha önce verdiği beğen/geç geri bildirimleri.
  const admin = createAdminClient();
  if (await isPublicFeatureClosed(admin, tenant.id, "client_portals")) return <PublicModuleClosed officeName={tenant.name} />;
  const matchIds = matches.map((m) => m.id);
  const [{ data: customerRel }, coverRes, statusRes, feedbackRes] = await Promise.all([
    admin
      .from("customers")
      .select("assigned_to, tenant:tenants(slug)")
      .eq("id", customer.id)
      .eq("tenant_id", tenant.id)
      .eq("is_sample", false)
      .is("deleted_at", null)
      .maybeSingle(),
    matchIds.length > 0
      ? // KVKK P0-9: kapak belge olamaz (is_document; sütun yoksa ad kuralı) -> ilk public görsel.
        selectWithDocumentFlag<PublicCoverCandidate[]>(PUBLIC_COVER_COLUMNS, (columns) =>
          admin
            .from("property_media")
            .select(columns)
            .eq("tenant_id", tenant.id)
            .eq("kind", "image")
            .in("property_id", matchIds)
            .order("is_cover", { ascending: false })
            .order("sort_order", { ascending: true }),
        )
      : Promise.resolve({ data: [] as PublicCoverCandidate[] }),
    matchIds.length > 0
      ? admin
          .from("properties")
          // status: vitrin linki için; transaction_type/features/district:
          // karşılaştırma tablosuna oda-m²-kat-bina yaşı-ilçe taşır
          .select("id, status, transaction_type, features, district:geo_districts(name)")
          .eq("tenant_id", tenant.id)
          .is("deleted_at", null)
          .in("id", matchIds)
          .eq("is_sample", false)
      : Promise.resolve({
          data: [] as {
            id: string;
            status: string | null;
            transaction_type: string | null;
            features: unknown;
            district: { name?: string } | { name?: string }[] | null;
          }[],
        }),
    matchIds.length > 0
      ? admin
          .from("portal_match_feedback")
          .select("property_id, verdict")
          .eq("tenant_id", tenant.id)
          .eq("customer_id", customer.id)
          .in("property_id", matchIds)
      : Promise.resolve({ data: [] as { property_id: string; verdict: string }[] }),
  ]);

  // "Evinizin güncel değeri" (ofis ayarı; varsayılan kapalı): yalnız kazanılmış satış + orta/yüksek güvenli emsal aralığı.
  const homeValueOn = (await readTenantSettings(admin, tenant.id, [HOME_VALUE_SUMMARY_KEY]))[HOME_VALUE_SUMMARY_KEY] === true;
  const homeValues = homeValueOn ? await loadHomeValues(admin, tenant.id, customer.id) : [];

  const advisorId = (customerRel?.assigned_to as string | null) ?? null;
  const { data: advisor } = advisorId
    ? await admin
        .from("profiles")
        .select("full_name, phone")
        .eq("id", advisorId)
        .eq("tenant_id", tenant.id)
        .eq("is_active", true)
        .maybeSingle()
    : { data: null as Advisor };
  const tenantRelRaw = (customerRel?.tenant ?? null) as TenantRel;
  const tenantRel = Array.isArray(tenantRelRaw) ? tenantRelRaw[0] : tenantRelRaw;
  const vitrinSlug = tenantRel?.slug ?? null;

  const advisorTel = toTelHref(advisor?.phone);
  const advisorWhatsApp = toWhatsAppLink(
    advisor?.phone,
    `Merhaba, ${tenant.name} müşteri paneli üzerinden yazıyorum.`,
  );

  // Her portföy için ilk (kapak öncelikli) PUBLIC görsel — belge atlanır.
  const coverMap = firstPublicImageByProperty(coverRes.data);
  type PortalPropExtra = {
    id: string;
    status: string | null;
    transaction_type: string | null;
    features: unknown;
    district: { name?: string } | { name?: string }[] | null;
  };
  const extraRows = (statusRes.data ?? []) as PortalPropExtra[];
  const statusMap = new Map(extraRows.map((s) => [s.id, s.status]));
  const extraMap = new Map(extraRows.map((s) => [s.id, s]));

  // Müşterinin mevcut geri bildirimleri (tablo henüz yoksa sorgu boş döner)
  const verdictMap = new Map<string, MatchFeedbackVerdict>();
  for (const f of feedbackRes.data ?? []) {
    if (f.verdict === "liked" || f.verdict === "disliked") verdictMap.set(f.property_id, f.verdict);
  }

  return (
    <div className="min-h-screen bg-canvas">
      {/* Header — malik paneliyle aynı kurumsal bant (iki portal tek dil konuşsun) */}
      <header className="theme-dark border-b border-white/10 bg-[image:var(--grad-ink)] px-4 py-4 text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-wider text-mint-400">{tenant.name}</p>
            <h1 className="mt-0.5 font-display font-extrabold">Müşteri Paneli</h1>
          </div>
          <div
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-bold text-white"
          >
            {customer.fullName.split(" ").map((p) => p[0]).join("").slice(0, 2).toLocaleUpperCase("tr-TR")}
          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto max-w-3xl space-y-6 p-4 py-6">
        {/* Karşılama + danışman iletişimi */}
        <section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-5 text-white shadow-[var(--shadow-lg)]">
          <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-brand-600/25 blur-[90px]" />
          <div className="relative">
            <p className="text-sm text-white/55">Hoş geldiniz,</p>
            <h2 className="mt-1 font-display text-xl font-extrabold">{customer.fullName}</h2>
            <p className="mt-1 text-sm text-white/60">
              {advisor?.full_name
                ? `Danışmanınız ${advisor.full_name} arayışınızı sizin için takip ediyor.`
                : `${tenant.name} danışmanınız arayışınızı sizin için takip ediyor.`}
            </p>
            {/* Butonlar danışmana gider — müşterinin kendi numarası değil */}
            {(advisorTel || advisorWhatsApp) && (
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                {advisorTel && (
                  <a
                    href={advisorTel}
                    className="btn-shine inline-flex items-center justify-center gap-2 rounded-[var(--radius-card)] bg-white px-4 py-2.5 text-sm font-bold text-ink-950 transition hover:bg-white/90"
                  >
                    <Phone className="h-4 w-4" /> Danışmanı Ara
                  </a>
                )}
                {advisorWhatsApp && (
                  <a
                    href={advisorWhatsApp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-card)] border border-mint-400/30 bg-mint-500/10 px-4 py-2.5 text-sm font-bold text-mint-300 transition hover:bg-mint-500/20"
                  >
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </a>
                )}
              </div>
            )}
          </div>
        </section>

        {tabs.length > 1 ? (
          <nav aria-label="Panel bölümleri" className="flex gap-1.5 overflow-x-auto">
            {tabs.map((t) => (
              <Link
                key={t}
                href={`/musteri-portali/${token}?sekme=${t}`}
                aria-current={active === t ? "page" : undefined}
                className={`focus-ring inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-semibold transition ${active === t ? "border-brand-500 bg-brand-600 text-white" : "border-line bg-surface text-ink-950 hover:border-brand-300"}`}
              >
                {PORTAL_TAB_LABELS[t]}
              </Link>
            ))}
          </nav>
        ) : null}

        {active === "alici" ? (
        <>
        {/* Eşleşen portföyler */}
        {matches.length > 0 && (
          <PortalSection id="portfoyler" icon={Star} iconClassName="text-amber-500" title="Size Özel Portföyler">
            <div className="grid gap-3 sm:grid-cols-2">
              {matches.map((m) => {
                const coverId = coverMap.get(m.id);
                const coverSrc = coverId
                  ? createShortLivedPropertyMediaUrl(coverId, "customer-portal")
                  : null;
                const verdict = verdictMap.get(m.id) ?? null;
                // Vitrin detayı yalnızca "live" portföyleri servis eder; diğer
                // durumlarda kart bilinçli olarak linksiz kalır (404'e götürme).
                const href =
                  vitrinSlug && statusMap.get(m.id) === "live"
                    ? `/vitrin/${vitrinSlug}/${m.id}`
                    : null;
                // Karşılaştırma tablosu verisi — vitrin kartlarıyla aynı şekil (tek kopya tablo)
                const extra = extraMap.get(m.id);
                const feat = (extra?.features ?? {}) as {
                  rooms?: string;
                  sqm?: number;
                  floor?: number | string;
                  building_age?: number | string;
                };
                const compareItem = {
                  id: m.id,
                  title: m.property.title ?? m.property.code,
                  href,
                  coverId: coverId ?? null,
                  coverSrc,
                  price: m.property.price,
                  tx: extra?.transaction_type ?? null,
                  rooms: feat.rooms ?? null,
                  sqm: feat.sqm ?? null,
                  floor: feat.floor ?? null,
                  buildingAge: feat.building_age ?? null,
                  district: relName(extra?.district),
                };
                const card = (
                  <>
                    {coverSrc ? (
                      <div className="relative aspect-[16/9] w-full overflow-hidden">
                        <Image
                          src={coverSrc}
                          alt={m.property.title ?? m.property.code}
                          fill
                          sizes="(max-width: 640px) 100vw, 340px"
                          unoptimized
                          className="object-cover transition group-hover:scale-[1.02]"
                        />
                      </div>
                    ) : (
                      <div className="grid aspect-[16/9] w-full place-items-center bg-canvas text-text-faint">
                        <Building2 className="h-8 w-8" />
                      </div>
                    )}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-ink-950">{m.property.title ?? m.property.code}</p>
                          {m.property.province && (
                            <p className="mt-0.5 flex items-center gap-1 text-xs text-text-muted">
                              <MapPin className="h-3 w-3" /> {m.property.province}
                            </p>
                          )}
                        </div>
                        {m.score && (
                          <span className="shrink-0 rounded-full bg-mint-500/12 px-2 py-0.5 text-xs font-bold text-mint-700">
                            %{m.score} eşleşme
                          </span>
                        )}
                      </div>
                      {m.property.price && (
                        <p className="mt-2 text-sm font-bold text-ink-950">{money(m.property.price)}</p>
                      )}
                      {href && (
                        <p className="mt-1.5 text-xs font-semibold text-brand-600">İlan detayını görüntüle →</p>
                      )}
                    </div>
                  </>
                );
                // Geri bildirim butonları Link DIŞINDA kalır (tık gezinmesin);
                // "İlgilenmiyorum" denilen kart soluk görünür.
                return (
                  <div
                    key={m.id}
                    className={`overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-xs)] transition ${
                      verdict === "disliked"
                        ? "opacity-60 saturate-50"
                        : "hover:border-brand-300 hover:shadow-[var(--shadow-sm)]"
                    }`}
                  >
                    {href ? (
                      <Link href={href} className="group block">
                        {card}
                      </Link>
                    ) : (
                      <div className="group">{card}</div>
                    )}
                    {/* ✓ seçim (2-3 portföy) → alt çubukta Karşılaştır; beğen/geç aynen kalır */}
                    <CompareToggle item={compareItem} variant="row" />
                    <MatchFeedback token={token} propertyId={m.id} initialVerdict={verdict} />
                    {requestsEnabled && statusMap.get(m.id) ? <PortalRequestForm token={token} refId={m.id} variant="offer" /> : null}
                  </div>
                );
              })}
            </div>
            <CompareBar />
          </PortalSection>
        )}

        {/* Aktif talepler */}
        {demands.length > 0 && (
          <PortalSection id="arayislar" icon={Search} title="Arayışlarım">
            <div className="space-y-2">
              {demands.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-xs)]">
                  <div>
                    <p className="text-sm font-semibold text-ink-950">
                      {DEMAND_TYPE_LABELS[d.type] ?? d.type}
                      {d.province ? ` — ${d.province}` : ""}
                    </p>
                    {(d.minPrice || d.maxPrice) && (
                      <p className="mt-0.5 text-xs text-text-muted">
                        {d.minPrice ? money(d.minPrice) : "—"} – {d.maxPrice ? money(d.maxPrice) : "—"}
                      </p>
                    )}
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                    d.status === "active"
                      ? "bg-mint-500/12 text-mint-700"
                      : "bg-canvas text-text-muted"
                  }`}>
                    {d.status === "active" ? "Aktif" : d.status}
                  </span>
                </div>
              ))}
            </div>
          </PortalSection>
        )}

        {/* Yaklaşan randevular */}
        {appointments.length > 0 && (
          <PortalSection id="randevular" icon={CalendarDays} title="Yaklaşan Randevularım">
            <div className="space-y-2">
              {appointments.map((a) => (
                <div key={a.id} className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-xs)]">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
                      <CalendarDays className="h-4 w-4" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink-950">{APPT_TYPE_LABELS[a.type] ?? a.type}</p>
                      <p className="text-xs text-text-muted">{formatDate(a.scheduledAt)}</p>
                      {a.location && (
                        <p className="flex items-center gap-1 text-xs text-text-faint">
                          <MapPin className="h-3 w-3" /> {a.location}
                        </p>
                      )}
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                      a.status === "confirmed" ? "bg-mint-500/12 text-mint-700" : "bg-amber-400/15 text-amber-700"
                    }`}>
                      {a.status === "confirmed" ? "Onaylandı" : "Teyit Bekliyor"}
                    </span>
                  </div>
                  {requestsEnabled ? (
                    <div className="-mx-4 mt-2">
                      <PortalRequestForm token={token} refId={a.id} variant="appointment" />
                    </div>
                  ) : null}
                  <div className="mt-2 flex justify-end border-t border-line pt-2">
                    <AddToCalendarButton
                      event={{
                        uid:         a.id,
                        title:       `${APPT_TYPE_LABELS[a.type] ?? a.type} — ${tenant.name}`,
                        description: `${tenant.name} randevunuz.`,
                        location:    a.location ?? undefined,
                        startAt:     new Date(a.scheduledAt),
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </PortalSection>
        )}

        {homeValues.length > 0 && (
          <PortalSection id="guncel-deger" icon={Building2} title="Evinizin güncel değeri (tahmin)">
            <div className="space-y-2">
              {homeValues.map((h) => (
                <div key={h.propertyId} className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-xs)]">
                  <p className="text-sm font-semibold text-ink-950">{h.label}</p>
                  <p className="mt-1 font-display text-lg font-extrabold text-ink-950">
                    {money(h.display.low)} – {money(h.display.high)}
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    Tahmin · {h.display.compCount} emsal · güven: {h.display.confidence}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-text-faint">{HOME_VALUE_NOTE}</p>
          </PortalSection>
        )}

        {/* Boş durum */}
        {matches.length === 0 && demands.length === 0 && appointments.length === 0 && (
          <PortalEmpty
            icon={CheckCircle2}
            title="Henüz kayıt yok"
            hint="Danışmanınız arayışınızı, size özel portföyleri ve randevularınızı buraya ekledikçe bu sayfa dolacak."
          />
        )}
        </>
        ) : null}

        {active === "malik" ? (
          <PortalSection id="mulkum" icon={Home} title="Mülküm">
            <div className="space-y-3">
              {owner.map((o) => (
                <div key={o.id} className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-xs)]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-950">{o.label}</p>
                      <p className="mt-0.5 text-xs text-text-muted">Liste fiyatı {money(o.listPrice)} · {o.livePortals} portalda yayında</p>
                    </div>
                  </div>
                  {o.offers.length > 0 ? (
                    <ul className="mt-2 divide-y divide-line text-sm">
                      {o.offers.map((x, i) => (
                        <li key={i} className="flex items-center justify-between gap-2 py-1.5">
                          <span className="font-semibold tabular-nums text-ink-950">{money(x.amount)}</span>
                          <span className="text-xs text-text-muted">{OWNER_OFFER_LABELS[x.status] ?? x.status}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-text-muted">Henüz değerlendirmedeki teklif yok.</p>
                  )}
                  {o.ownerPortalHref ? (
                    <Link href={o.ownerPortalHref} className="focus-ring mt-2 inline-flex min-h-10 items-center text-xs font-bold text-brand-600">
                      Haftalık rapor, teklif kararı ve kira ekstresi →
                    </Link>
                  ) : (
                    <p className="mt-2 text-xs text-text-faint">Ayrıntılı malik raporu için danışmanınızdan malik bağlantısı isteyin.</p>
                  )}
                </div>
              ))}
            </div>
          </PortalSection>
        ) : null}

        {active === "kiraci" ? (
          <PortalSection id="kiram" icon={KeyRound} title="Kiram">
            <div className="space-y-3">
              {renter.map((r) => (
                <div key={r.id} className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-xs)]">
                  <div className="px-4 py-3">
                    <p className="text-sm font-semibold text-ink-950">{r.label}</p>
                    <p className="mt-0.5 text-xs text-text-muted">Aylık kira {money(r.monthlyRent)} · her ayın {r.dueDay}. günü</p>
                    {r.charges.length > 0 ? (
                      <ul className="mt-2 divide-y divide-line text-sm">
                        {r.charges.map((c) => (
                          <li key={c.period} className="flex items-center justify-between gap-2 py-1.5">
                            <span className="text-text-muted">{formatDateTimeTr(c.period, { month: "long", year: "numeric" })}</span>
                            <span className="flex items-center gap-2">
                              <span className="tabular-nums text-ink-950">{money(c.amount)}</span>
                              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${c.status === "paid" ? "bg-mint-500/12 text-mint-700" : c.status === "overdue" ? "bg-danger-500/10 text-danger-600" : "bg-amber-400/15 text-amber-700"}`}>
                                {RENT_CHARGE_LABELS[c.status] ?? c.status}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-text-muted">Henüz kira tahakkuku yok.</p>
                    )}
                    {r.maintenance.length > 0 ? (
                      <div className="mt-3">
                        <p className="text-xs font-semibold text-ink-950">Bakım talepleriniz</p>
                        <ul className="mt-1 space-y-1 text-xs text-text-muted">
                          {r.maintenance.map((m, i) => (
                            <li key={i} className="flex items-center justify-between gap-2">
                              <span className="truncate">{m.title}</span>
                              <span className="shrink-0 font-semibold">{MAINTENANCE_LABELS[m.status] ?? m.status}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                  {requestsEnabled ? <PortalRequestForm token={token} refId={r.id} variant="maintenance" /> : null}
                </div>
              ))}
            </div>
          </PortalSection>
        ) : null}

        {active === "belgeler" ? (
          <PortalSection id="belgeler" icon={FileSignature} title="Belgeler">
            <div className="space-y-2">
              {documents.pendingSign.map((d) => (
                <Link key={d.id} href={d.href} className="focus-ring flex min-h-11 items-center justify-between gap-2 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/8 px-4 py-3 text-sm font-semibold text-ink-950">
                  <span className="truncate">{d.title}</span>
                  <span className="shrink-0 text-xs font-bold text-amber-700">İmzanızı bekliyor →</span>
                </Link>
              ))}
              {documents.signed.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-sm">
                  <span className="truncate text-ink-950">{d.title}</span>
                  <span className="shrink-0 text-xs text-text-muted">İmzalandı{d.signedAt ? ` · ${formatDateTimeTr(d.signedAt, { day: "2-digit", month: "long", year: "numeric" })}` : ""}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-text-faint">Belgelerin kendisi bu sayfada gösterilmez; imza bağlantısı yalnız size özeldir.</p>
          </PortalSection>
        ) : null}

        <PortalFooterNote office={tenant.name} />
        <PortalStickySpacer active={Boolean(advisorTel || advisorWhatsApp)} />
      </main>

      {/* Mobilde alta yapışan iletişim çubuğu — uzun sayfada danışman erişimi kaybolmasın */}
      <PortalContactBar
        telHref={advisorTel}
        whatsAppHref={advisorWhatsApp}
        callLabel={advisor?.full_name ? "Danışmanı Ara" : "Ofisi Ara"}
      />
    </div>
  );
}
