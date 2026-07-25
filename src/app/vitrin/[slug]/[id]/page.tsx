import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft, BedDouble, Bath, Building2, MapPin, Ruler, ShieldCheck } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { LeadForm } from "@/app/lead/[token]/lead-form";

export const dynamic = "force-dynamic";

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

export default async function VitrinPropertyPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const admin = createAdminClient();

  // tenant (slug), media (params id) ve provinces (bağımsız) yalnızca params'a bağlı → paralel
  const [{ data: tenant }, { data: mediaRows }, { data: provinces }] = await Promise.all([
    admin
      .from("tenants")
      .select("id, name, lead_capture_token, lead_capture_enabled")
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
      "id, title, property_code, transaction_type, property_type, status, list_price, address_line, features, province:geo_provinces(name), district:geo_districts(name)",
    )
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .eq("status", "live")
    .is("deleted_at", null)
    .maybeSingle();
  if (!property) notFound();

  const media = mediaRows ?? [];
  const images = media.filter((m) => m.kind === "image");
  const tours = media.filter((m) => m.kind !== "image");

  const feat = (property.features ?? {}) as { rooms?: string; sqm?: number; baths?: number };
  const loc = [property.address_line, relName(property.district as Rel), relName(property.province as Rel)]
    .filter(Boolean)
    .join(", ");

  const specs = [
    feat.rooms ? { icon: BedDouble, label: feat.rooms } : null,
    feat.baths ? { icon: Bath, label: `${feat.baths} banyo` } : null,
    feat.sqm ? { icon: Ruler, label: `${feat.sqm} m²` } : null,
  ].filter(Boolean) as { icon: typeof BedDouble; label: string }[];

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <Link href={`/vitrin/${slug}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
          <ArrowLeft className="h-4 w-4" /> Tüm portföyler
        </Link>

        <div className="mt-4 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div>
            {images.length > 0 ? (
              <div className="overflow-hidden rounded-[18px] border border-line bg-surface">
                <div className="relative aspect-[16/10] w-full">
                  <Image
                    src={`/api/property-media/${images[0].id}`}
                    alt={property.title || "Portföy"}
                    fill
                    priority
                    sizes="(max-width: 1024px) 100vw, 60vw"
                    className="object-cover"
                  />
                </div>
                {images.length > 1 ? (
                  <div className="grid grid-cols-5 gap-2 p-2">
                    {images.slice(1, 11).map((m) => (
                      <div key={m.id} className="relative aspect-square w-full overflow-hidden rounded-[8px]">
                        <Image
                          src={`/api/property-media/${m.id}`}
                          alt="Görsel"
                          fill
                          sizes="(max-width: 1024px) 20vw, 120px"
                          className="object-cover"
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
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
              <span className="rounded-full bg-mint-500/12 px-2.5 py-1 text-[10px] font-bold uppercase text-mint-600">
                {property.transaction_type}
              </span>
              <h1 className="mt-3 font-display text-2xl font-extrabold text-ink-950">{property.title || property.property_code}</h1>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-text-muted">
                <MapPin className="h-4 w-4 text-brand-600 shrink-0" /> {loc || "Konum belirtilmedi"}
              </p>
              <p className="mt-4 font-display text-3xl font-extrabold text-brand-600">
                {money(property.list_price != null ? Number(property.list_price) : null, property.transaction_type)}
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
          </div>

          {/* Lead form */}
          <div className="lg:sticky lg:top-6 lg:self-start">
            <div className="overflow-hidden rounded-[18px] border border-line">
              <div className="theme-dark bg-[#071a38] p-6">
                <div className="flex items-center gap-2 text-mint-400">
                  <ShieldCheck className="h-5 w-5" />
                  <span className="text-xs font-bold uppercase tracking-wide">{tenant.name}</span>
                </div>
                <h2 className="mt-3 font-display text-lg font-extrabold text-white">Bu portföy için bilgi alın</h2>
                <p className="mt-1 text-sm text-white/55">Danışmanımız kısa sürede sizinle iletişime geçsin.</p>
                {tenant.lead_capture_enabled !== false && tenant.lead_capture_token ? (
                  <LeadForm token={tenant.lead_capture_token} provinces={provinces ?? []} />
                ) : (
                  <p className="mt-4 rounded-[12px] border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60">
                    Talep formu şu anda kapalı.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-8 text-center text-[11px] text-text-faint">
          Powered by EmlakSoft — Türkiye&apos;nin emlak işletim sistemi
        </p>
      </div>
    </div>
  );
}
