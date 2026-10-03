import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { ArrowRight, Building2, Calculator, MapPin, Ruler, BedDouble, Search, ShieldCheck } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { LeadForm } from "@/app/lead/[token]/lead-form";
import { SavedSearchBox } from "@/components/public/saved-search-box";
import { FavChip, FavEmptyNotice, VitrinCardShell } from "@/components/public/vitrin-fav";
import { FavNavBadge } from "./fav-nav-badge";
import { CompareBar } from "@/components/public/compare-select";
import { DAY_MS, msSince, now } from "@/lib/clock";
import { fetchLatestRates, fxAgeLabel, fxApproxLine } from "@/lib/fx";
import { orIlike, safeLike } from "@/lib/pgrst";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { getBaseUrl } from "@/lib/base-url";

/** Son 7 günde yayına giren ilan "Yeni" rozeti alır (published_at gerçek yayın damgası). */
function isNewListing(publishedAt: string | null): boolean {
  return publishedAt != null && msSince(publishedAt) < 7 * DAY_MS;
}

// ISR: vitrin herkese acik — CDN onbellekli, 2 dk tazelenir (jet hiz)
export const revalidate = 60;

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

/** "1.500.000" / "1500000 ₺" gibi girdileri sayıya çevirir; geçersizse null. */
function parseMoneyParam(v?: string): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

type VitrinSearchParams = {
  tx?: string;
  q?: string;
  min?: string;
  max?: string;
  oda?: string;
  sirala?: string;
  tur?: string;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, status")
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant || !isPublicTenantActive(tenant.status)) return { title: "Vitrin bulunamadı" };

  const { count } = await admin
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .eq("status", "live")
    .is("deleted_at", null);

  const title = `${tenant.name} | Portföy Vitrini`;
  const description = `${tenant.name} güncel portföy vitrini — ${count ?? 0} aktif ilan. Satılık ve kiralık portföyleri inceleyin, yerinde inceleme için talep bırakın.`;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/vitrin/${slug}` },
    openGraph: {
      type: "website",
      locale: "tr_TR",
      siteName: tenant.name ?? "EmlakSoft",
      title,
      description,
      url: `/vitrin/${slug}`,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function VitrinPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<VitrinSearchParams>;
}) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const admin = createAdminClient();

  // provinces hiçbir şeye bağlı değil → tenant ile paralel çek
  const [{ data: tenant }, { data: provinces }] = await Promise.all([
    admin
      .from("tenants")
      .select("id, name, status, brand_color, logo_url, phone, lead_capture_token, lead_capture_enabled")
      .eq("slug", slug)
      .maybeSingle(),
    admin.from("geo_provinces").select("id, name").eq("is_active", true).order("name"),
  ]);

  if (!tenant || !isPublicTenantActive(tenant.status)) notFound();

  const q = (sp.q ?? "").trim();
  const min = parseMoneyParam(sp.min);
  const max = parseMoneyParam(sp.max);
  const oda = (sp.oda ?? "").trim();
  const tur = (sp.tur ?? "").trim().slice(0, 40);
  const sirala = sp.sirala === "fiyat-artan" || sp.sirala === "fiyat-azalan" ? sp.sirala : "";

  // Vitrin listesi searchParams okuduğu için sayfa dinamik render olur ve `revalidate`
  // devreye girmez; veri katmanı bu yüzden kısa TTL (60 sn) önbellektedir. Anahtar tenant.id +
  // normalize filtreler; serbest metin araması (q) önbelleğe ALINMAZ (anahtar şişmesi yok).
  // Tenant durumu (askı/iptal) önbelleğin DIŞINDA her istekte denetlenir. İlan yazma action'ları
  // revalidatePath ile düşürür; en kötü bayatlık TTL kadardır (ISR ile aynı sözleşme).
  const loadListing = async () => {
    let query = admin
      .from("properties")
      .select(
        "id, title, property_code, transaction_type, property_type, list_price, address_line, features, published_at, province:geo_provinces(name), district:geo_districts(name)",
      )
      .eq("tenant_id", tenant.id)
      .eq("status", "live")
      .is("deleted_at", null);

    if (q) {
      // Tek yerde temizleme: PostgREST gramerini bozan karakterler ve LIKE jokerleri safeLike/orIlike ile atılır, uzunluk sınırlıdır.
      if (safeLike(q) !== "%%") {
        query = query.or(orIlike(["title", "property_code", "address_line"], q));
      }
    }
    if (min != null) query = query.gte("list_price", min);
    if (max != null) query = query.lte("list_price", max);
    if (oda) query = query.eq("features->>rooms", oda);
    if (tur) query = query.eq("property_type", tur);

    // Fiyatsız ilanlar ("Fiyat için sorun") her sıralamada sona düşsün
    if (sirala === "fiyat-artan") query = query.order("list_price", { ascending: true, nullsFirst: false });
    else if (sirala === "fiyat-azalan") query = query.order("list_price", { ascending: false, nullsFirst: false });
    else query = query.order("created_at", { ascending: false });

    // Oda filtresi seçenekleri yayındaki gerçek değerlerden türetilir → ana sorguyla paralel
    const [{ data: propsData }, { data: roomRows }, fxRates] = await Promise.all([
      query.limit(60),
      admin
        .from("properties")
        .select("features, property_type")
        .eq("tenant_id", tenant.id)
        .eq("status", "live")
        .is("deleted_at", null)
        .limit(200),
      // Döviz karşılığı sunucuda hesaplanır — ISR (revalidate=120) korunur.
      fetchLatestRates(admin),
    ]);

    // Kapak görselleri: çekilen tüm ilanlar için (tx süzmesi bellekte sonradan uygulanır).
    const coverIds = (propsData ?? []).map((p) => p.id);
    const coverEntries: [string, string][] = [];
    if (coverIds.length) {
      const { data: media } = await admin
        .from("property_media")
        .select("id, property_id, is_cover, sort_order")
        .eq("kind", "image")
        .in("property_id", coverIds)
        .order("is_cover", { ascending: false })
        .order("sort_order", { ascending: true });
      const seen = new Set<string>();
      for (const m of media ?? []) {
        if (!seen.has(m.property_id)) {
          seen.add(m.property_id);
          coverEntries.push([m.property_id, m.id]);
        }
      }
    }
    return { propsData: propsData ?? [], roomRows: roomRows ?? [], fxRates, coverEntries };
  };
  const listing = q
    ? await loadListing()
    : await unstable_cache(loadListing, ["vitrin-listing-v1", tenant.id, String(min ?? ""), String(max ?? ""), oda, sirala, tur], {
        revalidate: 60,
        tags: ["vitrin", `vitrin:${tenant.id}`],
      })();
  const { propsData, roomRows, fxRates } = listing;

  // Kur tarihi ipucu — kartlardaki döviz satırının `title` değeri.
  const fxTitle = fxRates ? `TCMB ${fxRates.rateDate} satış kuru — ${fxAgeLabel(fxRates.rateDate, now())}` : undefined;

  const txFilter = sp.tx === "satilik" ? "sale" : sp.tx === "kiralik" ? "rent" : null;

  let properties = propsData ?? [];
  if (txFilter) {
    properties = properties.filter((p) => {
      const t = (p.transaction_type ?? "").toLowerCase();
      return txFilter === "sale" ? !t.includes("kira") && t !== "rent" : t.includes("kira") || t === "rent";
    });
  }

  const roomSet = new Set<string>();
  for (const row of roomRows ?? []) {
    const r = ((row.features ?? {}) as { rooms?: string }).rooms;
    if (r) roomSet.add(r);
  }
  const typeSet = new Set<string>();
  for (const row of roomRows ?? []) {
    const t = (row as { property_type?: string | null }).property_type;
    if (t) typeSet.add(t);
  }
  const typeOptions = [...typeSet].sort((a, b) => a.localeCompare(b, "tr"));
  const roomOptions = [...roomSet].sort((a, b) => a.localeCompare(b, "tr"));

  const hasFilter = Boolean(q || min != null || max != null || oda || sirala || tur || sp.tx);

  // tx sekmeleri diğer filtreleri korur
  function txHref(txKey: string) {
    const p = new URLSearchParams();
    if (txKey) p.set("tx", txKey);
    if (q) p.set("q", q);
    if (sp.min) p.set("min", sp.min);
    if (sp.max) p.set("max", sp.max);
    if (oda) p.set("oda", oda);
    if (sirala) p.set("sirala", sirala);
    if (tur) p.set("tur", tur);
    const s = p.toString();
    return `/vitrin/${slug}${s ? `?${s}` : ""}`;
  }
  // Kategori çipleri (emlak türü) tx/q/fiyat/oda/sıralama filtrelerini korur
  function turHref(t: string) {
    const p = new URLSearchParams();
    if (sp.tx) p.set("tx", sp.tx);
    if (q) p.set("q", q);
    if (sp.min) p.set("min", sp.min);
    if (sp.max) p.set("max", sp.max);
    if (oda) p.set("oda", oda);
    if (sirala) p.set("sirala", sirala);
    if (t) p.set("tur", t);
    const s = p.toString();
    return `/vitrin/${slug}${s ? `?${s}` : ""}`;
  }

  const coverMap = new Map<string, string>(listing.coverEntries);

  // JSON-LD: ofis (RealEstateAgent) + ilan listesi (ItemList) — yalnız doğrulanabilir alanlar.
  const siteUrl = getBaseUrl();
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "RealEstateAgent",
        name: tenant.name,
        url: `${siteUrl}/vitrin/${slug}`,
        ...(tenant.logo_url ? { logo: tenant.logo_url } : {}),
        ...(tenant.phone ? { telephone: tenant.phone } : {}),
      },
      {
        "@type": "ItemList",
        itemListElement: properties.slice(0, 20).map((p, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `${siteUrl}/vitrin/${slug}/${p.id}`,
          name: p.title || p.property_code,
        })),
      },
    ],
  };

  const fieldCls =
    "w-full rounded-[var(--radius-card)] border border-white/15 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white placeholder:text-white/40 outline-none transition focus:border-mint-400/50 focus:bg-white/[0.09]";

  return (
    <div className="min-h-screen bg-canvas">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      {/* Hero */}
      <header className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-brand-600/25 blur-[120px]" />
        <div className="relative mx-auto max-w-6xl px-4 py-12 sm:py-16">
          <Link
            href={`/vitrin/${slug}`}
            className="focus-ring flex w-fit items-center gap-3 rounded-[var(--radius-card)] transition hover:opacity-90"
          >
            {tenant.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- kiracı logosu keyfi Storage URL'i
              <img src={tenant.logo_url} alt="" width={44} height={44} className="h-11 w-11 rounded-[var(--radius-card)] bg-white object-contain" />
            ) : (
              <span
                className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] text-base font-extrabold text-white"
                style={{ background: tenant.brand_color || "var(--grad-brand)" }}
              >
                {tenant.name ? tenant.name[0] : "E"}
              </span>
            )}
            <span>
              <span className="block font-display text-lg font-extrabold">{tenant.name}</span>
              <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-mint-400">
                Portföy vitrini
              </span>
            </span>
          </Link>
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
                  href={txHref(f.key)}
                  className={`rounded-full px-4 py-2 text-xs font-bold transition ${
                    active ? "bg-white text-ink-950" : "border border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
                  }`}
                >
                  {f.label}
                </Link>
              );
            })}
            {/* Favori görünümü — client filtre, SSR listesi değişmez */}
            <FavChip slug={slug} />
            {/* Favoriler sayfası + sayaç rozeti (localStorage, hydration-güvenli) */}
            <FavNavBadge slug={slug} variant="dark" />
          </div>

          {typeOptions.length > 1 ? (
            <nav aria-label="Emlak türü" className="mt-3 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
              {["", ...typeOptions].map((t) => {
                const active = tur === t;
                return (
                  <Link
                    key={t || "tum"}
                    href={turHref(t)}
                    aria-current={active ? "true" : undefined}
                    className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                      active ? "bg-mint-500 text-ink-950" : "border border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
                    }`}
                  >
                    {t || "Tüm türler"}
                  </Link>
                );
              })}
            </nav>
          ) : null}

          {/* Sunucu filtreleri — GET formu, JS gerektirmez */}
          <form
            method="get"
            action={`/vitrin/${slug}`}
            className="mt-5 grid max-w-4xl gap-2 sm:grid-cols-2 lg:grid-cols-[1.8fr_1fr_1fr_1.1fr_1.2fr_auto]"
          >
            {sp.tx ? <input type="hidden" name="tx" value={sp.tx} /> : null}
            {tur ? <input type="hidden" name="tur" value={tur} /> : null}
            <input name="q" defaultValue={q} placeholder="Başlık, kod veya adres ara" className={fieldCls} aria-label="Metin arama" />
            <input name="min" defaultValue={sp.min ?? ""} inputMode="numeric" placeholder="Min ₺" className={fieldCls} aria-label="Minimum fiyat" />
            <input name="max" defaultValue={sp.max ?? ""} inputMode="numeric" placeholder="Max ₺" className={fieldCls} aria-label="Maksimum fiyat" />
            <select name="oda" defaultValue={oda} className={fieldCls} aria-label="Oda sayısı">
              <option value="" className="bg-ink-950">Oda (tümü)</option>
              {roomOptions.map((r) => (
                <option key={r} value={r} className="bg-ink-950">
                  {r}
                </option>
              ))}
            </select>
            <select name="sirala" defaultValue={sirala} className={fieldCls} aria-label="Sıralama">
              <option value="" className="bg-ink-950">En yeni</option>
              <option value="fiyat-artan" className="bg-ink-950">Fiyat (artan)</option>
              <option value="fiyat-azalan" className="bg-ink-950">Fiyat (azalan)</option>
            </select>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-card)] bg-white px-4 py-2.5 text-xs font-bold text-ink-950 transition hover:bg-white/90"
            >
              <Search className="h-3.5 w-3.5" /> Filtrele
            </button>
          </form>
          {hasFilter ? (
            <Link
              href={`/vitrin/${slug}`}
              className="mt-3 inline-block text-xs font-semibold text-white/50 underline-offset-2 transition hover:text-white hover:underline"
            >
              Filtreleri temizle
            </Link>
          ) : null}
        </div>
      </header>

      {/* Grid */}
      <main id="main-content" className="mx-auto max-w-6xl px-4 py-10">
        {properties.length === 0 ? (
          <div className="rounded-[var(--radius-panel)] border border-dashed border-line bg-surface px-5 py-20 text-center">
            <Building2 className="mx-auto h-8 w-8 text-text-faint" />
            <p className="mt-3 text-sm font-semibold text-ink-950">
              {hasFilter ? "Filtrelere uygun ilan bulunamadı" : "Şu anda yayında ilan yok"}
            </p>
            <p className="mt-1 text-xs text-text-muted">Talebinizi bırakın, uygun portföy çıkınca size ulaşalım.</p>
            {hasFilter ? (
              <Link
                href={`/vitrin/${slug}`}
                className="mt-4 inline-block rounded-full border border-line px-4 py-2 text-xs font-bold text-brand-600 transition hover:border-brand-300"
              >
                Filtreleri temizle
              </Link>
            ) : null}
          </div>
        ) : (
          <>
          <FavEmptyNotice slug={slug} ids={properties.map((p) => p.id)} />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {properties.map((p, idx) => {
              const feat = (p.features ?? {}) as {
                rooms?: string;
                sqm?: number;
                floor?: number | string;
                building_age?: number | string;
              };
              const coverId = coverMap.get(p.id);
              const loc = [relName(p.district as Rel), relName(p.province as Rel)].filter(Boolean).join(", ");
              return (
                <VitrinCardShell
                  key={p.id}
                  slug={slug}
                  item={{
                    id: p.id,
                    title: p.title || p.property_code,
                    href: `/vitrin/${slug}/${p.id}`,
                    coverId: coverId ?? null,
                    price: p.list_price != null ? Number(p.list_price) : null,
                    tx: p.transaction_type,
                    rooms: feat.rooms ?? null,
                    sqm: feat.sqm ?? null,
                    floor: feat.floor ?? null,
                    buildingAge: feat.building_age ?? null,
                    district: relName(p.district as Rel),
                  }}
                >
                <Link
                  href={`/vitrin/${slug}/${p.id}`}
                  className="lift group overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface transition hover:border-brand-300"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-ink-950/5">
                    {coverId ? (
                      <Image
                        src={`/api/property-media/${coverId}`}
                        alt={p.title || "Portföy"}
                        fill
                        priority={idx < 3}
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        unoptimized
                        className="object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-text-faint">
                        <Building2 className="h-10 w-10" />
                      </div>
                    )}
                    <span className="absolute left-3 top-3 rounded-full bg-ink-950/80 px-2.5 py-1 text-xs font-bold uppercase text-white">
                      {p.transaction_type}
                    </span>
                    {/* Sağ üst köşe favori kalbinin (VitrinCardShell) alanı —
                        "Yeni" rozeti işlem türü pilinin altına alınır ki kalp
                        rozetin üstüne binmesin. */}
                    {isNewListing(p.published_at) ? (
                      <span className="absolute left-3 top-12 rounded-full bg-mint-500 px-2.5 py-1 text-xs font-bold uppercase text-white shadow-[var(--shadow-xs)]">
                        Yeni
                      </span>
                    ) : null}
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
                    {/* Döviz karşılığı — kur yoksa hiç gösterilmez */}
                    {(() => {
                      const line = fxApproxLine(p.list_price != null ? Number(p.list_price) : null, fxRates);
                      return line ? <p className="mt-0.5 text-xs text-text-faint" title={fxTitle}>{line}</p> : null;
                    })()}
                  </div>
                </Link>
                </VitrinCardShell>
              );
            })}
          </div>
          </>
        )}

        {/* 2+ favori seçilince alt çubuk + tam ekran karşılaştırma tablosu */}
        <CompareBar />

        {/* Değerleme CTA — satıcı lead hunisi girişi */}
        <section className="mt-10">
          <Link
            href={`/vitrin/${slug}/degerleme`}
            className="lift group flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-panel)] border border-line bg-surface px-5 py-5 transition hover:border-brand-300 sm:px-6"
          >
            <span className="flex items-center gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
                <Calculator className="h-5 w-5" />
              </span>
              <span>
                <span className="block font-display text-lg font-extrabold text-ink-950">Evim ne kadar eder?</span>
                <span className="block text-xs text-text-muted">
                  30 saniyede ücretsiz ön değerleme — {tenant.name} bölge verisiyle.
                </span>
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-4 py-2 text-xs font-bold text-white transition group-hover:bg-brand-600/90">
              Hemen hesapla <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        </section>

        {/* Kayıtlı arama — kriter + telefon bırakılır, cron yeni ilanla eşleşince ofis arar */}
        <SavedSearchBox slug={slug} provinces={provinces ?? []} roomOptions={roomOptions} />

        {/* Lead form */}
        <section className="mt-12 overflow-hidden rounded-[var(--radius-hero)] border border-line bg-surface shadow-[var(--shadow-xs)]">
          <div className="grid gap-0 lg:grid-cols-[1fr_1.1fr]">
            <div className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] p-8 text-white">
              <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
              <ShieldCheck className="h-8 w-8 text-mint-400" />
              <h2 className="mt-4 font-display text-2xl font-extrabold">Aradığınızı bulamadınız mı?</h2>
              <p className="mt-2 text-sm text-white/60">
                Kriterlerinizi paylaşın; {tenant.name} uzman danışmanı size en uygun portföyleri sunsun.
              </p>
            </div>
            <div className="theme-dark bg-[#071a38] p-6 sm:p-8">
              {tenant.lead_capture_enabled !== false && tenant.lead_capture_token ? (
                <LeadForm token={tenant.lead_capture_token} provinces={provinces ?? []} vitrinSlug={slug} />
              ) : (
                <p className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60">
                  Talep formu şu anda kapalı.
                </p>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line py-6 text-center text-xs text-text-faint">
        <Link href="/" className="font-semibold underline-offset-2 transition hover:text-brand-600 hover:underline">
          Powered by EmlakSoft
        </Link>{" "}
        — Türkiye&apos;nin emlak işletim sistemi
      </footer>
    </div>
  );
}
