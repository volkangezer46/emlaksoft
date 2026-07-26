import Link from "next/link";
import Image from "next/image";
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  Star,
  UserRound,
} from "lucide-react";
import { getCustomerPortalData } from "@/app/actions/customer-portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { toTelHref, toWhatsAppLink } from "@/lib/phone";
import { AddToCalendarButton } from "@/components/app/add-to-calendar-button";
import { MatchFeedback } from "./match-feedback";
import { CompareBar, CompareToggle } from "@/components/public/compare-select";
import type { MatchFeedbackVerdict } from "@/app/actions/customer-portal-feedback";

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

const APPT_TYPE_LABELS: Record<string, string> = {
  showing:   "Yer gösterme",
  office:    "Ofis görüşmesi",
  valuation: "Değerleme",
  contract:  "Sözleşme",
};

function money(n: number | null) {
  if (!n) return "—";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

function relName(v: { name?: string } | { name?: string }[] | null | undefined) {
  if (!v) return null;
  const r = Array.isArray(v) ? v[0] : v;
  return r?.name ?? null;
}

type Advisor = { full_name?: string; phone?: string | null } | { full_name?: string; phone?: string | null }[] | null;
type TenantRel = { slug?: string | null } | { slug?: string | null }[] | null;

export default async function CustomerPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await getCustomerPortalData(token);

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-red-50">
            <UserRound className="h-8 w-8 text-red-400" />
          </div>
          <h1 className="font-bold text-lg text-zinc-900">Bağlantı geçersiz veya süresi dolmuş</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Bu portal linki artık geçerli değil. Danışmanınızla iletişime geçin.
          </p>
        </div>
      </div>
    );
  }

  const { customer, tenant, demands, appointments, matches } = data;

  // Sayfaya özel ek veriler — paylaşılan portal aksiyonuna dokunmadan burada:
  // atanmış danışman iletişimi, vitrin slug'ı, eşleşen portföylerin kapak
  // görselleri, yayın durumu (vitrin yalnızca "live" portföyleri gösterir)
  // ve müşterinin daha önce verdiği beğen/geç geri bildirimleri.
  const admin = createAdminClient();
  const matchIds = matches.map((m) => m.id);
  const [{ data: customerRel }, coverRes, statusRes, feedbackRes] = await Promise.all([
    admin
      .from("customers")
      .select("assigned_to:profiles(full_name, phone), tenant:tenants(slug)")
      .eq("id", customer.id)
      .maybeSingle(),
    matchIds.length > 0
      ? admin
          .from("property_media")
          .select("id, property_id")
          .eq("kind", "image")
          .in("property_id", matchIds)
          .order("is_cover", { ascending: false })
          .order("sort_order", { ascending: true })
      : Promise.resolve({ data: [] as { id: string; property_id: string }[] }),
    matchIds.length > 0
      ? admin
          .from("properties")
          // status: vitrin linki için; transaction_type/features/district:
          // karşılaştırma tablosuna oda-m²-kat-bina yaşı-ilçe taşır
          .select("id, status, transaction_type, features, district:geo_districts(name)")
          .in("id", matchIds)
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
          .eq("customer_id", customer.id)
          .in("property_id", matchIds)
      : Promise.resolve({ data: [] as { property_id: string; verdict: string }[] }),
  ]);

  const advisorRaw = (customerRel?.assigned_to ?? null) as Advisor;
  const advisor = Array.isArray(advisorRaw) ? advisorRaw[0] : advisorRaw;
  const tenantRelRaw = (customerRel?.tenant ?? null) as TenantRel;
  const tenantRel = Array.isArray(tenantRelRaw) ? tenantRelRaw[0] : tenantRelRaw;
  const vitrinSlug = tenantRel?.slug ?? null;

  const advisorTel = toTelHref(advisor?.phone);
  const advisorWhatsApp = toWhatsAppLink(
    advisor?.phone,
    `Merhaba, ${tenant.name} müşteri paneli üzerinden yazıyorum.`,
  );

  // Her portföy için ilk (kapak öncelikli) görsel
  const coverMap = new Map<string, string>();
  for (const m of coverRes.data ?? []) {
    if (!coverMap.has(m.property_id)) coverMap.set(m.property_id, m.id);
  }
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
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white px-4 py-4">
        <div className="mx-auto max-w-3xl flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{tenant.name}</p>
            <h1 className="mt-0.5 font-bold text-zinc-900">Müşteri Paneli</h1>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-sm font-bold text-white">
            {customer.fullName.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 p-4 py-6">
        {/* Karşılama + danışman iletişimi */}
        <section className="rounded-2xl bg-zinc-900 p-5 text-white">
          <p className="text-sm text-zinc-400">Hoş geldiniz,</p>
          <h2 className="mt-1 text-xl font-bold">{customer.fullName}</h2>
          <p className="mt-1 text-sm text-zinc-400">
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
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-zinc-900 transition hover:bg-zinc-100"
                >
                  <Phone className="h-4 w-4" /> Danışmanı Ara
                </a>
              )}
              {advisorWhatsApp && (
                <a
                  href={advisorWhatsApp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-2.5 text-sm font-bold text-emerald-300 transition hover:bg-emerald-500/25"
                >
                  <MessageCircle className="h-4 w-4" /> WhatsApp
                </a>
              )}
            </div>
          )}
        </section>

        {/* Eşleşen portföyler */}
        {matches.length > 0 && (
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-900">
              <Star className="h-4 w-4 text-amber-500" /> Size Özel Portföyler
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {matches.map((m) => {
                const coverId = coverMap.get(m.id);
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
                    {coverId ? (
                      <div className="relative aspect-[16/9] w-full overflow-hidden">
                        <Image
                          src={`/api/property-media/${coverId}`}
                          alt={m.property.title ?? m.property.code}
                          fill
                          sizes="(max-width: 640px) 100vw, 340px"
                          className="object-cover transition group-hover:scale-[1.02]"
                        />
                      </div>
                    ) : (
                      <div className="grid aspect-[16/9] w-full place-items-center bg-zinc-100 text-zinc-300">
                        <Building2 className="h-8 w-8" />
                      </div>
                    )}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-zinc-900">{m.property.title ?? m.property.code}</p>
                          {m.property.province && (
                            <p className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500">
                              <MapPin className="h-3 w-3" /> {m.property.province}
                            </p>
                          )}
                        </div>
                        {m.score && (
                          <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                            %{m.score} eşleşme
                          </span>
                        )}
                      </div>
                      {m.property.price && (
                        <p className="mt-2 text-sm font-bold text-zinc-900">{money(m.property.price)}</p>
                      )}
                      {href && (
                        <p className="mt-1.5 text-[11px] font-semibold text-blue-600">İlan detayını görüntüle →</p>
                      )}
                    </div>
                  </>
                );
                // Geri bildirim butonları Link DIŞINDA kalır (tık gezinmesin);
                // "İlgilenmiyorum" denilen kart soluk görünür.
                return (
                  <div
                    key={m.id}
                    className={`overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition ${
                      verdict === "disliked"
                        ? "opacity-60 saturate-50"
                        : "hover:border-blue-300 hover:shadow-md"
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
                  </div>
                );
              })}
            </div>
            <CompareBar />
          </section>
        )}

        {/* Aktif talepler */}
        {demands.length > 0 && (
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-900">
              <Search className="h-4 w-4 text-blue-600" /> Arayışlarım
            </h3>
            <div className="space-y-2">
              {demands.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">
                      {DEMAND_TYPE_LABELS[d.type] ?? d.type}
                      {d.province ? ` — ${d.province}` : ""}
                    </p>
                    {(d.minPrice || d.maxPrice) && (
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {d.minPrice ? money(d.minPrice) : "—"} – {d.maxPrice ? money(d.maxPrice) : "—"}
                      </p>
                    )}
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                    d.status === "active"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-zinc-100 text-zinc-500"
                  }`}>
                    {d.status === "active" ? "Aktif" : d.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Yaklaşan randevular */}
        {appointments.length > 0 && (
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-900">
              <CalendarDays className="h-4 w-4 text-purple-600" /> Yaklaşan Randevularım
            </h3>
            <div className="space-y-2">
              {appointments.map((a) => (
                <div key={a.id} className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-purple-50 text-purple-600">
                      <CalendarDays className="h-4 w-4" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-900">{APPT_TYPE_LABELS[a.type] ?? a.type}</p>
                      <p className="text-xs text-zinc-500">{formatDate(a.scheduledAt)}</p>
                      {a.location && (
                        <p className="flex items-center gap-1 text-xs text-zinc-400">
                          <MapPin className="h-3 w-3" /> {a.location}
                        </p>
                      )}
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                      a.status === "confirmed" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                    }`}>
                      {a.status === "confirmed" ? "Onaylandı" : "Teyit Bekliyor"}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-end border-t border-zinc-100 pt-2">
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
          </section>
        )}

        {/* Boş durum */}
        {matches.length === 0 && demands.length === 0 && appointments.length === 0 && (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white py-12 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-zinc-300" />
            <p className="mt-3 font-semibold text-zinc-600">Henüz kayıt yok</p>
            <p className="mt-1 text-sm text-zinc-400">Danışmanınız bilgileri güncellediğinde burada görünecek.</p>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-zinc-400 pb-4">
          Bu sayfa {tenant.name} tarafından sizin için oluşturulmuştur.
          <br />EmlakSoft ile güçlendirilmiştir.
        </p>
      </main>
    </div>
  );
}
