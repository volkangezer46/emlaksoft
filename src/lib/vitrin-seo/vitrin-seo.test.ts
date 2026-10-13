import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mergePatterns } from "@/lib/seo/schema";
import { LISTING_TITLE_MAX, listingDefaultTitle, resolveSeoPattern, vitrinRobots } from "@/lib/seo/patterns";
import { serializeJsonLd } from "@/lib/seo/jsonld";
import {
  DEFAULT_NEVER_INDEX_SLUGS,
  isNeverIndexTenant,
  resolveNeverIndexList,
  vitrinIndexable,
} from "./never-index";
import { listingFactLine, listingSeoVars, sqmText } from "./describe";
import { listingImageAlt } from "./alt-text";
import { vitrinListingBreadcrumbLd } from "./breadcrumb";
import { buildVitrinListingLd } from "./listing-ld";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("kalıcı noindex sözleşmesi", () => {
  const list = resolveNeverIndexList(null);
  const normal = { slug: "gezertasar-emlak", sample_seeded_at: null, sample_cleared_at: null };

  it("opt-in false → noindex", () => {
    expect(vitrinRobots(false, isNeverIndexTenant(normal, list))).toEqual({ index: false, follow: true });
  });
  it("örnek kiracı (sample_seeded_at dolu, cleared boş) → opt-in true olsa bile noindex", () => {
    const sample = { slug: "yeni-ofis", sample_seeded_at: "2026-10-06T18:34:12Z", sample_cleared_at: null };
    expect(isNeverIndexTenant(sample, list)).toBe(true);
    expect(vitrinRobots(true, isNeverIndexTenant(sample, list)).index).toBe(false);
    // Örnek veri temizlendiyse kural kalkar.
    expect(isNeverIndexTenant({ ...sample, sample_cleared_at: "2026-10-07T00:00:00Z" }, list)).toBe(false);
  });
  it("liste slug'ı (demo-ofis, e2e-test, admin) → opt-in true olsa bile noindex", () => {
    for (const slug of ["demo-ofis", "e2e-test", "admin", "Demo-Ofis"]) {
      expect(vitrinIndexable(true, { slug }, list), slug).toBe(false);
    }
  });
  it("opt-in true olan normal kiracı → index", () => {
    expect(vitrinRobots(true, isNeverIndexTenant(normal, list))).toEqual({ index: true, follow: true });
    expect(vitrinIndexable(true, normal, list)).toBe(true);
  });
  it("platform/demo/test türü (kind) noindex", () => {
    expect(isNeverIndexTenant({ slug: "x", kind: "platform" }, list)).toBe(true);
    expect(isNeverIndexTenant({ slug: "x", kind: "customer" }, list)).toBe(false);
  });
  it("ayar okunamazsa / bozuksa / boşsa varsayılan liste uygulanır (güvenli taraf)", () => {
    expect(resolveNeverIndexList(null)).toEqual([...DEFAULT_NEVER_INDEX_SLUGS]);
    expect(resolveNeverIndexList("[bozuk")).toEqual([...DEFAULT_NEVER_INDEX_SLUGS]);
    expect(resolveNeverIndexList("[]")).toEqual([...DEFAULT_NEVER_INDEX_SLUGS]);
    // Ayar varsayılanı kaldıramaz, yalnız ekler; geçersiz öğe atılır.
    const custom = resolveNeverIndexList('["test-ofisi", "<script>", 5]');
    expect(custom).toEqual([...DEFAULT_NEVER_INDEX_SLUGS, "test-ofisi"]);
    expect(resolveNeverIndexList("a-ofis, b-ofis\nc-ofis")).toEqual([...DEFAULT_NEVER_INDEX_SLUGS, "a-ofis", "b-ofis", "c-ofis"]);
    // Ham ayar dizisi (varsayılansız) geçilse bile varsayılan slug'lar korunur.
    expect(isNeverIndexTenant({ slug: "demo-ofis" }, [])).toBe(true);
  });
  it("vitrin, ilan ve danışman generateMetadata kalıcı noindex'i robots kararına bağlar", () => {
    expect(read("src/app/vitrin/[slug]/page.tsx")).toMatch(/robots: vitrinRobots\(vitrinCfg\.seoOptin, head\.neverIndex\)/);
    expect(read("src/app/vitrin/[slug]/page.tsx")).toContain("isNeverIndexTenant(tenant, neverIndexList)");
    expect(read("src/app/vitrin/[slug]/[id]/page.tsx")).toMatch(/robots: vitrinRobots\(vitrinCfg\.seoOptin, isNeverIndexTenant\(tenant, neverIndexList\)\)/);
    expect(read("src/app/danisman/[slug]/page.tsx")).toMatch(/robots: vitrinRobots\(tenant\?\.vitrin_seo_optin === true, !tenant \|\| isNeverIndexTenant\(tenant, neverIndexList\)\)/);
    for (const f of ["src/app/vitrin/[slug]/page.tsx", "src/app/vitrin/[slug]/[id]/page.tsx", "src/app/danisman/[slug]/page.tsx"]) {
      expect(read(f), f).toMatch(/sample_seeded_at, sample_cleared_at/);
    }
  });
});

describe("vitrin /[slug] metadata <head> sözleşmesi (HIZ-05)", () => {
  const src = read("src/app/vitrin/[slug]/page.tsx");
  it("generateMetadata searchParams'a bağlı değil, kabukla aynı önbellekli veriyi kullanır", () => {
    const meta = src.slice(src.indexOf("export async function generateMetadata"), src.indexOf("/* ---------- Filtreli"));
    expect(meta).not.toContain("searchParams");
    expect(meta).toContain("loadOfficeHead(slug)");
    const page = src.slice(src.indexOf("export default async function VitrinPage"));
    expect(page).toContain("loadOfficeHead(slug)");
  });
  it("searchParams yalnız <Suspense> içindeki alt bileşenlerde okunur; vitrin kökünde loading sınırı yok", () => {
    const page = src.slice(src.indexOf("export default async function VitrinPage"));
    expect(page).not.toMatch(/await searchParams/);
    expect(page).toMatch(/<Suspense fallback=\{<GridFallback \/>\}>\s*<VitrinGrid/);
    expect(page).toMatch(/<Suspense fallback=\{<HeaderFiltersFallback \/>\}>\s*<VitrinHeaderFilters/);
    expect(() => read("src/app/vitrin/loading.tsx")).toThrow();
    expect(() => read("src/app/vitrin/[slug]/loading.tsx")).toThrow();
  });
  it("next.config htmlLimitedBots EKLENMEZ (seçenek A reddedildi)", () => {
    expect(read("next.config.ts")).not.toContain("htmlLimitedBots");
  });
});

describe("ilan başlığı ve açıklaması", () => {
  const empty = mergePatterns(null);
  const base = {
    office: "Gezertaş Emlak",
    title: "Deniz manzaralı 3+1",
    priceText: "5.000.000 ₺",
    district: "Kadıköy",
    province: "İstanbul",
    tx: "Satılık",
    type: "Daire",
    rooms: "3+1",
    sqm: 120,
    addressLine: "Moda Cd. 5 — demo adres",
  };

  it("varsayılan başlık markalı ve ≤60 karakter", () => {
    const t = resolveSeoPattern(empty, "listing", "title", listingSeoVars(base));
    expect(t).toBe("Deniz manzaralı 3+1 | Kadıköy Satılık Daire – Gezertaş Emlak");
    expect(t.length).toBeLessThanOrEqual(LISTING_TITLE_MAX);
  });
  it("uzun başlık kelime sınırında kısalır, marka korunur", () => {
    const long = { ...base, title: "Merkezi konumda geniş bahçeli havuzlu site içinde ultra lüks satılık villa fırsatı" };
    const t = resolveSeoPattern(empty, "listing", "title", listingSeoVars(long));
    expect(t.length).toBeLessThanOrEqual(LISTING_TITLE_MAX);
    expect(t.endsWith(" – Gezertaş Emlak")).toBe(true);
    const head = t.slice(0, -" – Gezertaş Emlak".length);
    expect(`${long.title} | Kadıköy Satılık Daire`.startsWith(head)).toBe(true);
    expect(/\s$/.test(head)).toBe(false);
  });
  it("çok uzun marka adında da ≤60", () => {
    const t = listingDefaultTitle({ ilan_basligi: "Daire", ofis: "Çok Uzun Adlı Gayrimenkul Danışmanlık ve Yatırım Ofisi Anonim Şirketi" });
    expect(t.length).toBeLessThanOrEqual(LISTING_TITLE_MAX);
  });
  it("eksik alanlar artık ayraç bırakmaz", () => {
    expect(listingDefaultTitle({ ilan_basligi: "Arsa", ofis: "Ofis" })).toBe("Arsa – Ofis");
    expect(listingDefaultTitle({ ilan_basligi: "Arsa", ilce: "Kepez", ofis: null })).toBe("Arsa | Kepez");
  });
  it("açıklama oda, m², fiyat ve ilçeden üretilir; ham adres ('demo adres') YOK", () => {
    const d = resolveSeoPattern(empty, "listing", "description", listingSeoVars(base));
    expect(d).toBe("Kadıköy Satılık Daire · 3+1 · 120 m² · 5.000.000 ₺ — Gezertaş Emlak güvencesiyle.");
    expect(d).not.toMatch(/demo adres|Moda Cd/i);
    expect(d.length).toBeLessThanOrEqual(160);
    const sparse = resolveSeoPattern(empty, "listing", "description", listingSeoVars({ ...base, rooms: null, sqm: null, district: null }));
    expect(sparse).toBe("Satılık Daire · 5.000.000 ₺ — Gezertaş Emlak güvencesiyle.");
  });
  it("yönetici kalıbı {konum} ile adresi bilerek kullanabilir (geri uyum)", () => {
    const pat = { ...empty, listing: { title: "", description: "{konum}" } };
    expect(resolveSeoPattern(pat, "listing", "description", listingSeoVars(base))).toContain("Moda Cd. 5");
  });
  it("gerçek özellikli tanım ve m² biçimi", () => {
    expect(listingFactLine(base)).toBe("Kadıköy Satılık Daire · 3+1 · 120 m² · 5.000.000 ₺");
    expect(listingFactLine({ title: null, office: null, priceText: null })).toBeNull();
    expect(sqmText("1500")).toBe("1.500 m²");
    expect(sqmText(0)).toBeNull();
  });
});

describe("JSON-LD: BreadcrumbList ve image[]", () => {
  const input = {
    base: "https://emlaksoft.com.tr",
    slug: "gezertasar-emlak",
    id: "abc",
    name: "Deniz manzaralı 3+1",
    description: "Kadıköy Satılık Daire · 3+1",
    officeName: "Gezertaş Emlak",
    imageIds: ["m1", "m2"],
    createdAt: "2026-10-01T00:00:00Z",
    price: 5_000_000,
    sqm: 120,
    district: "Kadıköy",
    province: "İstanbul",
  };
  const graphOf = (ld: Record<string, unknown>) => ld["@graph"] as Record<string, unknown>[];

  it("BreadcrumbList 3 öğe: Vitrin › İlçe › İlan", () => {
    const bc = vitrinListingBreadcrumbLd({ ...input, listingId: input.id, listingName: input.name });
    const items = bc.itemListElement as { position: number; name: string; item: string }[];
    expect(bc["@type"]).toBe("BreadcrumbList");
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(items[0]).toMatchObject({ name: "Gezertaş Emlak vitrini", item: "https://emlaksoft.com.tr/vitrin/gezertasar-emlak" });
    // Ara öğe kanonik vitrin URL'si (?q= araması boş dönebilir ve kanonik değildir).
    expect(items[1]).toMatchObject({ name: "Kadıköy", item: "https://emlaksoft.com.tr/vitrin/gezertasar-emlak" });
    expect(items.some((i) => i.item.includes("?"))).toBe(false);
    expect(items[2]).toMatchObject({ name: input.name, item: "https://emlaksoft.com.tr/vitrin/gezertasar-emlak/abc" });
    // İlçe yoksa il; ikisi de yoksa iki öğe.
    expect((vitrinListingBreadcrumbLd({ ...input, district: null, listingId: "abc", listingName: "x" }).itemListElement as unknown[])).toHaveLength(3);
    expect((vitrinListingBreadcrumbLd({ ...input, district: null, province: null, listingId: "abc", listingName: "x" }).itemListElement as unknown[])).toHaveLength(2);
  });
  it("image[] yalnız görsel varken basılır; RealEstateListing korunur, priceValidUntil yok", () => {
    const withImg = graphOf(buildVitrinListingLd(input));
    const listing = withImg.find((n) => n["@type"] === "RealEstateListing")!;
    expect(listing.image).toEqual(["https://emlaksoft.com.tr/api/property-media/m1", "https://emlaksoft.com.tr/api/property-media/m2"]);
    expect(JSON.stringify(listing.offers)).not.toContain("priceValidUntil");
    expect(withImg.some((n) => n["@type"] === "BreadcrumbList")).toBe(true);

    const noImg = graphOf(buildVitrinListingLd({ ...input, imageIds: [] }));
    expect("image" in noImg.find((n) => n["@type"] === "RealEstateListing")!).toBe(false);
    // En çok 10 görsel, tekrarsız.
    const many = graphOf(buildVitrinListingLd({ ...input, imageIds: [...Array.from({ length: 14 }, (_, i) => `m${i}`), "m0"] }));
    expect((many[0]!.image as string[]).length).toBe(10);
  });
  it("serializeJsonLd ile kaçışlı basılır (sayfa sözleşmesi)", () => {
    const s = serializeJsonLd(buildVitrinListingLd({ ...input, name: "</script><b>x</b>" }));
    expect(s).not.toContain("</script>");
    expect(read("src/app/vitrin/[slug]/[id]/page.tsx")).toContain("serializeJsonLd(jsonLd)");
    expect(read("src/app/vitrin/[slug]/[id]/page.tsx")).not.toContain("priceValidUntil");
  });
});

describe("alt metin", () => {
  it("{tip} {oda} – {ilçe}, fotoğraf n", () => {
    expect(listingImageAlt({ type: "Daire", rooms: "3+1", district: "Kadıköy" }, 2)).toBe("Daire 3+1 – Kadıköy, fotoğraf 2");
  });
  it("kullanıcı alt metni önceliklidir; eksik alanlar düşer", () => {
    expect(listingImageAlt({ type: "Daire" }, 1, "Salon, deniz manzarası")).toBe("Salon, deniz manzarası");
    expect(listingImageAlt({ type: "Arsa", province: "Antalya" }, 1)).toBe("Arsa – Antalya, fotoğraf 1");
    expect(listingImageAlt({ district: "Kepez" }, 3)).toBe("Kepez, fotoğraf 3");
    expect(listingImageAlt({ title: "Deniz manzaralı" }, 1)).toBe("Deniz manzaralı, fotoğraf 1");
    expect(listingImageAlt({}, 0)).toBe("Portföy, fotoğraf 1");
  });
  it("ilan galerisi üretilen alt metni kullanır", () => {
    expect(read("src/app/vitrin/[slug]/[id]/page.tsx")).toContain("alt: listingImageAlt(altInput, i + 1)");
  });
});

describe("istemci yükü", () => {
  it("LeadForm, SavedSearchBox, CompareBar ve FilterPanel görünür alana yaklaşınca yüklenir", () => {
    const islands = read("src/app/vitrin/[slug]/lazy-islands.tsx");
    expect(read("src/app/vitrin/[slug]/viewport-gate.ts")).toContain("IntersectionObserver");
    // Gözlem örnek başına (istemci gezinmesinde ada askıda kalmaz): lazy fabrikası DOM'u aramaz, kapıyı bekler.
    expect(islands).toContain("gate.watch(ref.current)");
    expect(islands).not.toContain("getElementById");
    for (const name of ["LazyLeadForm", "LazySavedSearchBox", "LazyCompareBar", "LazyFilterPanel"]) expect(islands).toContain(`export const ${name}`);
    const page = read("src/app/vitrin/[slug]/page.tsx");
    for (const imp of ['from "@/app/lead/[token]/lead-form"', 'from "@/components/public/saved-search-box"', 'from "./filter-panel"']) {
      expect(page).not.toContain(imp);
    }
    expect(page).not.toMatch(/import \{[^}]*\bCompareBar\b[^}]*\} from "@\/components\/public\/compare-select"/);
    expect(read("src/app/vitrin/[slug]/[id]/page.tsx")).not.toContain('from "@/app/lead/[token]/lead-form"');
  });
});
