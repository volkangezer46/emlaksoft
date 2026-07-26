import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, Flame, Layers, Phone, QrCode, Ruler, BedDouble, CalendarClock, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { moneyTry } from "@/lib/leak-shield";
import { PrintButton } from "./print-button";

type Rel = { name?: string } | { name?: string }[] | null;

function relName(value: Rel) {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  return row?.name ?? null;
}

/**
 * İlan açıklaması: `description` kolonu her kurulumda bulunmayabilir → ana
 * sorgudan ayrı ve hataya toleranslı okunur (vitrin/paylas sayfalarındaki
 * fetchDescription deseni). Eski kayıtlar için features.description'a düşülür.
 */
async function fetchDescription(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyId: string,
  features: unknown,
): Promise<string | null> {
  const { data } = await supabase.from("properties").select("description").eq("id", propertyId).maybeSingle();
  const col = (data as { description?: string | null } | null)?.description;
  const feat = ((features ?? {}) as { description?: string }).description;
  const text = String(col ?? feat ?? "").trim();
  return text || null;
}

/**
 * A4 İLAN BROŞÜRÜ — emlakçının vitrine astığı / müşteriye elden verdiği tek
 * sayfalık çıktı. Ekranda önizleme + "Yazdır / PDF"; çıktıda .print-sheet
 * kağıt bloğu (globals.css YAZDIRMA katmanı). PDF kütüphanesi bilinçli olarak
 * yok — tarayıcının kendi "PDF olarak kaydet" akışı kullanılır.
 *
 * QR: vitrin ilan sayfasına götürür; harici goqr.me servisi kullanılır
 * (vitrin-qr.tsx'teki gerekçe: doğrulanamayan bir encoder'la basılı materyale
 * çıkan hatalı QR sessiz felakettir). Vitrin slug'ı tanımlı değilse QR yerine
 * portföy kodu basılır.
 */
export default async function PropertyBrochurePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModulePage("properties");
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: property }, { data: tenant }, { data: cover }] = await Promise.all([
    supabase
      .from("properties")
      .select(
        "id, property_code, title, transaction_type, property_type, status, list_price, features, address_line, assigned_to, province:geo_provinces(name), district:geo_districts(name)",
      )
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("tenants").select("name, slug, logo_url, phone").maybeSingle(),
    supabase
      .from("property_media")
      .select("id")
      .eq("property_id", id)
      .eq("kind", "image")
      .order("is_cover", { ascending: false })
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!property) notFound();

  const [description, { data: advisor }] = await Promise.all([
    fetchDescription(supabase, id, property.features),
    property.assigned_to
      ? supabase.from("profiles").select("full_name, phone").eq("id", property.assigned_to).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const officeName = tenant?.name ?? "Emlak ofisi";
  const features = (property.features ?? {}) as {
    rooms?: string | null;
    sqm?: number | string | null;
    floor?: number | string | null;
    heating?: string | null;
    building_age?: number | string | null;
  };

  // Özellik ızgarası — yalnızca DOLU alanlar basılır; boş "—" hücreleri
  // broşürde eksiklik reklamı yapar.
  const specs = [
    features.rooms ? { icon: BedDouble, label: "Oda", value: String(features.rooms) } : null,
    features.sqm != null && String(features.sqm) !== "" ? { icon: Ruler, label: "m²", value: `${features.sqm} m²` } : null,
    features.floor != null && String(features.floor) !== "" ? { icon: Layers, label: "Kat", value: String(features.floor) } : null,
    features.heating ? { icon: Flame, label: "Isınma", value: String(features.heating) } : null,
    features.building_age != null && String(features.building_age) !== ""
      ? { icon: CalendarClock, label: "Bina yaşı", value: String(features.building_age) }
      : null,
  ].filter(Boolean) as { icon: typeof Ruler; label: string; value: string }[];

  const isRent =
    property.transaction_type === "rent" || property.transaction_type === "Kiralık" || property.transaction_type === "kiralik";
  const priceText =
    property.list_price != null ? `${moneyTry(Number(property.list_price))}${isRent ? "/ay" : ""}` : "Fiyat için sorun";

  const konum = [relName(property.district as Rel), relName(property.province as Rel)].filter(Boolean).join(" / ");

  // Açıklamanın ilk ~600 karakteri — kelime ortasından kesmeden.
  const shortDescription = (() => {
    if (!description) return null;
    const clean = description.replace(/\s+/g, " ").trim();
    if (clean.length <= 600) return clean;
    const cut = clean.slice(0, 600);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 500))}…`;
  })();

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const vitrinUrl = tenant?.slug ? `${baseUrl}/vitrin/${tenant.slug}/${property.id}` : null;
  // Harici QR servisi (goqr.me) — vitrin-qr.tsx deseni; yalnız public ilan URL'i iletilir.
  const qrSrc = vitrinUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=2&format=png&data=${encodeURIComponent(vitrinUrl)}`
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Ekran araç çubuğu — çıktıda yok */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/app/portfoyler/${property.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
        >
          <ArrowLeft className="h-4 w-4" /> Portföy detayına dön
        </Link>
        <PrintButton />
      </div>

      <article className="print-sheet surface-card overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-lg)]">
        {/* Üst bant: ofis adı/logo + portföy kodu */}
        <header className="flex items-center justify-between gap-4 bg-ink-950 px-6 py-4 text-white">
          <div className="flex min-w-0 items-center gap-3">
            {tenant?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- Storage public URL; next/image remote domain konfigürasyonu gerektirir
              <img src={tenant.logo_url} alt={`${officeName} logosu`} className="h-9 w-9 shrink-0 rounded-[8px] bg-white object-contain p-0.5" />
            ) : (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-white/10 font-display text-sm font-extrabold">
                {officeName[0]}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate font-display text-base font-extrabold leading-tight">{officeName}</p>
              {tenant?.phone ? <p className="text-[11px] text-white/60">{tenant.phone}</p> : null}
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs font-bold tracking-wide">
            {property.property_code}
          </span>
        </header>

        {/* Kapak fotoğrafı */}
        <div className="print-avoid-break relative aspect-[16/9] w-full overflow-hidden bg-ink-950/5">
          {cover ? (
            <Image
              src={`/api/property-media/${cover.id}`}
              alt={property.title || property.property_code || "Portföy"}
              fill
              priority
              sizes="768px"
              className="object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-text-faint">
              <div className="text-center">
                <Building2 className="mx-auto h-12 w-12" />
                <p className="mt-2 text-xs font-semibold">Fotoğraf eklenmemiş</p>
              </div>
            </div>
          )}
          <span className="absolute left-4 top-4 rounded-full bg-ink-950/80 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-white">
            {property.transaction_type}
          </span>
        </div>

        <div className="px-6 py-5">
          {/* Başlık + fiyat */}
          <div className="print-avoid-break flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-2xl font-extrabold leading-tight tracking-[-0.02em] text-ink-950">
                {property.title || property.property_code}
              </h1>
              <p className="mt-1 text-sm text-text-muted">
                {[property.property_type, konum].filter(Boolean).join(" · ") || "Konum belirtilmedi"}
              </p>
            </div>
            <p className="numeric shrink-0 font-display text-3xl font-extrabold text-amber-600">{priceText}</p>
          </div>

          {/* Özellik ızgarası — yalnız dolu alanlar */}
          {specs.length > 0 ? (
            <div className="print-avoid-break mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {specs.map((s) => (
                <div key={s.label} className="rounded-[12px] border border-line bg-canvas/60 px-3 py-2.5 text-center">
                  <s.icon className="mx-auto h-4 w-4 text-brand-600" />
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-faint">{s.label}</p>
                  <p className="text-sm font-bold text-ink-950">{s.value}</p>
                </div>
              ))}
            </div>
          ) : null}

          {/* Açıklama — ilk ~600 karakter */}
          {shortDescription ? (
            <div className="mt-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">İlan açıklaması</p>
              <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{shortDescription}</p>
            </div>
          ) : null}
        </div>

        {/* Alt bant: danışman kartı + vitrin QR */}
        <footer className="print-avoid-break border-t border-line bg-canvas/60 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink-950 text-white">
                <UserRound className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-ink-950">{advisor?.full_name ?? officeName}</p>
                {advisor?.phone ? (
                  <p className="flex items-center gap-1 text-xs font-semibold text-text-muted">
                    <Phone className="h-3 w-3 text-brand-600" /> {advisor.phone}
                  </p>
                ) : tenant?.phone ? (
                  <p className="flex items-center gap-1 text-xs font-semibold text-text-muted">
                    <Phone className="h-3 w-3 text-brand-600" /> {tenant.phone}
                  </p>
                ) : (
                  <p className="text-xs text-text-muted">Yetkili danışman</p>
                )}
              </div>
            </div>
            {qrSrc ? (
              <div className="shrink-0 text-center">
                {/* eslint-disable-next-line @next/next/no-img-element -- harici QR servisi (goqr.me); next/image remote domain konfigürasyonu gerektirir */}
                <img src={qrSrc} alt="İlanın vitrin sayfası için QR kodu" width={88} height={88} className="h-[88px] w-[88px] rounded-[8px] border border-line bg-white p-1" />
                <p className="mt-1 flex items-center justify-center gap-1 text-[10px] font-semibold text-text-faint">
                  <QrCode className="h-3 w-3" /> İlanı telefonda aç
                </p>
              </div>
            ) : (
              <div className="shrink-0 rounded-[12px] border border-dashed border-line-strong px-4 py-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-faint">Portföy kodu</p>
                <p className="font-display text-lg font-extrabold text-ink-950">{property.property_code}</p>
              </div>
            )}
          </div>
          <p className="mt-3 text-center text-[10px] text-text-faint">EmlakSoft ile hazırlandı</p>
        </footer>
      </article>

      <p className="no-print text-center text-[11px] text-text-faint">
        Çıktı tek A4 sayfaya sığacak şekilde tasarlandı — tarayıcının yazdırma penceresinden &quot;PDF olarak kaydet&quot; seçebilirsiniz.
        {!tenant?.slug ? " Vitrin adresi (slug) tanımlanırsa QR kodu otomatik eklenir." : ""}
      </p>
    </div>
  );
}
