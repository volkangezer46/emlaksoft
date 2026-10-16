import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import { OPEN_LISTING_OR_FILTER } from "@/lib/closed-listing";
import { unstable_cache } from "next/cache";
import { vitrinSignatureHref } from "@/lib/growth/attribution";
import { ArrowRight, Building2, Calculator, ChevronLeft, ChevronRight, MapPin, Ruler, BedDouble, Search, ShieldCheck, X } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { FavChip, FavEmptyNotice, VitrinCardShell } from "@/components/public/vitrin-fav";
import { FavNavBadge } from "./fav-nav-badge";
import { LazyCompareBar, LazyFilterPanel, LazyLeadForm, LazySavedSearchBox } from "./lazy-islands";
import { savedSearchFilterLabels, savedSearchFiltersFromListing } from "@/lib/vitrin/saved-search-filters";
import { DAY_MS, msSince, now } from "@/lib/clock";
import { fetchLatestRates, fxAgeLabel, fxApproxLine } from "@/lib/fx";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { PublicModuleClosed } from "@/components/modules/public-module-closed";
import { isPublicFeatureClosed } from "@/lib/modules/public";
import { getBaseUrl } from "@/lib/base-url";
import { provinceOptionsResult } from "@/lib/geo/reader";
import { resolvePublicContact } from "@/lib/public-contact";
import { PublicContactActions } from "@/components/public/public-contact-actions";
import { formatPublicPrice, listingCurrency, type ListingCurrency } from "@/lib/public-price";
import { LicenseNotice } from "@/components/public/license-notice";
import { loadVitrinSettings } from "@/lib/vitrin-settings";
import { getSeoSettings } from "@/lib/seo/store";
import { serializeJsonLd } from "@/lib/seo/jsonld";
import { vitrinRobots } from "@/lib/seo/patterns";
import { isNeverIndexTenant } from "@/lib/vitrin-seo/never-index";
import { loadNeverIndexList } from "@/lib/vitrin-seo/store";
import { vitrinOfficeMeta } from "@/lib/vitrin-seo/office-meta";
import { listingSlugInput, vitrinListingPath, vitrinListingUrl } from "@/lib/vitrin/listing-slug";
import {
  VITRIN_AGE_OPTIONS,
  VITRIN_FLOOR_OPTIONS,
  VITRIN_PAGE_SIZE,
  VITRIN_SORT_OPTIONS,
  activeFilterChips,
  filterKey,
  hasAnyFilter,
  listingHref,
  pageInfo,
  panelFilterCount,
  parseListingFilters,
  type ListingFilters,
  type VitrinSearchParams,
} from "@/lib/vitrin/listing-filters";
import { loadVitrinFacets, searchVitrinListingIds, type VitrinFacets } from "@/lib/vitrin/listing-search";
import {
  PUBLIC_COVER_COLUMNS,
  firstPublicImageByProperty,
  selectWithDocumentFlag,
  type PublicCoverCandidate,
} from "@/lib/public-property-media";

/** Son 7 günde yayına giren ilan "Yeni" rozeti alır (published_at gerçek yayın damgası). */
function isNewListing(publishedAt: string | null): boolean {
  return publishedAt != null && msSince(publishedAt) < 7 * DAY_MS;
}

// ISR: vitrin herkese acik — CDN onbellekli, 2 dk tazelenir (jet hiz)
export const revalidate = 60;

// SK8 B094: kart fiyatı ilanın para biriminden (features.currency) formatMoney ile; döviz ilanda TL kur satırı yok.
function money(n: number | null, tx: string | null | undefined, currency: ListingCurrency) {
  return formatPublicPrice(n, tx, currency);
}

type Rel = { name?: string } | { name?: string }[] | null;
function relName(v: Rel) {
  if (!v) return null;
  const r = Array.isArray(v) ? v[0] : v;
  return r?.name ?? null;
}

/**
 * Kabuk + metadata ORTAK verisi — yalnız `params`'a bağlıdır, searchParams OKUMAZ (HIZ-05 / SP7).
 * React `cache`: generateMetadata ile sayfa aynı istekte tek tur paylaşır. Sayfa kabuğu bu veriyi bekler; metadata da
 * yalnız bunu beklediği için `<title>`/description kabukla birlikte `<head>`'e girer (akışla gövdeye düşmez).
 * Filtreli ilan ızgarası searchParams'ı ayrı alt bileşende okur ve <Suspense> içinde akar.
 */
const loadOfficeHead = cache(async (slug: string) => {
  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select(
      "id, name, slug, status, brand_color, logo_url, phone, license_no, address_line, lead_capture_token, lead_capture_enabled, sample_seeded_at, sample_cleared_at",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant || !isPublicTenantActive(tenant.status)) return null;
  // Ofis ayarı (sütun yoksa varsayılan: açık, tanıtım yok, arama onayı yok -> noindex), aktif ilan sayısı, SEO
  // kalıpları ve kalıcı noindex listesi birbirinden bağımsız: paralel.
  const [vitrinState, { count }, seo, neverIndexList] = await Promise.all([
    loadVitrinSettings(admin, tenant.id),
    admin
      .from("properties")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("status", "live")
      .is("deleted_at", null)
      .eq("is_sample", false)
      .or(OPEN_LISTING_OR_FILTER),
    getSeoSettings(),
    loadNeverIndexList(),
  ]);
  return {
    admin,
    tenant,
    vitrinCfg: vitrinState.settings,
    vitrinCfgAvailable: vitrinState.available,
    liveCount: count ?? 0,
    seo,
    // Örnek/demo/test/platform kiracısı: opt-in açık olsa bile noindex (src/lib/vitrin-seo/never-index.ts).
    neverIndex: isNeverIndexTenant(tenant, neverIndexList),
  };
});

type OfficeHead = NonNullable<Awaited<ReturnType<typeof loadOfficeHead>>>;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const head = await loadOfficeHead(slug);
  if (!head || !head.vitrinCfg.enabled) return { title: "Vitrin bulunamadı" };
  const { tenant, vitrinCfg, seo } = head;

  // Önce ofisin elle yazdığı SEO metni (Vitrin ayarları), sonra tanıtım metni / SEO kalıbı (vitrin-seo/office-meta.ts).
  const { title, description } = vitrinOfficeMeta({
    seoTitle: vitrinCfg.seoTitle,
    seoDescription: vitrinCfg.seoDescription,
    intro: vitrinCfg.intro,
    patterns: seo.patterns,
    vars: { ofis: tenant.name, ilan_sayisi: head.liveCount },
  });

  return {
    title: { absolute: title },
    description,
    // Arama motoru görünürlüğü: kalıcı noindex kuralı ÖNCE, sonra ofisin açık onayı (tenants.vitrin_seo_optin);
    // sitemap ile aynı ölçüt.
    robots: vitrinRobots(vitrinCfg.seoOptin, head.neverIndex),
    alternates: { canonical: `/vitrin/${slug}` },
    // PUB-10: ana ekrana eklenince ofisin adı/logosu görünür (EmlakSoft değil).
    manifest: `/vitrin/${slug}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: (tenant.name ?? "").slice(0, 30) || undefined, statusBarStyle: "default" },
    ...(tenant.logo_url ? { icons: { apple: tenant.logo_url } } : {}),
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

/* ---------- Filtreli ilan verisi (searchParams'a bağlı; yalnız Suspense içindeki alt bileşenler okur) ---------- */

const LISTING_COLUMNS =
  "id, title, property_code, transaction_type, property_type, list_price, features, published_at, province:geo_provinces(name), district:geo_districts(name), neighborhood:geo_neighborhoods(name)";

/**
 * Filtreli ilan sayfası (PUB-1). Süzgeç + sıralama + sayfalama SUNUCUDA (`vitrin_listing_search` RPC'si; yoksa
 * PostgREST yedeği — `src/lib/vitrin/listing-search.ts`): satılık/kiralık artık sorguda süzülür, 60 satır tavanı yok,
 * `?sayfa=N` gerçek sayfadır. Vitrin listesi searchParams okuduğu için sayfa dinamik render olur; veri katmanı kısa TTL
 * (60 sn) önbellektedir. Anahtar tenant.id + normalize süzgeçler; serbest metin araması (q) önbelleğe ALINMAZ. Tenant
 * durumu (askı/iptal) önbelleğin DIŞINDA her istekte denetlenir (loadOfficeHead). React `cache`: üst filtre şeridi,
 * ızgara ve kayıtlı arama kutusu aynı istekte TEK sorgu paylaşır.
 */
const loadFilteredListing = cache(async (head: OfficeHead, key: string) => {
  const { admin, tenant } = head;
  const f = JSON.parse(key) as ListingFilters;
  const loadListing = async () => {
    const [page, fxRates] = await Promise.all([searchVitrinListingIds(admin, tenant.id, f), fetchLatestRates(admin)]);
    if (!page.ids.length) return { page, rows: [], coverEntries: [] as [string, string][], fxRates };
    const [{ data: rows }, { data: media }] = await Promise.all([
      admin
        .from("properties")
        .select(LISTING_COLUMNS)
        .in("id", page.ids)
        .eq("tenant_id", tenant.id)
        .eq("status", "live")
        .is("deleted_at", null)
        .eq("is_sample", false)
        .or(OPEN_LISTING_OR_FILTER),
      // KVKK P0-9: belge (is_document; sütun yoksa belge adlı) görsel kapak olmaz, sıradaki ilan görseline düşülür.
      selectWithDocumentFlag<PublicCoverCandidate[]>(PUBLIC_COVER_COLUMNS, (columns) =>
        admin
          .from("property_media")
          .select(columns)
          .eq("kind", "image")
          .in("property_id", page.ids)
          .order("is_cover", { ascending: false })
          .order("sort_order", { ascending: true }),
      ),
    ]);
    // Sıra RPC'den gelir (id listesi); satır sorgusu sırayı korumaz.
    const order = new Map(page.ids.map((id, i) => [id, i]));
    const sorted = [...(rows ?? [])].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return { page, rows: sorted, coverEntries: [...firstPublicImageByProperty(media)], fxRates };
  };
  const listing = f.q
    ? await loadListing()
    : await unstable_cache(loadListing, ["vitrin-listing-v3", tenant.id, key], {
        revalidate: 60,
        tags: ["vitrin", `vitrin:${tenant.id}`],
      })();
  return { ...listing, coverMap: new Map<string, string>(listing.coverEntries) };
});

/** Süzgeç seçenekleri (oda, tür, il/ilçe/mahalle) yayındaki ilanların tam kümesinden; süzgeçten bağımsız önbellek. */
const loadFacets = cache(async (head: OfficeHead): Promise<VitrinFacets> => {
  const { admin, tenant } = head;
  return unstable_cache(() => loadVitrinFacets(admin, tenant.id), ["vitrin-facets-v1", tenant.id], {
    revalidate: 60,
    tags: ["vitrin", `vitrin:${tenant.id}`],
  })();
});

async function readListing(head: OfficeHead, searchParams: Promise<VitrinSearchParams> | undefined) {
  const f = parseListingFilters((await searchParams) ?? {});
  const [data, facets] = await Promise.all([loadFilteredListing(head, filterKey(f)), loadFacets(head)]);
  return { f, data, facets };
}

const fieldCls =
  "min-h-11 w-full rounded-[var(--radius-card)] border border-white/15 bg-white/[0.06] px-3.5 py-2.5 text-sm text-white placeholder:text-white/40 outline-none transition focus:border-mint-400/50 focus:bg-white/[0.09]";
const optCls = "bg-ink-950";
const groupLabelCls = "text-xs font-bold uppercase tracking-[0.12em] text-white/50";

/** İlçe seçici: birden çok ildeki ilçeler il başlığı altında gruplanır (JS'siz). */
function DistrictOptions({ facets, f }: { facets: VitrinFacets; f: ListingFilters }) {
  const list = f.il ? facets.districts.filter((d) => d.provinceId === f.il) : facets.districts;
  if (facets.provinces.length > 1 && !f.il) {
    return (
      <>
        {facets.provinces.map((pv) => {
          const items = list.filter((d) => d.provinceId === pv.id);
          return items.length ? (
            <optgroup key={pv.id} label={pv.name} className={optCls}>
              {items.map((d) => (
                <option key={d.id} value={d.id} className={optCls}>{`${d.name} (${d.count})`}</option>
              ))}
            </optgroup>
          ) : null;
        })}
      </>
    );
  }
  return (
    <>
      {list.map((d) => (
        <option key={d.id} value={d.id} className={optCls}>{`${d.name} (${d.count})`}</option>
      ))}
    </>
  );
}

/** Mahalle seçici: ilçe seçiliyse yalnız o ilçenin mahalleleri; değilse ilçe başlığı altında gruplu. */
function NeighborhoodOptions({ facets, f }: { facets: VitrinFacets; f: ListingFilters }) {
  if (f.ilce) {
    return (
      <>
        {facets.neighborhoods
          .filter((n) => n.districtId === f.ilce)
          .map((n) => (
            <option key={n.id} value={n.id} className={optCls}>{`${n.name} (${n.count})`}</option>
          ))}
      </>
    );
  }
  return (
    <>
      {facets.districts.map((d) => {
        const items = facets.neighborhoods.filter((n) => n.districtId === d.id);
        return items.length ? (
          <optgroup key={d.id} label={d.name} className={optCls}>
            {items.map((n) => (
              <option key={n.id} value={n.id} className={optCls}>{`${n.name} (${n.count})`}</option>
            ))}
          </optgroup>
        ) : null;
      })}
    </>
  );
}

function CheckField({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[var(--radius-card)] border border-white/15 bg-white/[0.06] px-3.5 text-sm text-white transition hover:bg-white/[0.09] has-[:checked]:border-mint-400/60 has-[:checked]:bg-mint-500/15">
      <input type="checkbox" name={name} value="1" defaultChecked={checked} className="h-5 w-5 shrink-0 accent-[var(--mint-500)]" />
      {label}
    </label>
  );
}

/** Hero altındaki filtre şeridi (sayı satırı, işlem sekmeleri, tür çipleri, GET filtre formu, uygulanan çipler). */
async function VitrinHeaderFilters({
  head,
  slug,
  searchParams,
}: {
  head: OfficeHead;
  slug: string;
  searchParams?: Promise<VitrinSearchParams>;
}) {
  const { f, data, facets } = await readListing(head, searchParams);
  const total = data.page.total;
  const hasFilter = hasAnyFilter(f);
  const chips = activeFilterChips(slug, f, facets);
  const advancedOpen = Boolean(f.il || f.mahalle || f.m2min != null || f.m2max != null || f.yasmax != null || f.kat || f.esyali || f.site || f.kredi);
  const showNeighborhoods = facets.neighborhoods.length > 0 && (!f.ilce || facets.neighborhoods.some((n) => n.districtId === f.ilce));

  return (
    <>
      <p className="mt-2 max-w-xl text-sm text-white/60" aria-live="polite">
        <strong className="font-bold text-white">{total.toLocaleString("tr-TR")}</strong> {hasFilter ? "ilan bulundu" : "aktif ilan"} · yerinde
        inceleme ve fiyat bilgisi için hemen talep bırakın.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        {[
          { key: "", label: "Tümü" },
          { key: "satilik", label: "Satılık" },
          { key: "kiralik", label: "Kiralık" },
        ].map((t) => {
          const active = f.tx === t.key;
          return (
            <Link
              key={t.key}
              href={listingHref(slug, f, { tx: t.key as ListingFilters["tx"] })}
              aria-current={active ? "true" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full px-4 py-2 text-xs font-bold transition ${
                active ? "bg-white text-ink-950" : "border border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
        {/* Favori görünümü — client filtre, SSR listesi değişmez */}
        <FavChip slug={slug} />
        {/* Favoriler sayfası + sayaç rozeti (localStorage, hydration-güvenli) */}
        <FavNavBadge slug={slug} variant="dark" />
      </div>

      {facets.types.length > 1 ? (
        <nav aria-label="Emlak türü" className="mt-3 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
          {["", ...facets.types].map((t) => {
            const active = f.tur === t;
            return (
              <Link
                key={t || "tum"}
                href={listingHref(slug, f, { tur: t })}
                aria-current={active ? "true" : undefined}
                className={`inline-flex min-h-11 shrink-0 items-center rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  // Koyu hero'da --ink-950 beyazdır: mint zeminde değişmez lacivert metin (kontrast).
                  active ? "bg-mint-500 text-[color:var(--navy-900)]" : "border border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                {t || "Tüm türler"}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {/* Sunucu filtreleri — GET formu, JS gerektirmez; mobilde alt sayfa (sheet), masaüstünde satır içi. */}
      <LazyFilterPanel activeCount={panelFilterCount(f)} resultCount={total}>
        <form method="get" action={`/vitrin/${slug}`} className="max-w-5xl space-y-3">
          {f.tx ? <input type="hidden" name="tx" value={f.tx} /> : null}
          {f.tur ? <input type="hidden" name="tur" value={f.tur} /> : null}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.6fr_1.2fr_1fr_1fr_1fr_1.3fr]">
            <input name="q" defaultValue={f.q} placeholder="Başlık, kod, ilçe veya mahalle" className={fieldCls} aria-label="Metin arama" />
            {facets.districts.length > 0 ? (
              <select name="ilce" defaultValue={f.ilce} className={fieldCls} aria-label="İlçe">
                <option value="" className={optCls}>İlçe (tümü)</option>
                <DistrictOptions facets={facets} f={f} />
              </select>
            ) : null}
            <input name="min" defaultValue={f.min ?? ""} inputMode="numeric" placeholder="En az fiyat" className={fieldCls} aria-label="En az fiyat" />
            <input name="max" defaultValue={f.max ?? ""} inputMode="numeric" placeholder="En çok fiyat" className={fieldCls} aria-label="En çok fiyat" />
            <select name="oda" defaultValue={f.oda} className={fieldCls} aria-label="Oda sayısı">
              <option value="" className={optCls}>Oda (tümü)</option>
              {facets.rooms.map((r) => (
                <option key={r} value={r} className={optCls}>{r}</option>
              ))}
            </select>
            <select name="sirala" defaultValue={f.sirala} className={fieldCls} aria-label="Sıralama">
              {VITRIN_SORT_OPTIONS.map((o) => (
                <option key={o.value || "varsayilan"} value={o.value} className={optCls}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Ayrıntılı süzgeçler: <details> JS'siz açılır; etkin ayrıntılı süzgeç varsa açık gelir. */}
          <details open={advancedOpen} className="group rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03]">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 text-sm font-semibold text-white/80 [&::-webkit-details-marker]:hidden">
              Daha fazla filtre: konum, m², bina yaşı, kat, özellikler
              <ChevronRight className="h-4 w-4 shrink-0 transition group-open:rotate-90" aria-hidden="true" />
            </summary>
            <div className="space-y-4 px-3.5 pb-4 pt-1">
              {facets.provinces.length > 1 || showNeighborhoods ? (
                <fieldset className="space-y-2">
                  <legend className={groupLabelCls}>Konum</legend>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {facets.provinces.length > 1 ? (
                      <select name="il" defaultValue={f.il} className={fieldCls} aria-label="İl">
                        <option value="" className={optCls}>İl (tümü)</option>
                        {facets.provinces.map((pv) => (
                          <option key={pv.id} value={pv.id} className={optCls}>{`${pv.name} (${pv.count})`}</option>
                        ))}
                      </select>
                    ) : null}
                    {showNeighborhoods ? (
                      <select name="mahalle" defaultValue={f.mahalle} className={fieldCls} aria-label="Mahalle">
                        <option value="" className={optCls}>Mahalle (tümü)</option>
                        <NeighborhoodOptions facets={facets} f={f} />
                      </select>
                    ) : null}
                  </div>
                </fieldset>
              ) : null}
              <fieldset className="space-y-2">
                <legend className={groupLabelCls}>Bina ve alan</legend>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <input name="m2min" defaultValue={f.m2min ?? ""} inputMode="numeric" placeholder="En az m²" className={fieldCls} aria-label="En az metrekare" />
                  <input name="m2max" defaultValue={f.m2max ?? ""} inputMode="numeric" placeholder="En çok m²" className={fieldCls} aria-label="En çok metrekare" />
                  <select name="yas" defaultValue={f.yasmax != null ? String(f.yasmax) : ""} className={fieldCls} aria-label="Bina yaşı">
                    {VITRIN_AGE_OPTIONS.map((o) => (
                      <option key={o.value || "tum"} value={o.value} className={optCls}>{o.label}</option>
                    ))}
                  </select>
                  <select name="kat" defaultValue={f.kat} className={fieldCls} aria-label="Bulunduğu kat">
                    {VITRIN_FLOOR_OPTIONS.map((o) => (
                      <option key={o.value || "tum"} value={o.value} className={optCls}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </fieldset>
              <fieldset className="space-y-2">
                <legend className={groupLabelCls}>Özellikler</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  <CheckField name="esyali" label="Eşyalı" checked={f.esyali} />
                  <CheckField name="site" label="Site içinde" checked={f.site} />
                  <CheckField name="kredi" label="Krediye uygun" checked={f.kredi} />
                </div>
              </fieldset>
            </div>
          </details>

          <div className="flex flex-wrap items-center gap-2 max-lg:sticky max-lg:bottom-0 max-lg:-mx-4 max-lg:border-t max-lg:border-white/10 max-lg:bg-[#071a38] max-lg:px-4 max-lg:py-3">
            <button
              type="submit"
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-card)] bg-white px-5 py-2.5 text-sm font-bold text-ink-950 transition hover:bg-white/90 sm:flex-none"
            >
              <Search className="h-4 w-4" aria-hidden="true" /> Sonuçları göster
            </button>
            {hasFilter ? (
              <Link
                href={`/vitrin/${slug}`}
                className="inline-flex min-h-11 items-center rounded-[var(--radius-card)] px-3 text-sm font-semibold text-white/60 underline-offset-2 transition hover:text-white hover:underline"
              >
                Temizle
              </Link>
            ) : null}
          </div>
        </form>
      </LazyFilterPanel>

      {/* Uygulanan süzgeçler: her çip tek dokunuşla kendi süzgecini kaldırır (JS'siz bağlantı). */}
      {chips.length ? (
        <ul aria-label="Uygulanan filtreler" className="mt-3 flex flex-wrap gap-2">
          {chips.map((c) => (
            <li key={c.key}>
              <Link
                href={c.href}
                aria-label={`${c.label} filtresini kaldır`}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-mint-400/40 bg-mint-500/15 pl-3.5 pr-3 text-xs font-semibold text-white transition hover:bg-mint-500/25"
              >
                {c.label}
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
          <li>
            <Link
              href={`/vitrin/${slug}`}
              className="inline-flex min-h-11 items-center px-2 text-xs font-semibold text-white/60 underline-offset-2 transition hover:text-white hover:underline"
            >
              Tümünü temizle
            </Link>
          </li>
        </ul>
      ) : null}
    </>
  );
}

/** Filtre şeridi akarken yer tutucu (düzen sıçraması az olsun diye aynı dikey ritim). */
function HeaderFiltersFallback() {
  return (
    <div aria-hidden="true">
      <div className="mt-2 h-5 w-64 max-w-full rounded bg-white/10 motion-safe:animate-pulse" />
      <div className="mt-6 flex gap-2">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-11 w-20 rounded-full bg-white/10 motion-safe:animate-pulse" />
        ))}
      </div>
      <div className="mt-5 h-11 w-full max-w-4xl rounded-[var(--radius-card)] bg-white/10 motion-safe:animate-pulse" />
    </div>
  );
}

/** İlan ızgarası + ItemList JSON-LD (filtreli liste). */
async function VitrinGrid({
  head,
  slug,
  searchParams,
}: {
  head: OfficeHead;
  slug: string;
  searchParams?: Promise<VitrinSearchParams>;
}) {
  const { f, data } = await readListing(head, searchParams);
  const { rows: properties, coverMap, fxRates, page } = data;
  const hasFilter = hasAnyFilter(f);
  const info = pageInfo(page.total, f.sayfa);
  // Kur tarihi ipucu — kartlardaki döviz satırının `title` değeri.
  const fxTitle = fxRates ? `TCMB ${fxRates.rateDate} satış kuru — ${fxAgeLabel(fxRates.rateDate, now())}` : undefined;
  const siteUrl = getBaseUrl();
  const offset = (f.sayfa - 1) * VITRIN_PAGE_SIZE;
  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    numberOfItems: page.total,
    itemListElement: properties.slice(0, 20).map((p, i) => ({
      "@type": "ListItem",
      position: offset + i + 1,
      url: vitrinListingUrl(siteUrl, slug, listingSlugInput(p)),
      name: p.title || p.property_code,
    })),
  };

  const degradedNotice = page.degraded ? (
    <p className="mb-4 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-xs font-semibold text-amber-800">
      m², bina yaşı, kat ve özellik filtreleri şu anda kullanılamıyor; liste bu filtreler uygulanmadan gösteriliyor.
    </p>
  ) : null;

  if (properties.length === 0) {
    const beyondLastPage = f.sayfa > 1 && page.total > 0;
    return (
      <>
        {degradedNotice}
        <div className="rounded-[var(--radius-panel)] border border-dashed border-line bg-surface px-5 py-20 text-center">
          <Building2 className="mx-auto h-8 w-8 text-text-faint" />
          <p className="mt-3 text-sm font-semibold text-ink-950">
            {beyondLastPage ? "Bu sayfada ilan kalmadı" : hasFilter ? "Filtrelere uygun ilan bulunamadı" : "Şu anda yayında ilan yok"}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {beyondLastPage ? `Toplam ${page.total} ilan ilk ${info.pages} sayfada.` : "Talebinizi bırakın, uygun portföy çıkınca size ulaşalım."}
          </p>
          {beyondLastPage ? (
            <Link
              href={listingHref(slug, f, { sayfa: 1 })}
              className="mt-4 inline-flex min-h-11 items-center rounded-full border border-line px-4 py-2 text-xs font-bold text-brand-600 transition hover:border-brand-300"
            >
              İlk sayfaya dön
            </Link>
          ) : hasFilter ? (
            <Link
              href={`/vitrin/${slug}`}
              className="mt-4 inline-flex min-h-11 items-center rounded-full border border-line px-4 py-2 text-xs font-bold text-brand-600 transition hover:border-brand-300"
            >
              Filtreleri temizle
            </Link>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(itemListLd) }} />
      {degradedNotice}
      <p className="mb-4 text-xs font-semibold text-text-muted">
        {page.total.toLocaleString("tr-TR")} ilandan {info.from}–{info.to} arası gösteriliyor
      </p>
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
          const loc = [relName(p.neighborhood as Rel), relName(p.district as Rel), relName(p.province as Rel)].filter(Boolean).join(", ");
          const href = vitrinListingPath(slug, listingSlugInput(p));
          return (
            <VitrinCardShell
              key={p.id}
              slug={slug}
              item={{
                id: p.id,
                title: p.title || p.property_code,
                href,
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
              href={href}
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
                    <div className="text-center">
                      <Building2 className="mx-auto h-10 w-10" aria-hidden="true" />
                      <p className="mt-1 text-xs font-semibold">Fotoğraf yakında</p>
                    </div>
                  </div>
                )}
                <span className="absolute left-3 top-3 rounded-full bg-ink-950/80 px-2.5 py-1 text-xs font-bold uppercase text-white">
                  {p.transaction_type}
                </span>
                {/* Sağ üst köşe favori kalbinin (VitrinCardShell) alanı —
                    "Yeni" rozeti işlem türü pilinin altına alınır ki kalp
                    rozetin üstüne binmesin. mint-700 zemin: beyaz metinle ≥4.5:1. */}
                {isNewListing(p.published_at) ? (
                  <span className="absolute left-3 top-12 rounded-full bg-mint-700 px-2.5 py-1 text-xs font-bold uppercase text-white shadow-[var(--shadow-xs)]">
                    Yeni
                  </span>
                ) : null}
              </div>
              <div className="p-4">
                <p className="line-clamp-1 font-display font-bold text-ink-950">{p.title || p.property_code}</p>
                <p className="mt-1 flex items-center gap-1 text-xs text-text-muted">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-brand-600" /> <span className="line-clamp-1">{loc || "Konum belirtilmedi"}</span>
                </p>
                <div className="mt-3 flex items-center gap-3 text-xs text-text-muted">
                  {feat.rooms ? <span className="flex items-center gap-1"><BedDouble className="h-3.5 w-3.5" /> {feat.rooms}</span> : null}
                  {feat.sqm ? <span className="flex items-center gap-1"><Ruler className="h-3.5 w-3.5" /> {feat.sqm} m²</span> : null}
                </div>
                <p className="mt-3 font-display text-xl font-extrabold text-brand-600">
                  {money(p.list_price != null ? Number(p.list_price) : null, p.transaction_type, listingCurrency(p.features))}
                </p>
                {/* Döviz karşılığı — kur yoksa ya da ilan dövizse hiç gösterilmez */}
                {(() => {
                  const line =
                    listingCurrency(p.features) === "TRY"
                      ? fxApproxLine(p.list_price != null ? Number(p.list_price) : null, fxRates)
                      : null;
                  return line ? <p className="mt-0.5 text-xs text-text-faint" title={fxTitle}>{line}</p> : null;
                })()}
              </div>
            </Link>
            </VitrinCardShell>
          );
        })}
      </div>
      <VitrinPager slug={slug} f={f} pages={info.pages} />
    </>
  );
}

/** Sayfalama: JS'siz GET bağlantıları (rel=prev/next), 44 px hedefler; tek sayfada çizilmez. */
function VitrinPager({ slug, f, pages }: { slug: string; f: ListingFilters; pages: number }) {
  if (pages <= 1) return null;
  const prev = f.sayfa > 1 ? listingHref(slug, f, { sayfa: f.sayfa - 1 }) : null;
  const next = f.sayfa < pages ? listingHref(slug, f, { sayfa: f.sayfa + 1 }) : null;
  const btn =
    "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-sm font-bold text-ink-950 transition hover:border-brand-300 hover:text-brand-600";
  const off = "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm font-bold text-text-faint opacity-60";
  return (
    <nav aria-label="Sayfalar" className="mt-8 flex items-center justify-between gap-3 sm:justify-center">
      {prev ? (
        <Link href={prev} rel="prev" className={btn}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Önceki
        </Link>
      ) : (
        <span aria-hidden="true" className={off}>
          <ChevronLeft className="h-4 w-4" /> Önceki
        </span>
      )}
      <span className="text-sm font-semibold text-text-muted" aria-current="page">
        Sayfa {f.sayfa} / {pages}
      </span>
      {next ? (
        <Link href={next} rel="next" className={btn}>
          Sonraki <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : (
        <span aria-hidden="true" className={off}>
          Sonraki <ChevronRight className="h-4 w-4" />
        </span>
      )}
    </nav>
  );
}

/** Izgara akarken iskelet kartlar (gerçek kart ölçüsünde). */
function GridFallback() {
  return (
    <div aria-hidden="true" className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
          <div className="aspect-[4/3] bg-ink-950/5 motion-safe:animate-pulse" />
          <div className="space-y-2 p-4">
            <div className="h-4 w-3/4 rounded bg-ink-950/8 motion-safe:animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-ink-950/8 motion-safe:animate-pulse" />
            <div className="h-6 w-1/3 rounded bg-ink-950/8 motion-safe:animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Kayıtlı arama kutusu: oda seçenekleri yayındaki gerçek değerlerden (filtreli liste ile aynı sorgu). */
async function VitrinSavedSearch({
  head,
  slug,
  searchParams,
  provinces,
}: {
  head: OfficeHead;
  slug: string;
  searchParams?: Promise<VitrinSearchParams>;
  provinces: { id: string; name: string }[];
}) {
  const { f, facets } = await readListing(head, searchParams);
  // Listede uygulanan süzgeçler kutuya önceden dolar; gelişmiş olanlar (m², eşyalı…) etiketleriyle birlikte kaydedilir.
  const extra = savedSearchFiltersFromListing(f);
  const neighborhoodName = extra.neighborhood ? (facets.neighborhoods.find((n) => n.id === extra.neighborhood)?.name ?? null) : null;
  const initial = {
    tx: f.tx,
    provinceId: f.il,
    districtId: f.il ? f.ilce : "",
    minPrice: f.min,
    maxPrice: f.max,
    rooms: f.oda,
    filters: extra,
    filterLabels: savedSearchFilterLabels(extra, neighborhoodName),
  };
  return <LazySavedSearchBox slug={slug} provinces={provinces} roomOptions={facets.rooms} initial={initial} />;
}

export default async function VitrinPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<VitrinSearchParams>;
}) {
  const { slug } = await params;

  // Kabuk verisi (metadata ile ortak) ve iller (bağımsız) paralel; searchParams burada OKUNMAZ.
  const [head, { data: provinces }] = await Promise.all([loadOfficeHead(slug), provinceOptionsResult()]);
  if (!head) notFound();
  const { admin, tenant, vitrinCfg, vitrinCfgAvailable } = head;
  if (!tenant || !isPublicTenantActive(tenant.status)) notFound();
  if (await isPublicFeatureClosed(admin, tenant.id, "vitrin")) return <PublicModuleClosed officeName={tenant.name} />;
  // Ofis vitrin ayarları (loadOfficeHead içinde ayrı sorgu: sütun yoksa varsayılan = bugünkü davranış).
  if (!vitrinCfg.enabled) notFound();

  // JSON-LD: ofis (RealEstateAgent) — yalnız doğrulanabilir alanlar. İlan listesi (ItemList) ızgarayla birlikte akar.
  const siteUrl = getBaseUrl();
  const officeLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateAgent",
    name: tenant.name,
    url: `${siteUrl}/vitrin/${slug}`,
    ...(tenant.logo_url ? { logo: tenant.logo_url } : {}),
    ...(tenant.phone && vitrinCfg.showPhone ? { telephone: tenant.phone } : {}),
  };

  return (
    <div className="min-h-screen bg-canvas">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(officeLd) }} />
      {/* Hero */}
      <header className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-brand-600/25 blur-[120px]" />
        <div className="relative mx-auto max-w-6xl px-4 py-8 sm:py-16">
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
          {vitrinCfg.intro ? (
            <p className="mt-3 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-white/80">{vitrinCfg.intro}</p>
          ) : null}
          {/* İletişim (SK8 B148): ofisin bilerek girdiği telefon, "telefonu göster" ayarı açıksa; tek bileşen. */}
          {vitrinCfgAvailable && vitrinCfg.showPhone ? (
            <PublicContactActions
              contact={resolvePublicContact({
                officePhone: tenant.phone,
                whatsappText: `Merhaba, ${tenant.name} vitrinindeki portföyler hakkında bilgi almak istiyorum.`,
              })}
              tone="dark"
              className="mt-4 max-w-sm"
            />
          ) : null}

          {/* Filtre şeridi searchParams okur: kabuk ve metadata beklemesin diye ayrı akar */}
          <Suspense fallback={<HeaderFiltersFallback />}>
            <VitrinHeaderFilters head={head} slug={slug} searchParams={searchParams} />
          </Suspense>
        </div>
      </header>

      {/* Grid */}
      <main id="main-content" className="mx-auto max-w-6xl px-4 py-10">
        {/* 2+ favori seçilince alt çubuk + tam ekran karşılaştırma tablosu (işaret ızgaranın başında) */}
        <LazyCompareBar />

        <Suspense fallback={<GridFallback />}>
          <VitrinGrid head={head} slug={slug} searchParams={searchParams} />
        </Suspense>

        {/* Değerleme CTA — satıcı lead hunisi girişi */}
        {vitrinCfg.showValuation ? (
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
        ) : null}

        {/* Kayıtlı arama — kriter + telefon bırakılır, cron yeni ilanla eşleşince ofis arar */}
        <Suspense fallback={null}>
          <VitrinSavedSearch head={head} slug={slug} searchParams={searchParams} provinces={provinces ?? []} />
        </Suspense>

        {/* Lead form */}
        {vitrinCfg.showLeadForm ? (
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
                <LazyLeadForm token={tenant.lead_capture_token} provinces={provinces ?? []} vitrinSlug={slug} />
              ) : (
                <p className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60">
                  Talep formu şu anda kapalı.
                </p>
              )}
            </div>
          </div>
        </section>
        ) : null}
      </main>

      <div className="mx-auto max-w-6xl px-4 pb-4">
        <LicenseNotice officeName={tenant.name} licenseNo={tenant.license_no} phone={tenant.phone} addressLine={tenant.address_line} />
      </div>

      <footer className="border-t border-line py-6 text-center text-xs text-text-faint">
        <Link
          href={vitrinSignatureHref(slug)}
          rel="nofollow"
          className="font-semibold underline-offset-2 transition hover:text-brand-600 hover:underline"
        >
          EmlakSoft ile hazırlandı
        </Link>{" "}
        — siz de ofisiniz için ücretsiz deneyin
      </footer>
    </div>
  );
}
