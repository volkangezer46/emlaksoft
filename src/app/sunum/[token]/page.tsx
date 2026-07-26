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
  MessageCircle,
  Phone,
  Ruler,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatTurkishPhone, toTelHref, toWhatsAppLink } from "@/lib/phone";
import { PrintButton } from "./print-button";

// Sunum linkleri kişiye özeldir → arama motorlarına kapalı (degerleme-raporu deseni).
export const metadata: Metadata = {
  title: "Portföy sunumu",
  robots: { index: false, follow: false },
};

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

function money(n: number | null, tx: string) {
  if (n == null) return "Fiyat için sorun";
  const s = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
  return tx === "rent" || tx.toLowerCase().includes("kira") ? `${s}/ay` : s;
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
    .select("id, tenant_id, title, customer_name, property_ids, note, created_by, created_at")
    .eq("public_token", token)
    .maybeSingle();
  if (!pres) notFound();

  const propertyIds = (pres.property_ids ?? []) as string[];

  const [{ data: tenant }, { data: advisor }, { data: propertyData }] = await Promise.all([
    admin.from("tenants").select("name, phone, logo_url, brand_color").eq("id", pres.tenant_id).maybeSingle(),
    pres.created_by
      ? admin.from("profiles").select("full_name, phone").eq("id", pres.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
    propertyIds.length
      ? admin
          .from("properties")
          .select(
            "id, property_code, title, transaction_type, property_type, status, list_price, address_line, features, province:geo_provinces(name), district:geo_districts(name)",
          )
          .in("id", propertyIds)
          .eq("tenant_id", pres.tenant_id)
          .is("deleted_at", null)
      : Promise.resolve({ data: [] }),
  ]);

  // Sunum sonrası taslağa çekilen/silinen portföyler linke sızmasın
  // (public medya API'siyle aynı çizgi); seçim sırası korunur.
  const byId = new Map((propertyData ?? []).filter((p) => p.status !== "draft").map((p) => [p.id as string, p]));
  const properties = propertyIds.map((id) => byId.get(id)).filter((p) => p != null);
  if (properties.length === 0) notFound();

  // Tüm portföylerin görselleri tek sorguda: kapak önde, sonra sort_order.
  const { data: mediaRows } = await admin
    .from("property_media")
    .select("id, property_id, is_cover, sort_order")
    .in("property_id", properties.map((p) => p.id as string))
    .eq("kind", "image")
    .order("is_cover", { ascending: false })
    .order("sort_order", { ascending: true });
  const mediaByProperty = new Map<string, string[]>();
  for (const m of mediaRows ?? []) {
    const list = mediaByProperty.get(m.property_id) ?? [];
    list.push(m.id);
    mediaByProperty.set(m.property_id, list);
  }

  // İlan açıklaması: `description` kolonu her kurulumda bulunmayabilir → ana
  // sorgudan ayrı ve hataya toleranslı okunur (vitrin/[slug]/[id] deseni);
  // kolon yoksa features.description'a düşülür.
  const descById = new Map<string, string>();
  {
    const { data: descRows } = await admin
      .from("properties")
      .select("id, description")
      .in("id", properties.map((p) => p.id as string));
    for (const d of (descRows ?? []) as { id: string; description?: string | null }[]) {
      const text = String(d.description ?? "").trim();
      if (text) descById.set(d.id, text);
    }
  }

  // Görüntülenme: yanıt gönderildikten SONRA atomik +1 (increment_listing_view deseni).
  after(async () => {
    const { error } = await admin.rpc("increment_presentation_view", { p_id: pres.id });
    if (error) console.error("increment_presentation_view", error.message);
  });

  const officeName = tenant?.name ?? "Emlak ofisi";
  const brand = tenant?.brand_color?.trim() || BRAND_FALLBACK;
  const contactPhone = advisor?.phone || tenant?.phone || null;
  const telHref = toTelHref(contactPhone);
  const waHref = toWhatsAppLink(
    contactPhone,
    `Merhaba${advisor?.full_name ? ` ${advisor.full_name} Bey/Hanım` : ""}, "${pres.title}" sunumundaki portföyler hakkında bilgi almak istiyorum.`,
  );
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
          <PrintButton />
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
                    className="h-11 w-11 shrink-0 rounded-[10px] bg-white object-contain p-1"
                  />
                ) : (
                  <span
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] font-display text-lg font-extrabold text-white"
                    style={{ backgroundColor: brand }}
                  >
                    {officeName[0]}
                  </span>
                )}
                <div>
                  <p className="font-display text-base font-extrabold leading-tight">{officeName}</p>
                  <p className="text-[11px] uppercase tracking-[0.14em] text-white/50">Portföy sunumu</p>
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
                <p className="mt-4 max-w-xl whitespace-pre-line rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm leading-relaxed text-white/75">
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
                      {contactPhone ? ` · ${formatTurkishPhone(contactPhone)}` : ""}
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
          const coverId = images[0] ?? null;
          const gallery = images.slice(1, 7);
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
          const description = descById.get(property.id as string) ?? String(feat.description ?? "").trim();

          return (
            <article
              key={property.id as string}
              className="print-sheet surface-card overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-lg)] print:break-before-page"
            >
              {/* Kapak fotoğrafı */}
              <div className="relative aspect-[16/9] w-full overflow-hidden bg-[image:var(--grad-brand-soft)]">
                {coverId ? (
                  <Image
                    src={`/api/property-media/${coverId}`}
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
                <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 text-[11px] font-bold text-ink-950 shadow-[var(--shadow-xs)] backdrop-blur">
                  {index + 1} / {properties.length}
                </span>
                <span
                  className="absolute right-4 top-4 rounded-full px-3 py-1 text-[11px] font-bold uppercase text-white shadow-[var(--shadow-xs)]"
                  style={{ backgroundColor: brand }}
                >
                  {property.transaction_type as string}
                </span>
              </div>

              <div className="p-6 sm:p-8">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: brand }}>
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
                    {money(property.list_price != null ? Number(property.list_price) : null, property.transaction_type as string)}
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
                    {gallery.map((mid) => (
                      <div key={mid} className="relative aspect-[4/3] overflow-hidden rounded-[10px] border border-line bg-canvas">
                        <Image
                          src={`/api/property-media/${mid}`}
                          alt="Portföy fotoğrafı"
                          fill
                          sizes="(max-width: 768px) 33vw, 240px"
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}

        {/* ============ İLETİŞİM CTA ============ */}
        <article className="print-sheet surface-card overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-lg)] print:break-before-page">
          <div className="px-6 py-8 text-center sm:px-10">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-[14px]" style={{ backgroundColor: `${brand}1a` }}>
              <Phone className="h-6 w-6" style={{ color: brand }} />
            </span>
            <h2 className="mt-4 font-display text-xl font-extrabold text-ink-950">Beğendiğiniz portföy oldu mu?</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-muted">
              {advisor?.full_name ? `Danışmanınız ${advisor.full_name}` : officeName} yer gösterimi ve
              detaylar için bir telefon uzağınızda.
            </p>
            {contactPhone ? (
              <p className="numeric mt-3 font-display text-lg font-extrabold text-ink-950">
                {formatTurkishPhone(contactPhone)}
              </p>
            ) : null}
            {telHref || waHref ? (
              <div className="no-print mt-5 flex flex-wrap justify-center gap-2">
                {telHref ? (
                  <a
                    href={telHref}
                    className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[12px] px-5 py-3 text-sm font-bold text-white"
                    style={{ backgroundColor: brand }}
                  >
                    <Phone className="h-4 w-4" /> Hemen ara
                  </a>
                ) : null}
                {waHref ? (
                  <a
                    href={waHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="focus-ring press inline-flex items-center gap-2 rounded-[12px] border border-mint-500/40 bg-mint-500/10 px-5 py-3 text-sm font-bold text-mint-600 transition hover:bg-mint-500/20"
                  >
                    <MessageCircle className="h-4 w-4" /> WhatsApp&apos;tan yaz
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        </article>

        <p className="no-print text-center text-[11px] text-text-faint">
          Bu sayfa size özel bir sunum linkidir ·{" "}
          <Link href="/" className="font-semibold underline-offset-2 transition hover:text-text-muted hover:underline">
            Powered by EmlakSoft
          </Link>
        </p>
      </div>
    </div>
  );
}
