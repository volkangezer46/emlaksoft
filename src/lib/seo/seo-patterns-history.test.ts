import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEO_PATTERNS,
  introDescription,
  renderSeoPattern,
  resolveSeoPattern,
  unknownPatternVars,
  vitrinRobots,
} from "./patterns";
import { mergePatterns, PatternsSchema } from "./schema";
import { isLocalReferrerHost, isLoggable404Path } from "./store";
import { levenshtein, notFoundCandidates, suggest404Target } from "./not-found-suggest";
import {
  SEO_HISTORY_MAX_BYTES,
  SEO_HISTORY_MAX_ENTRIES,
  diffSeoValues,
  isHistoryTracked,
  parseSeoHistory,
  pushSeoHistory,
  type SeoHistoryEntry,
} from "./history";
import { pageImpact, robotsImpact, robotsPatternMatches, sitemapImpact } from "@/app/admin/seo/noindex-impact";
import { mergeRobots, mergeSitemap } from "./schema";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("vitrinRobots: tek ölçüt ofisin arama onayı", () => {
  it("onay yok -> noindex, follow; onay var -> index, follow", () => {
    expect(vitrinRobots(false)).toEqual({ index: false, follow: true });
    expect(vitrinRobots(true)).toEqual({ index: true, follow: true });
  });
  it("vitrin, ilan ve danışman generateMetadata robots kararını vitrinRobots ile verir", () => {
    for (const f of ["src/app/vitrin/[slug]/page.tsx", "src/app/vitrin/[slug]/[id]/page.tsx", "src/app/danisman/[slug]/page.tsx"]) {
      const src = read(f);
      expect(src, f).toMatch(/robots: vitrinRobots\(/);
      expect(src, f).toContain("resolveSeoPattern(");
    }
    expect(read("src/app/danisman/[slug]/page.tsx")).toContain("vitrin_seo_optin");
  });
});

describe("ofis tanıtım regex düzeltmesi (/s+/g -> /\\s+/g)", () => {
  it("'s' harfleri silinmez, boşluklar sadeleşir", () => {
    expect(introDescription("ofis")).toBe("ofis");
    expect(introDescription("Satılık  ve\n\nkiralık   ofis")).toBe("Satılık ve kiralık ofis");
    expect(introDescription(null)).toBeNull();
    expect(introDescription("x".repeat(250))).toHaveLength(200);
  });
  it("vitrin sayfasında hatalı desen kalmadı", () => {
    expect(read("src/app/vitrin/[slug]/page.tsx")).not.toContain("replace(/s+/g");
  });
});

describe("dinamik kalıplar: varsayılan = bugünkü sabit çıktı", () => {
  const empty = mergePatterns(null);

  it("vitrin başlık ve açıklaması", () => {
    const name = "Demo Emlak Ofisi";
    const count = 12;
    expect(resolveSeoPattern(empty, "office", "title", { ofis: name, ilan_sayisi: count })).toBe(`${name} | Portföy Vitrini`);
    expect(resolveSeoPattern(null, "office", "description", { ofis: name, ilan_sayisi: count })).toBe(
      `${name} güncel portföy vitrini — ${count} aktif ilan. Satılık ve kiralık portföyleri inceleyin, yerinde inceleme için talep bırakın.`,
    );
    // Uzun ofis adında da varsayılan yol KESMEZ (bugünkü davranış).
    const long = "Çok Uzun Adlı Gayrimenkul Danışmanlık ve Yatırım Ofisi Anonim Şirketi Şubesi";
    expect(resolveSeoPattern(empty, "office", "title", { ofis: long })).toBe(`${long} | Portföy Vitrini`);
  });

  it("ilan başlık ve açıklaması (SP7: markalı başlık ≤60, açıklamada ham adres yok)", () => {
    const p = { title: "Deniz manzaralı 3+1", code: "ES-1", price: "5.000.000 ₺", type: "Daire", tx: "Satılık", tenant: "Demo Ofis" };
    const loc = "Moda Cd. 5, Kadıköy, İstanbul";
    const vars = { ofis: p.tenant, ilan_basligi: p.title || p.code, fiyat: p.price, konum: loc || "Türkiye", ilce: "Kadıköy", tip: p.type, islem: p.tx, oda: "3+1", metrekare: "120 m²" };
    expect(resolveSeoPattern(empty, "listing", "title", vars)).toBe(`${p.title} | Kadıköy ${p.tx} ${p.type} – ${p.tenant}`);
    const desc = resolveSeoPattern(empty, "listing", "description", vars);
    expect(desc).toBe(`Kadıköy ${p.tx} ${p.type} · 3+1 · 120 m² · ${p.price} — ${p.tenant} güvencesiyle.`);
    expect(desc).not.toContain("Moda Cd.");
  });

  it("danışman başlık ve açıklaması", () => {
    const name = "Ayşe Yılmaz";
    const office = "Demo Ofis";
    const role = "Kıdemli Danışman";
    const specialties = ["Konut", "Arsa"];
    const vars = {
      danisman: name,
      ofis: office,
      unvan: role,
      unvan_kucuk: role.toLocaleLowerCase("tr"),
      uzmanlik: specialties.length ? `Uzmanlık: ${specialties.join(", ")}. ` : "",
    };
    expect(resolveSeoPattern(empty, "agent", "title", vars)).toBe(`${name} — ${role} | ${office}`);
    expect(resolveSeoPattern(empty, "agent", "description", vars)).toBe(
      `${name}, ${office} bünyesinde ${role.toLocaleLowerCase("tr")}. Uzmanlık: Konut, Arsa. Portföyleri görün, tek tıkla arayın veya randevu alın.`,
    );
    expect(resolveSeoPattern(empty, "agent", "description", { ...vars, uzmanlik: "" })).toBe(
      `${name}, ${office} bünyesinde ${role.toLocaleLowerCase("tr")}. Portföyleri görün, tek tıkla arayın veya randevu alın.`,
    );
  });

  it("kayıtlı kalıp varsayılanın yerine geçer", () => {
    const pat = { ...empty, office: { title: "{ofis} ilanları ({ilan_sayisi})", description: "" } };
    expect(resolveSeoPattern(pat, "office", "title", { ofis: "Demo", ilan_sayisi: 3 })).toBe("Demo ilanları (3)");
    expect(resolveSeoPattern(pat, "office", "description", { ofis: "Demo", ilan_sayisi: 3 })).toBe(
      DEFAULT_SEO_PATTERNS.office.description.replace("{ofis}", "Demo").replace("{ilan_sayisi}", "3"),
    );
  });
});

describe("renderSeoPattern", () => {
  it("bilinmeyen/boş değişken boş kalır ve kenar/ardışık ayraçlar sadeleşir", () => {
    expect(renderSeoPattern("{ofis} | {yok} | Vitrin", { ofis: "Demo" })).toBe("Demo | Vitrin");
    expect(renderSeoPattern("{oda} · {tip} · {il}", { tip: "Daire", il: "İzmir" })).toBe("Daire · İzmir");
    expect(renderSeoPattern("  {ofis}   vitrini  ", { ofis: "Demo" })).toBe("Demo vitrini");
  });
  it("başlık 70, açıklama 160 karakterde kelime sınırında kesilir", () => {
    const words = Array.from({ length: 40 }, (_, i) => `kelime${i}`).join(" ");
    const t = renderSeoPattern(words, {}, "title");
    expect(t.length).toBeLessThanOrEqual(70);
    expect(words.startsWith(t)).toBe(true);
    expect(words.charAt(t.length)).toBe(" ");
    const d = renderSeoPattern(words, {}, "description");
    expect(d.length).toBeLessThanOrEqual(160);
    expect(words.charAt(d.length)).toBe(" ");
    // Boşluksuz uzun metin sert kesilir.
    expect(renderSeoPattern("x".repeat(90), {}, "title")).toHaveLength(70);
  });
  it("HTML karakteri: değerlerdeki < > atılır, & korunur (Next metadata kaçışlar)", () => {
    expect(renderSeoPattern("{ofis} | Vitrin", { ofis: "<script>A&B</script>" })).toBe("scriptA&B/script | Vitrin");
    expect(PatternsSchema.safeParse({ office: { title: "<b>{ofis}</b>" } }).success).toBe(false);
    expect(PatternsSchema.safeParse({ office: { title: "x".repeat(201) } }).success).toBe(false);
    expect(PatternsSchema.safeParse({ office: { title: "{ofis} & ortakları" } }).success).toBe(true);
  });
  it("varlığa uymayan değişken uyarısı", () => {
    expect(unknownPatternVars("{ofis} {fiyat} {abc}", "office")).toEqual(["fiyat", "abc"]);
    expect(unknownPatternVars("{ilan_basligi} - {fiyat}", "listing")).toEqual([]);
  });
});

describe("404 gürültüsü", () => {
  it.each([
    ["/zup.php73", false],
    ["/index.php", false],
    ["/a.php5/x", false],
    ["/wp-login", false],
    ["/pricing", true],
    ["/fiyatlar-eski", true],
  ])("isLoggable404Path(%s) = %s", (path, expected) => {
    expect(isLoggable404Path(path)).toBe(expected);
  });
  it.each([
    ["127.0.0.1", true],
    ["127.0.0.1:3999", true],
    ["localhost:3000", true],
    ["::1", true],
    ["[::1]:3000", true],
    ["emlaksoft.com.tr", false],
    [null, false],
  ])("isLocalReferrerHost(%s) = %s", (host, expected) => {
    expect(isLocalReferrerHost(host)).toBe(expected);
  });
  it("logNotFound yerel yönlendireni yazmaz", () => {
    expect(read("src/lib/seo/store.ts")).toMatch(/isLocalReferrerHost\(referrerHost\)\) return;/);
  });
});

describe("404 önerisi", () => {
  const candidates = notFoundCandidates([]);
  it("takma ad: /pricing -> /fiyatlar, /login -> /giris, /signup -> /kayit", () => {
    expect(suggest404Target("/pricing", candidates)).toBe("/fiyatlar");
    expect(suggest404Target("/Pricing/", candidates)).toBe("/fiyatlar");
    expect(suggest404Target("/login", candidates)).toBe("/giris");
    expect(suggest404Target("/signup", candidates)).toBe("/kayit");
    expect(suggest404Target("/tools", candidates)).toBe("/araclar");
  });
  it("yakın yazım ve önek", () => {
    expect(suggest404Target("/fiyatlr", candidates)).toBe("/fiyatlar");
    expect(suggest404Target("/fiyat", candidates)).toBe("/fiyatlar");
  });
  it("eşleşme yoksa ya da hedef sitede yoksa null", () => {
    expect(suggest404Target("/xyz", candidates)).toBeNull();
    // /hakkimizda sitede yoksa öneri yapılmaz.
    expect(suggest404Target("/about", ["/fiyatlar"])).toBeNull();
    expect(suggest404Target("/about", ["/fiyatlar", "/hakkimizda"])).toBe("/hakkimizda");
  });
  it("mevcut yönlendirme hedefleri aday olur", () => {
    const c = notFoundCandidates([{ id: "abcdef12", from: "/eski", to: "/kampanya-ekim", status: 308, enabled: true }]);
    expect(c).toContain("/kampanya-ekim");
    expect(suggest404Target("/kampanya-ekm", c)).toBe("/kampanya-ekim");
  });
  it("levenshtein", () => {
    expect(levenshtein("fiyatlar", "fiyatlr")).toBe(1);
    expect(levenshtein("", "abc")).toBe(3);
  });
});

describe("SEO geçmişi halkası", () => {
  const entry = (i: number, prev: string | null = `{"n":${i}}`): SeoHistoryEntry => ({
    id: `id${i}`,
    key: "global",
    at: `2026-10-13T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
    by: null,
    prev,
  });

  it("en yeni başta, en çok 30 kayıt", () => {
    let list: SeoHistoryEntry[] = [];
    for (let i = 0; i < 45; i++) list = pushSeoHistory(list, entry(i));
    expect(list).toHaveLength(SEO_HISTORY_MAX_ENTRIES);
    expect(list[0]!.id).toBe("id44");
    expect(list.at(-1)!.id).toBe("id15");
  });
  it("300 KB sınırı: eskiler düşer, en yeni kayıt kalır", () => {
    const big = JSON.stringify({ x: "a".repeat(100 * 1024) });
    let list: SeoHistoryEntry[] = [];
    for (let i = 0; i < 5; i++) list = pushSeoHistory(list, entry(i, big));
    expect(new TextEncoder().encode(JSON.stringify(list)).length).toBeLessThanOrEqual(SEO_HISTORY_MAX_BYTES);
    expect(list[0]!.id).toBe("id4");
    expect(list.length).toBeLessThan(5);
  });
  it("denetim ve IndexNow anahtarları halkaya girmez", () => {
    expect(isHistoryTracked("indexnow")).toBe(false);
    expect(isHistoryTracked("indexnowSeen")).toBe(false);
    expect(isHistoryTracked("auditLatest")).toBe(false);
    expect(isHistoryTracked("auditHistory")).toBe(false);
    expect(isHistoryTracked("history")).toBe(false);
    for (const k of ["global", "pages", "sitemap", "robots", "redirects", "patterns"] as const) expect(isHistoryTracked(k)).toBe(true);
    expect(parseSeoHistory(JSON.stringify([{ ...entry(1), key: "indexnow" }, entry(2)]))).toHaveLength(1);
    expect(parseSeoHistory("bozuk")).toEqual([]);
  });
  it("writeSeoSetting geçmişi yazmadan önce ekler", () => {
    const src = read("src/lib/seo/store.ts");
    const fn = src.slice(src.indexOf("export async function writeSeoSetting"));
    expect(fn.indexOf("appendSeoHistory(")).toBeLessThan(fn.indexOf("setPlatformSetting(SEO_KEYS[keyName]"));
  });
  it("alan farkı", () => {
    const { diffs, total } = diffSeoValues(
      JSON.stringify({ siteName: "A", organization: { sameAs: ["x"] } }),
      JSON.stringify({ siteName: "B", organization: { sameAs: ["x", "y"] } }),
    );
    expect(total).toBe(2);
    expect(diffs).toEqual([
      { path: "organization.sameAs[1]", before: null, after: "y" },
      { path: "siteName", before: "A", after: "B" },
    ]);
    expect(diffSeoValues(null, "{}").total).toBe(0);
  });
});

describe("kazara noindex koruması", () => {
  it("sayfa: noindex/sitemap dışı seçimi 1 URL", () => {
    expect(pageImpact({ path: "/fiyatlar", currentlyIndexable: true, currentlyInSitemap: true, nextIndexable: false, nextInSitemap: false }).count).toBe(1);
    expect(pageImpact({ path: "/fiyatlar", currentlyIndexable: true, currentlyInSitemap: true, nextIndexable: true, nextInSitemap: true }).count).toBe(0);
    expect(pageImpact({ path: "/giris", currentlyIndexable: false, currentlyInSitemap: false, nextIndexable: false, nextInSitemap: false }).count).toBe(0);
  });
  it("sitemap: kapatılan grup sayısı önizlemeden", () => {
    const urls = ["https://x.tr/", "https://x.tr/fiyatlar", "https://x.tr/araclar", "https://x.tr/araclar/kira", "https://x.tr/vitrin/a", "https://x.tr/vitrin/a/1", "https://x.tr/danisman/b"];
    const cur = mergeSitemap(null);
    expect(sitemapImpact(urls, cur, { ...cur, tools: false }, []).count).toBe(2);
    expect(sitemapImpact(urls, cur, { ...cur, vitrinListings: false, advisors: false }, []).count).toBe(2);
    expect(sitemapImpact(urls, cur, cur, []).count).toBe(0);
  });
  it("robots: yeni Disallow yoluna düşen adresler", () => {
    const urls = ["https://x.tr/fiyatlar", "https://x.tr/araclar/kira", "https://x.tr/araclar/kredi"];
    const cur = mergeRobots(null);
    expect(robotsImpact(urls, cur, { extraDisallow: ["/araclar/"], blockedAiBots: [] }).count).toBe(2);
    expect(robotsImpact(urls, { ...cur, extraDisallow: ["/araclar/"] }, { extraDisallow: ["/araclar/"], blockedAiBots: [] }).count).toBe(0);
    expect(robotsImpact(urls, cur, { extraDisallow: [], blockedAiBots: ["GPTBot"] }).details).toHaveLength(1);
    expect(robotsPatternMatches("/vitrin/*/favoriler", "/vitrin/a/favoriler")).toBe(true);
    expect(robotsPatternMatches("/fiyatlar$", "/fiyatlar/x")).toBe(false);
  });
});
