import { notFound } from "next/navigation";
import { Bath, BedDouble, Building2, Check, MapPin, MessageCircle, Phone, Ruler, ShieldCheck } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { toTelHref, toWhatsAppLink } from "@/lib/phone";

function money(n: number | null) {
  if (n == null) return "Fiyat için sorun";
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
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
    .select("id, entity_type, entity_id, expires_at, view_count, tenant:tenants(name)")
    .eq("token", token)
    .maybeSingle();

  if (!share || share.entity_type !== "property") notFound();
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
    return (
      <div className="grid min-h-screen place-items-center bg-canvas px-4">
        <div className="text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-[16px] bg-danger-500/10">
            <ShieldCheck className="h-7 w-7 text-danger-500" />
          </div>
          <p className="mt-4 text-sm text-text-muted">Bu paylaşım linkinin süresi dolmuş.</p>
        </div>
      </div>
    );
  }

  await admin
    .from("share_links")
    .update({ view_count: (share.view_count ?? 0) + 1 })
    .eq("id", share.id);

  const { data: property } = await admin
    .from("properties")
    .select(
      "title, property_code, transaction_type, property_type, list_price, address_line, features, assigned_to:profiles(full_name, phone), province:geo_provinces(name), district:geo_districts(name)",
    )
    .eq("id", share.entity_id)
    .maybeSingle();

  if (!property) notFound();

  const { data: mediaRows } = await admin
    .from("property_media")
    .select("id, kind, external_url, is_cover")
    .eq("property_id", share.entity_id)
    .order("is_cover", { ascending: false })
    .order("sort_order", { ascending: true });
  const media = mediaRows ?? [];
  const images = media.filter((m) => m.kind === "image");
  const tours = media.filter((m) => m.kind !== "image");

  const tenant = share.tenant as { name?: string } | { name?: string }[] | null;
  const office = Array.isArray(tenant) ? tenant[0]?.name : tenant?.name;
  const province = property.province as { name?: string } | { name?: string }[] | null;
  const district = property.district as { name?: string } | { name?: string }[] | null;
  const pName = Array.isArray(province) ? province[0]?.name : province?.name;
  const dName = Array.isArray(district) ? district[0]?.name : district?.name;
  const feat = property.features as { rooms?: string; sqm?: number; baths?: number } | null;
  const agentRaw = property.assigned_to as { full_name?: string; phone?: string } | { full_name?: string; phone?: string }[] | null;
  const agent = Array.isArray(agentRaw) ? agentRaw[0] : agentRaw;
  const agentTelHref = toTelHref(agent?.phone);
  const agentWhatsAppLink = toWhatsAppLink(agent?.phone);

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
          <span className="grid h-6 w-6 place-items-center rounded-[8px] bg-white/10 text-[11px] font-bold text-white">
            {office ? office[0] : "E"}
          </span>
          {office || "EmlakSoft"} tarafından paylaşıldı
        </div>

        <div className="overflow-hidden rounded-[24px] border border-white/15 bg-white/[0.06] shadow-[0_30px_80px_-40px_rgba(0,0,0,0.7)] backdrop-blur-xl">
          <div className="relative border-b border-white/10 bg-white/[0.03] px-6 py-6">
            <div className="flex items-center justify-between gap-3">
              <span className="rounded-full border border-mint-400/25 bg-mint-500/12 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-mint-400">
                {property.transaction_type}
              </span>
              <span className="flex items-center gap-1.5 text-[10px] font-semibold text-white/40">
                <ShieldCheck className="h-3.5 w-3.5 text-mint-400" /> Doğrulanmış portföy
              </span>
            </div>
            <h1 className="mt-3 font-display text-2xl font-extrabold leading-tight text-white sm:text-3xl">
              {property.title || property.property_code}
            </h1>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-white/60">
              <MapPin className="h-4 w-4 text-cyan-400 shrink-0" />
              {[dName, pName].filter(Boolean).join(", ") || "Konum belirtilmedi"}
              {property.address_line ? ` · ${property.address_line}` : ""}
            </p>
          </div>

          {images.length > 0 ? (
            <div className="border-b border-white/10 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/property-media/${images[0].id}`}
                alt={property.title || "Portföy"}
                className="aspect-[16/10] w-full rounded-[16px] object-cover"
              />
              {images.length > 1 ? (
                <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {images.slice(1, 7).map((m) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={m.id}
                      src={`/api/property-media/${m.id}`}
                      alt="Portföy görseli"
                      className="aspect-square w-full rounded-[10px] object-cover"
                    />
                  ))}
                </div>
              ) : null}
              {tours.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {tours.map((m) => (
                    <a
                      key={m.id}
                      href={m.external_url ?? "#"}
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
            <p className="font-display text-4xl font-extrabold text-mint-300 sm:text-5xl">
              {money(property.list_price != null ? Number(property.list_price) : null)}
            </p>
            <p className="mt-1 text-xs font-medium text-white/40">{property.property_type}</p>

            {specs.length > 0 && (
              <div className="mt-5 grid grid-cols-3 divide-x divide-white/10 rounded-[14px] border border-white/10 bg-white/[0.04] py-3 text-center">
                {specs.map((s) => (
                  <span key={s.label} className="flex items-center justify-center gap-1.5 text-sm font-medium text-white/75">
                    <s.icon className="h-4 w-4 text-cyan-400" /> {s.label}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              {["Yetki doğrulandı", "Güncel fiyat", "Aktif ilan"].map((t) => (
                <span key={t} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/60">
                  <Check className="h-3 w-3 text-mint-400" /> {t}
                </span>
              ))}
            </div>

            {agent?.full_name && (
              <div className="mt-6 flex items-center gap-3 rounded-[14px] border border-white/10 bg-white/[0.04] p-4">
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

            <div className="mt-6 grid grid-cols-2 gap-3">
              {agentTelHref ? (
                <a
                  href={agentTelHref}
                  className="btn-shine inline-flex items-center justify-center gap-2 rounded-[12px] bg-white px-4 py-3.5 text-sm font-bold text-ink-950 transition hover:bg-white/90"
                >
                  <Phone className="h-4 w-4" /> Ara
                </a>
              ) : (
                <span className="inline-flex items-center justify-center gap-2 rounded-[12px] border border-white/15 px-4 py-3.5 text-sm font-semibold text-white/40">
                  <Phone className="h-4 w-4" /> Telefon yok
                </span>
              )}
              {agentWhatsAppLink ? (
                <a
                  href={agentWhatsAppLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-[12px] border border-mint-400/30 bg-mint-500/10 px-4 py-3.5 text-sm font-bold text-mint-300 transition hover:bg-mint-500/20"
                >
                  <MessageCircle className="h-4 w-4" /> WhatsApp
                </a>
              ) : null}
            </div>

            <p className="mt-6 text-center text-[11px] text-white/35">
              Bu sayfa salt okunur bir paylaşım linkidir · teklif ve randevu için ofisle iletişime geçin
            </p>
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] text-white/30">Powered by EmlakSoft — Türkiye&apos;nin emlak işletim sistemi</p>
      </div>
    </div>
  );
}
