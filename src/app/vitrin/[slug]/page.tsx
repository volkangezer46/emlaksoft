import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, MapPin, Ruler, BedDouble, ShieldCheck } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { LeadForm } from "@/app/lead/[token]/lead-form";

export const dynamic = "force-dynamic";

function money(n: number | null, tx?: string | null) {
  if (n == null) return "Fiyat için sorun";
  const s = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
  return tx === "rent" || tx === "Kiralık" || (tx ?? "").toLowerCase().includes("kira") ? `${s}/ay` : s;
}

type Rel = { name?: string } | { name?: string }[] | null;
function relName(v: Rel) {
  if (!v) return null;
  const r = Array.isArray(v) ? v[0] : v;
  return r?.name ?? null;
}

export default async function VitrinPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ tx?: string }>;
}) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const admin = createAdminClient();

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, brand_color, lead_capture_token, lead_capture_enabled")
    .eq("slug", slug)
    .maybeSingle();

  if (!tenant) notFound();

  const query = admin
    .from("properties")
    .select(
      "id, title, property_code, transaction_type, property_type, list_price, address_line, features, province:geo_provinces(name), district:geo_districts(name)",
    )
    .eq("tenant_id", tenant.id)
    .eq("status", "live")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(60);

  const txFilter = sp.tx === "satilik" ? "sale" : sp.tx === "kiralik" ? "rent" : null;

  const { data: propsData } = await query;
  let properties = propsData ?? [];
  if (txFilter) {
    properties = properties.filter((p) => {
      const t = (p.transaction_type ?? "").toLowerCase();
      return txFilter === "sale" ? !t.includes("kira") && t !== "rent" : t.includes("kira") || t === "rent";
    });
  }

  const propIds = properties.map((p) => p.id);
  const coverMap = new Map<string, string>();
  if (propIds.length) {
    const { data: media } = await admin
      .from("property_media")
      .select("id, property_id, is_cover, sort_order")
      .eq("kind", "image")
      .in("property_id", propIds)
      .order("is_cover", { ascending: false })
      .order("sort_order", { ascending: true });
    for (const m of media ?? []) {
      if (!coverMap.has(m.property_id)) coverMap.set(m.property_id, m.id);
    }
  }

  const { data: provinces } = await admin
    .from("geo_provinces")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  return (
    <div className="min-h-screen bg-canvas">
      {/* Hero */}
      <header className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-brand-600/25 blur-[120px]" />
        <div className="relative mx-auto max-w-6xl px-4 py-12 sm:py-16">
          <div className="flex items-center gap-3">
            <span
              className="grid h-11 w-11 place-items-center rounded-[13px] text-base font-extrabold text-white"
              style={{ background: tenant.brand_color || "var(--grad-brand)" }}
            >
              {tenant.name ? tenant.name[0] : "E"}
            </span>
            <div>
              <p className="font-display text-lg font-extrabold">{tenant.name}</p>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mint-400">Portföy vitrini</p>
            </div>
          </div>
          <h1 className="mt-6 max-w-2xl font-display text-3xl font-extrabold leading-tight sm:text-4xl">
            Güncel ve doğrulanmış portföyler
          </h1>
          <p className="mt-2 max-w-xl text-sm text-white/60">
            {properties.length} aktif ilan · yerinde inceleme ve fiyat bilgisi için hemen talep bırakın.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {[
              { key: "", label: "Tümü" },
              { key: "satilik", label: "Satılık" },
              { key: "kiralik", label: "Kiralık" },
            ].map((f) => {
              const active = (sp.tx ?? "") === f.key;
              return (
                <Link
                  key={f.key}
                  href={`/vitrin/${slug}${f.key ? `?tx=${f.key}` : ""}`}
                  className={`rounded-full px-4 py-2 text-xs font-bold transition ${
                    active ? "bg-white text-ink-950" : "border border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
                  }`}
                >
                  {f.label}
                </Link>
              );
            })}
          </div>
        </div>
      </header>

      {/* Grid */}
      <main className="mx-auto max-w-6xl px-4 py-10">
        {properties.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-line bg-surface px-5 py-20 text-center">
            <Building2 className="mx-auto h-8 w-8 text-text-faint" />
            <p className="mt-3 text-sm font-semibold text-ink-950">Şu anda yayında ilan yok</p>
            <p className="mt-1 text-xs text-text-muted">Talebinizi bırakın, uygun portföy çıkınca size ulaşalım.</p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {properties.map((p) => {
              const feat = (p.features ?? {}) as { rooms?: string; sqm?: number };
              const coverId = coverMap.get(p.id);
              const loc = [relName(p.district as Rel), relName(p.province as Rel)].filter(Boolean).join(", ");
              return (
                <Link
                  key={p.id}
                  href={`/vitrin/${slug}/${p.id}`}
                  className="lift group overflow-hidden rounded-[18px] border border-line bg-surface transition hover:border-brand-300"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-ink-950/5">
                    {coverId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/property-media/${coverId}`}
                        alt={p.title || "Portföy"}
                        className="h-full w-full object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-text-faint">
                        <Building2 className="h-10 w-10" />
                      </div>
                    )}
                    <span className="absolute left-3 top-3 rounded-full bg-ink-950/80 px-2.5 py-1 text-[10px] font-bold uppercase text-white">
                      {p.transaction_type}
                    </span>
                  </div>
                  <div className="p-4">
                    <p className="line-clamp-1 font-display font-bold text-ink-950">{p.title || p.property_code}</p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-text-muted">
                      <MapPin className="h-3.5 w-3.5 text-brand-600" /> {loc || "Konum belirtilmedi"}
                    </p>
                    <div className="mt-3 flex items-center gap-3 text-xs text-text-muted">
                      {feat.rooms ? <span className="flex items-center gap-1"><BedDouble className="h-3.5 w-3.5" /> {feat.rooms}</span> : null}
                      {feat.sqm ? <span className="flex items-center gap-1"><Ruler className="h-3.5 w-3.5" /> {feat.sqm} m²</span> : null}
                    </div>
                    <p className="mt-3 font-display text-xl font-extrabold text-brand-600">
                      {money(p.list_price != null ? Number(p.list_price) : null, p.transaction_type)}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Lead form */}
        <section className="mt-12 overflow-hidden rounded-[24px] border border-line bg-surface shadow-[var(--shadow-xs)]">
          <div className="grid gap-0 lg:grid-cols-[1fr_1.1fr]">
            <div className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] p-8 text-white">
              <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
              <ShieldCheck className="h-8 w-8 text-mint-400" />
              <h2 className="mt-4 font-display text-2xl font-extrabold">Aradığınızı bulamadınız mı?</h2>
              <p className="mt-2 text-sm text-white/60">
                Kriterlerinizi paylaşın; {tenant.name} uzman danışmanı size en uygun portföyleri sunsun.
              </p>
            </div>
            <div className="bg-[#071a38] p-6 sm:p-8">
              {tenant.lead_capture_enabled !== false && tenant.lead_capture_token ? (
                <LeadForm token={tenant.lead_capture_token} provinces={provinces ?? []} />
              ) : (
                <p className="rounded-[12px] border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60">
                  Talep formu şu anda kapalı.
                </p>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line py-6 text-center text-[11px] text-text-faint">
        Powered by EmlakSoft — Türkiye&apos;nin emlak işletim sistemi
      </footer>
    </div>
  );
}
