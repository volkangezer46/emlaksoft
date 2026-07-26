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
import { toTelHref, toWhatsAppLink } from "@/lib/phone";
import { OfferActions } from "./offer-actions";

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

const APPT_TYPE: Record<string, string> = {
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
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(iso));
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

type Advisor = { full_name?: string; phone?: string | null } | { full_name?: string; phone?: string | null }[] | null;
type TenantRel = { phone?: string | null } | { phone?: string | null }[] | null;

export default async function MalikPortaliPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await getOwnerPortalData(token);

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-red-50">
            <Building2 className="h-8 w-8 text-red-400" />
          </div>
          <h1 className="font-bold text-lg text-zinc-900">Bağlantı geçersiz veya süresi dolmuş</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Bu malik paneli bağlantısı artık geçerli değil. Danışmanınızla iletişime geçin.
          </p>
        </div>
      </div>
    );
  }

  const { property, tenant, ownerName, portalListings, offers, appointments } = data;
  const liveListings = portalListings.filter((l) => l.status === "live");

  // Sayfaya özel ek veriler — paylaşılan portal aksiyonuna dokunmadan burada:
  // kapak görseli + atanmış danışman ve ofis telefonu (Ara / WhatsApp için)
  // + liste fiyatı geçmişi (yalnızca list_price — min/gizli fiyat malike sızmaz).
  const admin = createAdminClient();
  const [{ data: propertyRel }, { data: coverRow }, { data: priceRows }] = await Promise.all([
    admin
      .from("properties")
      .select("assigned_to:profiles(full_name, phone), tenant:tenants(phone)")
      .eq("id", property.id)
      .maybeSingle(),
    admin
      .from("property_media")
      .select("id")
      .eq("property_id", property.id)
      .eq("kind", "image")
      .order("is_cover", { ascending: false })
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin
      .from("property_price_history")
      .select("id, old_price, new_price, change_pct, created_at")
      .eq("property_id", property.id)
      .eq("price_field", "list_price")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const advisorRaw = (propertyRel?.assigned_to ?? null) as Advisor;
  const advisor = Array.isArray(advisorRaw) ? advisorRaw[0] : advisorRaw;
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
  const coverId = coverRow?.id ?? null;

  const priceHistory = (priceRows ?? []).map((h) => ({
    id:        h.id,
    oldPrice:  h.old_price != null ? Number(h.old_price) : null,
    newPrice:  Number(h.new_price),
    changePct: h.change_pct != null ? Number(h.change_pct) : null,
    createdAt: h.created_at as string,
  }));

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-zinc-900 px-4 py-4 text-white">
        <div className="mx-auto max-w-3xl flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{tenant.name}</p>
            <h1 className="mt-0.5 font-bold">Malik Paneli</h1>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-sm font-bold text-white">
            {ownerName.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 p-4 py-6">
        {/* Portföy özeti */}
        <section className="overflow-hidden rounded-2xl bg-zinc-900 text-white">
          {coverId && (
            <div className="relative aspect-[16/8] w-full">
              <Image
                src={`/api/property-media/${coverId}`}
                alt={property.title ?? property.code}
                fill
                priority
                sizes="(max-width: 768px) 100vw, 720px"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 to-transparent" />
            </div>
          )}
          <div className="p-5">
            <p className="text-xs text-zinc-400">Sayın {ownerName},</p>
            <h2 className="mt-1 text-xl font-bold">{property.title ?? property.code}</h2>
            {(property.province || property.district) && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-400">
                <MapPin className="h-3.5 w-3.5" />
                {[property.district, property.province].filter(Boolean).join(", ")}
              </p>
            )}
            {/* KPI kutuları — sayı, ilgili bölüme iner */}
            <div className="mt-4 flex flex-wrap gap-3">
              <div className="rounded-xl bg-white/10 px-4 py-3 text-center">
                <p className="text-xs text-zinc-400">Liste fiyatı</p>
                <p className="mt-0.5 font-bold text-white">{money(property.listPrice)}</p>
              </div>
              <a href="#yayinlar" className="rounded-xl bg-white/10 px-4 py-3 text-center transition hover:bg-white/20">
                <p className="text-xs text-zinc-400">Yayın sayısı</p>
                <p className="mt-0.5 font-bold text-white">{liveListings.length}</p>
              </a>
              <a href="#teklifler" className="rounded-xl bg-white/10 px-4 py-3 text-center transition hover:bg-white/20">
                <p className="text-xs text-zinc-400">Gelen teklif</p>
                <p className="mt-0.5 font-bold text-white">{offers.length}</p>
              </a>
              <a href="#randevular" className="rounded-xl bg-white/10 px-4 py-3 text-center transition hover:bg-white/20">
                <p className="text-xs text-zinc-400">Randevu</p>
                <p className="mt-0.5 font-bold text-white">{appointments.length}</p>
              </a>
            </div>
            {/* Danışman / ofis iletişimi */}
            {(contactTel || contactWhatsApp) && (
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                {contactTel && (
                  <a
                    href={contactTel}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-zinc-900 transition hover:bg-zinc-100"
                  >
                    <Phone className="h-4 w-4" /> {contactLabel}
                  </a>
                )}
                {contactWhatsApp && (
                  <a
                    href={contactWhatsApp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-2.5 text-sm font-bold text-emerald-300 transition hover:bg-emerald-500/25"
                  >
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </a>
                )}
              </div>
            )}
            {advisor?.full_name && (
              <p className="mt-3 text-xs text-zinc-400">Sorumlu danışmanınız: {advisor.full_name}</p>
            )}
          </div>
        </section>

        {/* Yayın durumu */}
        <section id="yayinlar" className="scroll-mt-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-900">
            <RadioTower className="h-4 w-4 text-blue-600" /> Portal Yayınları
          </h3>
          {portalListings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white py-8 text-center">
              <p className="text-sm text-zinc-500">Henüz portal yayını bulunmuyor.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {portalListings.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className={`grid h-8 w-8 place-items-center rounded-lg ${l.status === "live" ? "bg-emerald-50 text-emerald-600" : "bg-zinc-100 text-zinc-400"}`}>
                      <RadioTower className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-zinc-900">{l.portalName}</p>
                      {l.publishedAt && (
                        <p className="text-xs text-zinc-500">Yayın: {formatDate(l.publishedAt)}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                      l.status === "live" ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-500"
                    }`}>
                      {PORTAL_STATUS[l.status] ?? l.status}
                    </span>
                    {l.portalUrl && (
                      <a href={l.portalUrl} target="_blank" rel="noreferrer" className="grid h-8 w-8 place-items-center rounded-lg border border-zinc-200 text-zinc-400 transition hover:text-blue-600" aria-label="İlanı görüntüle">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Teklifler */}
        <section id="teklifler" className="scroll-mt-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-900">
            <Tag className="h-4 w-4 text-amber-600" /> Gelen Teklifler
          </h3>
          {offers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white py-8 text-center">
              <p className="text-sm text-zinc-500">Henüz teklif gelmedi. Teklifler geldiğinde burada görünür.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {offers.map((o) => (
                <div key={o.id} className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-zinc-900">{money(o.amount)}</p>
                      {o.notes && <p className="mt-1 text-xs text-zinc-500 line-clamp-2">{o.notes}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <span className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-bold ${
                        o.status === "accepted"  ? "bg-emerald-50 text-emerald-700" :
                        o.status === "rejected"  ? "bg-red-50 text-red-700" :
                        o.status === "countered" ? "bg-amber-50 text-amber-700" :
                        "bg-blue-50 text-blue-700"
                      }`}>
                        {OFFER_STATUS[o.status] ?? o.status}
                      </span>
                      {o.submittedAt && (
                        <p className="mt-1 text-[11px] text-zinc-500">{formatDateTime(o.submittedAt)}</p>
                      )}
                    </div>
                  </div>
                  {/* Malik aksiyonları — yalnızca değerlendirmedeki teklifler */}
                  {o.status === "submitted" && (
                    <div className="mt-3 border-t border-zinc-100 pt-3">
                      <OfferActions token={token} offerId={o.id} amountLabel={money(o.amount)} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Fiyat geçmişi — kayıt varsa (yalnızca liste fiyatı serisi) */}
        {priceHistory.length > 0 && (
          <section id="fiyat-gecmisi" className="scroll-mt-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-900">
              <History className="h-4 w-4 text-teal-600" /> Fiyat Geçmişi
            </h3>
            <div className="space-y-2">
              {priceHistory.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">
                      {h.oldPrice != null ? (
                        <>
                          <span className="font-medium text-zinc-400 line-through">{money(h.oldPrice)}</span>
                          <span className="mx-1.5 text-zinc-400">→</span>
                          {money(h.newPrice)}
                        </>
                      ) : (
                        money(h.newPrice)
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {formatDate(h.createdAt)}
                      {h.oldPrice == null ? " · İlk fiyat" : ""}
                    </p>
                  </div>
                  {h.changePct != null && h.changePct !== 0 && (
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                      h.changePct < 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                    }`}>
                      {h.changePct > 0 ? "+" : "−"}%
                      {Math.abs(h.changePct).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Randevular */}
        <section id="randevular" className="scroll-mt-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-900">
            <CalendarDays className="h-4 w-4 text-purple-600" /> Randevular
          </h3>
          {appointments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white py-8 text-center">
              <p className="text-sm text-zinc-500">Planlanmış randevu bulunmuyor.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {appointments.map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-purple-50 text-purple-600">
                    <CalendarDays className="h-4 w-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-900">{APPT_TYPE[a.type] ?? a.type}</p>
                    <p className="text-xs text-zinc-500">{formatDateTime(a.scheduledAt)}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    a.status === "confirmed" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                  }`}>
                    {a.status === "confirmed" ? "Onaylandı" : "Teyit Bekliyor"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Açıklama */}
        {property.description && (
          <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <h3 className="mb-2 text-sm font-bold text-zinc-900">İlan Açıklaması</h3>
            <p className="text-sm leading-relaxed text-zinc-600">{property.description}</p>
          </section>
        )}

        <p className="text-center text-xs text-zinc-400 pb-4">
          Bu sayfa {tenant.name} tarafından sizin için oluşturulmuştur.
          <br />EmlakSoft ile güçlendirilmiştir.
        </p>
      </main>
    </div>
  );
}
