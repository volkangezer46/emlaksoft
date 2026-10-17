import { describe, expect, it } from "vitest";
import {
  computeHubs,
  hubChildren,
  hubCrumbs,
  hubDecision,
  hubDescription,
  hubFaq,
  hubIntro,
  hubJsonLd,
  hubPath,
  hubStats,
  hubTitle,
  intentSlug,
  listingsForHub,
  locative,
  median,
  parseHubSegments,
  parseIntentSegment,
  roomsSlugOf,
  statsOptionsFor,
  txSlugOf,
  type HubListing,
} from "./hubs/rules";
import { aggregateQueries, cannibalization, opportunities, topQueryByPage, winnersLosers, type KwPair } from "./keywords";
import { gscPathMaps, recommend } from "./recommend";
import { scorePage } from "./score";
import { validateStructuredData } from "./structured-data";
import { atesman, scoreContent } from "./content-score";
import { AI_ANSWER_BOTS, geoReadiness } from "./geo";
import { DEFAULT_SEO_GLOBAL, DEFAULT_ROBOTS, DEFAULT_HUBS } from "./schema";
import type { RichBlock } from "@/lib/rich-text/core";
import { buildLlmsFullTxt } from "./robots-rules";

const L = (i: number, over: Partial<HubListing> = {}): HubListing => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  tenantId: i % 2 ? "t1" : "t2",
  officeSlug: i % 2 ? "ofis-a" : "ofis-b",
  officeName: i % 2 ? "Ofis A" : "Ofis B",
  title: `İlan ${i}`,
  tx: "satilik",
  type: "daire",
  typeLabel: "Daire",
  rooms: { slug: "2-1", label: "2+1" },
  il: { slug: "istanbul", name: "İstanbul" },
  ilce: { slug: "kadikoy", name: "Kadıköy" },
  mahalle: { slug: "moda", name: "Moda" },
  priceTry: 5_000_000 + i * 100_000,
  priceText: "₺5.000.000",
  sqm: 100,
  updatedAt: `2026-10-${String(10 + (i % 5)).padStart(2, "0")}T00:00:00Z`,
  href: `/vitrin/ofis/ilan-${i}`,
  ...over,
});

describe("programatik bölge sayfaları: yol ve eşik", () => {
  it("işlem ve oda normalizasyonu", () => {
    expect(txSlugOf("sale")).toBe("satilik");
    expect(txSlugOf("rent")).toBe("kiralik");
    expect(txSlugOf("daily-rent")).toBe("gunluk-kiralik");
    expect(txSlugOf("bilinmeyen")).toBeNull();
    expect(roomsSlugOf("3+1")).toEqual({ slug: "3-1", label: "3+1" });
    expect(roomsSlugOf("3 + 1")).toEqual({ slug: "3-1", label: "3+1" });
    expect(roomsSlugOf("geniş")).toBeNull();
  });

  it("niyet ve yol ayrıştırma; geçersiz biçim reddedilir", () => {
    expect(intentSlug({ tx: "kiralik", type: "daire", rooms: { slug: "2-1", label: "2+1" } })).toBe("kiralik-2-1-daire");
    expect(parseIntentSegment("kiralik-2-1-daire")).toEqual({ tx: "kiralik", rooms: "2-1", type: "daire" });
    expect(parseIntentSegment("gunluk-kiralik-villa")).toEqual({ tx: "gunluk-kiralik", type: "villa" });
    expect(parseIntentSegment("moda")).toBeNull();
    expect(parseHubSegments([])).toBe("root");
    expect(parseHubSegments(["istanbul"])).toEqual({ il: "istanbul" });
    expect(parseHubSegments(["istanbul", "satilik-daire"])).toEqual({ il: "istanbul", intent: "satilik-daire" });
    expect(parseHubSegments(["istanbul", "kadikoy", "satilik-daire"])).toEqual({ il: "istanbul", ilce: "kadikoy", intent: "satilik-daire" });
    expect(parseHubSegments(["istanbul", "kadikoy", "moda", "satilik-villa"])).toEqual({ il: "istanbul", ilce: "kadikoy", mahalle: "moda", intent: "satilik-villa" });
    expect(parseHubSegments(["istanbul", "kadikoy", "moda"])).toBeNull(); // niyetsiz mahalle yok
    expect(parseHubSegments(["Istanbul"])).toBeNull();
    expect(parseHubSegments(["istanbul", "kadikoy", "satilik-daire", "fazla"])).toBeNull();
    expect(hubPath({ il: "istanbul", ilce: "kadikoy", intent: "satilik-daire" })).toBe("/emlak/istanbul/kadikoy/satilik-daire");
  });

  it("EŞİK: ≥N index, 1..N-1 noindex, 0 ya da kapalı 404", () => {
    const s = { enabled: true, minListings: 5 };
    expect(hubDecision(5, s)).toBe("index");
    expect(hubDecision(12, s)).toBe("index");
    expect(hubDecision(4, s)).toBe("noindex");
    expect(hubDecision(1, s)).toBe("noindex");
    expect(hubDecision(0, s)).toBe("notfound");
    expect(hubDecision(50, { enabled: false, minListings: 5 })).toBe("notfound");
  });

  it("hub kümesi: düzeyler, oda niyeti, elle kapatma; sayılar gerçek ilan", () => {
    const list = [1, 2, 3, 4, 5, 6].map((i) => L(i));
    list.push(L(7, { tx: "kiralik", rooms: null, mahalle: null }));
    const hubs = computeHubs(list, DEFAULT_HUBS);
    const by = (p: string) => hubs.find((h) => h.path === p);
    expect(by("/emlak/istanbul")?.count).toBe(7);
    expect(by("/emlak/istanbul/kadikoy/satilik-daire")?.count).toBe(6);
    expect(by("/emlak/istanbul/kadikoy/satilik-2-1-daire")?.count).toBe(6);
    expect(by("/emlak/istanbul/kadikoy/kiralik-daire")?.count).toBe(1);
    expect(by("/emlak/istanbul/kadikoy/moda/satilik-daire")?.count).toBe(6);
    expect(by("/emlak/istanbul/kadikoy/moda/kiralik-daire")).toBeUndefined();
    const noRooms = computeHubs(list, { ...DEFAULT_HUBS, roomIntents: false, levels: ["ilce"], disabledPaths: ["/emlak/istanbul/kadikoy/kiralik-daire"] });
    expect(noRooms.some((h) => h.path.includes("2-1"))).toBe(false);
    expect(noRooms.some((h) => h.level !== "ilce")).toBe(false);
    expect(noRooms.find((h) => h.path === "/emlak/istanbul/kadikoy/kiralik-daire")).toBeUndefined();
    expect(listingsForHub(list, { il: "istanbul", ilce: "kadikoy", intent: "kiralik-daire" })).toHaveLength(1);
    expect(hubChildren(hubs, { il: "istanbul", ilce: "kadikoy" }).every((h) => h.ref.ilce === "kadikoy" && Boolean(h.ref.intent))).toBe(true);
  });

  it("istatistik: medyan tam ₺, küçük örneklemde fiyat yok, satılık/kiralık karışmaz", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3); // (2+3)/2 = 2.5 → yuvarlanır
    expect(median([])).toBeNull();
    const list = [1, 2, 3, 4, 5].map((i) => L(i));
    const st = hubStats(list, statsOptionsFor({ tx: "satilik", type: "daire", typeLabel: "Daire" }));
    expect(st.medianPrice).toBe(5_300_000);
    expect(st.medianPricePerSqm).toBe(53_000);
    expect(st.offices).toBe(2);
    expect(hubStats(list.slice(0, 2)).medianPrice).toBeNull(); // < 3 ilan: medyan yok
    expect(hubStats(list, statsOptionsFor(undefined)).medianPrice).toBeNull(); // niyetsiz hub: fiyat yok
    expect(hubStats(list, statsOptionsFor({ tx: "kiralik", type: "daire", typeLabel: "Daire" })).medianPricePerSqm).toBeNull();
  });

  it("Türkçe metin: bulunma eki, başlık, giriş, SSS yalnız gerçek veriden", () => {
    expect(locative("Kadıköy")).toBe("Kadıköy'de");
    expect(locative("Beşiktaş")).toBe("Beşiktaş'ta");
    expect(locative("Üsküdar")).toBe("Üsküdar'da");
    expect(locative("Ataşehir")).toBe("Ataşehir'de");
    expect(locative("Kartal")).toBe("Kartal'da");
    const list = [1, 2, 3, 4, 5].map((i) => L(i));
    const hub = computeHubs(list, DEFAULT_HUBS).find((h) => h.path === "/emlak/istanbul/kadikoy/satilik-daire")!;
    const st = hubStats(list, statsOptionsFor(hub.intent));
    expect(hubTitle(hub)).toBe("Kadıköy satılık daire ilanları");
    expect(hubDescription(hub, st)).toContain("₺5.300.000");
    expect(hubIntro(hub, st).join(" ")).toContain("5 satılık daire");
    const faq = hubFaq(hub, st);
    expect(faq[0]!.q).toBe("Kadıköy'de kaç satılık daire var?");
    expect(faq.some((f) => f.a.includes("₺53.000"))).toBe(true);
    const thin = hubStats(list.slice(0, 1), statsOptionsFor(hub.intent));
    expect(hubFaq(hub, thin).some((f) => /fiyat|metrekare/.test(f.q))).toBe(false); // küçük örneklemde fiyat sorusu yok
  });

  it("JSON-LD: CollectionPage + ItemList + BreadcrumbList + FAQPage geçerli", () => {
    const list = [1, 2, 3].map((i) => L(i));
    const hub = computeHubs(list, DEFAULT_HUBS).find((h) => h.path === "/emlak/istanbul/kadikoy/satilik-daire")!;
    const crumbs = hubCrumbs(hub);
    expect(crumbs[crumbs.length - 1]!.path).toBeUndefined();
    const ld = hubJsonLd({ base: "https://emlaksoft.com.tr", path: hub.path, name: "Kadıköy satılık daire", description: "d", listings: list, crumbs, faq: hubFaq(hub, hubStats(list, statsOptionsFor(hub.intent))) });
    const r = validateStructuredData(ld);
    expect(r.errors).toEqual([]);
    expect(r.types).toEqual(expect.arrayContaining(["CollectionPage", "ItemList", "BreadcrumbList", "FAQPage"]));
  });
});

const P = (query: string, page: string, impressions: number, position: number, prevImpressions = impressions, prevPosition = position, clicks = Math.round(impressions * 0.02)): KwPair => ({
  query,
  page,
  clicks,
  impressions,
  position,
  prevClicks: clicks,
  prevImpressions,
  prevPosition,
});

describe("anahtar kelime analizi", () => {
  const pairs = [
    P("emlak crm", "https://x/", 1000, 6, 900, 9),
    P("emlak yazılımı", "https://x/fiyatlar", 500, 3.5, 500, 2),
    P("komisyon hesaplama", "https://x/araclar/komisyon-hesaplama", 300, 12),
    P("komisyon hesaplama", "https://x/rehber/komisyon", 200, 14),
    P("az görünen", "https://x/a", 5, 30),
  ];

  it("sorgu toplamı ve gösterim ağırlıklı pozisyon", () => {
    const rows = aggregateQueries(pairs);
    const k = rows.find((r) => r.query === "komisyon hesaplama")!;
    expect(k.impressions).toBe(500);
    expect(k.position).toBeCloseTo((300 * 12 + 200 * 14) / 500, 5);
    expect(k.pages).toBe(2);
    expect(k.topPage).toBe("https://x/araclar/komisyon-hesaplama");
  });

  it("kazanan/kaybeden pozisyon farkıyla", () => {
    const { winners, losers } = winnersLosers(aggregateQueries(pairs));
    expect(winners.map((w) => w.query)).toEqual(["emlak crm"]);
    expect(winners[0]!.delta).toBe(3);
    expect(losers.map((l) => l.query)).toEqual(["emlak yazılımı"]);
  });

  it("fırsat: 4–20. sıra + yüksek gösterim; ilk 3 ve az gösterimli dışarıda", () => {
    const o = opportunities(aggregateQueries(pairs));
    expect(o.map((x) => x.query)).toEqual(["emlak crm", "komisyon hesaplama"]);
    expect(o[0]!.extraClicks).toBeGreaterThan(0);
  });

  it("yamyamlık: aynı sorguda iki sayfa anlamlı pay alıyor", () => {
    const c = cannibalization(pairs);
    expect(c).toHaveLength(1);
    expect(c[0]!.query).toBe("komisyon hesaplama");
    expect(c[0]!.pages.map((p) => p.page)).toEqual(["https://x/araclar/komisyon-hesaplama", "https://x/rehber/komisyon"]);
    expect(topQueryByPage(pairs).get("https://x/fiyatlar")).toBe("emlak yazılımı");
  });
});

describe("tavsiye motoru", () => {
  const base = {
    url: "https://x/fiyatlar",
    status: 200,
    inSitemap: true,
    noindex: false,
    title: "Paketler | EmlakSoft",
    description: null,
    canonical: "https://x/fiyatlar",
    h1: "Paketler",
    h1Count: 1,
    headingSkip: null,
    words: 900,
    imgs: 0,
    imgsNoAlt: 0,
    linksOut: 5,
    linksIn: 3,
    ldTypes: ["BreadcrumbList"],
    ldErrors: 0,
    ldWarnings: 0,
    ldParseErrors: 0,
    bytes: 50_000,
    ttfbMs: 100,
    mixed: 0,
    dupTitle: false,
    dupDescription: false,
    robotsBlocked: false,
  };

  it("etki × kolaylık sıralı, sorgu metni Türkçe ve somut, her öneri bir ekrana bağlı", () => {
    const score = scorePage(base, { nowMs: 0, topQuery: "emlak yazılımı fiyatları" });
    const pairs = [P("emlak yazılımı fiyatları", "https://x/fiyatlar", 1200, 7)];
    const maps = gscPathMaps(pairs);
    const recs = recommend({ pages: [{ score, inSitemap: true, noindex: false, isRegistry: true }], impressionsByPath: maps.impressions, topQueryByPath: maps.topQuery, opportunities: opportunities(aggregateQueries(pairs)) });
    expect(recs.length).toBeGreaterThan(0);
    for (let i = 1; i < recs.length; i += 1) expect(recs[i - 1]!.priority).toBeGreaterThanOrEqual(recs[i]!.priority);
    const kw = recs.find((r) => r.id.endsWith("kw-title"))!;
    expect(kw.title).toContain("“emlak yazılımı fiyatları” geçmiyor");
    expect(kw.detail).toContain("1.200");
    expect(kw.href).toBe("/admin/site/seo?sekme=sayfalar&sayfa=%2Ffiyatlar#editor");
    const opp = recs.find((r) => r.source === "arama")!;
    expect(opp.estimate).toMatch(/tahmini/);
    expect(recs.every((r) => r.href.startsWith("/admin/"))).toBe(true);
  });

  it("veri yoksa öneri yok", () => {
    expect(recommend({ pages: [] })).toEqual([]);
  });
});

describe("rehber içerik puanı", () => {
  const body = (n: number, extra: RichBlock[] = []): RichBlock[] => [
    { type: "p", text: "Kadıköy satılık daire alırken tapu masrafı ve krediyi birlikte düşünün. [Tapu masrafı](/araclar/tapu-masrafi-hesaplama) aracını kullanın." },
    { type: "h2", text: "Kadıköy satılık daire fiyatları" },
    ...Array.from({ length: n }, (_, i): RichBlock => ({ type: "p", text: `Bu bölümde ev alırken dikkat edilecek kısa ve net bir konu var. Örnek ${i}. Fiyatı ve konumu karşılaştırın.` })),
    { type: "h2", text: "Kredi" },
    { type: "h2", text: "Sonuç" },
    ...extra,
  ];

  it("Ateşman: kısa cümle/kısa sözcük kolay; çok kısa metin ölçülmez", () => {
    expect(atesman("Ev al.")).toBeNull();
    const easy = atesman(Array.from({ length: 20 }, () => "Bu ev çok iyi. Fiyatı uygun.").join(" "))!;
    expect(easy.score).toBeGreaterThanOrEqual(70);
  });

  it("odak kelime kontrolleri ve yoğunluk; doldurma cezalandırılır", () => {
    const r = scoreContent({ title: "Kadıköy satılık daire rehberi", seoTitle: "Kadıköy satılık daire alırken bilinmesi gerekenler", seoDescription: "Kadıköy satılık daire alırken fiyat, tapu masrafı ve kredi konularında bilmeniz gerekenler, adım adım rehber.", body: body(40), focusKeyword: "kadıköy satılık daire", titleTemplate: "%s | EmlakSoft" });
    expect(r.checks.find((c) => c.id === "kw-title")?.ratio).toBe(1);
    expect(r.checks.find((c) => c.id === "kw-h2")?.ratio).toBe(1);
    expect(r.density).not.toBeNull();
    const stuffed = scoreContent({ title: "x", seoTitle: "x", seoDescription: "", body: Array.from({ length: 30 }, (): RichBlock => ({ type: "p", text: "kadıköy satılık daire kadıköy satılık daire" })), focusKeyword: "kadıköy satılık daire" });
    expect(stuffed.checks.find((c) => c.id === "kw-density")?.ratio).toBe(0);
    expect(r.total).toBeGreaterThan(stuffed.total);
  });

  it("SSS bloğu ve iç bağlantı ödüllendirilir", () => {
    const without = scoreContent({ title: "a", seoTitle: "", seoDescription: "", body: body(10) });
    const withFaq = scoreContent({ title: "a", seoTitle: "", seoDescription: "", body: body(10, [{ type: "faq", items: [{ q: "Soru?", a: "Cevap [bkz](/rehber) ve [araç](/araclar/komisyon-hesaplama)." }] }]) });
    expect(withFaq.checks.find((c) => c.id === "answer")?.ratio).toBe(1);
    expect(withFaq.checks.find((c) => c.id === "internal-links")!.ratio).toBeGreaterThan(without.checks.find((c) => c.id === "internal-links")!.ratio);
  });
});

describe("GEO hazırlığı ve llms-full.txt", () => {
  it("yanıt botu engeli puanı düşürür, eğitim botu engeli düşürmez", () => {
    const base = { global: DEFAULT_SEO_GLOBAL, robots: { ...DEFAULT_ROBOTS, llmsTxtEnabled: true }, indexablePages: 10, faqPages: 4, ldCleanPages: 10, guides: 12 };
    const open = geoReadiness(base).score;
    expect(geoReadiness({ ...base, robots: { ...base.robots, blockedAiBots: ["GPTBot", "CCBot"] } }).score).toBe(open);
    expect(geoReadiness({ ...base, robots: { ...base.robots, blockedAiBots: [AI_ANSWER_BOTS[0]!] } }).score).toBeLessThan(open);
  });

  it("llms-full.txt kapalıyken null; açıkken rehber metni ve bölge sayfaları, boyut sınırı", () => {
    expect(buildLlmsFullTxt(DEFAULT_SEO_GLOBAL, DEFAULT_ROBOTS, "https://x", {}, { guides: [], hubs: [] })).toBeNull();
    const out = buildLlmsFullTxt(DEFAULT_SEO_GLOBAL, { ...DEFAULT_ROBOTS, llmsTxtEnabled: true }, "https://x", {}, {
      guides: [{ title: "Tapu masrafı", path: "/rehber/tapu", description: "Özet", text: "Tapu harcı alıcı ve satıcıya aittir." }],
      hubs: [{ title: "Kadıköy satılık daire ilanları", path: "/emlak/istanbul/kadikoy/satilik-daire", count: 12 }],
    })!;
    expect(out).toContain("## Tapu masrafı");
    expect(out).toContain("https://x/rehber/tapu");
    expect(out).toContain("Tapu harcı alıcı");
    expect(out).toContain("https://x/emlak/istanbul/kadikoy/satilik-daire): 12 ilan");
    const huge = buildLlmsFullTxt(DEFAULT_SEO_GLOBAL, { ...DEFAULT_ROBOTS, llmsTxtEnabled: true }, "https://x", {}, { guides: Array.from({ length: 10 }, (_, i) => ({ title: `Y${i}`, path: `/rehber/y${i}`, description: "", text: "a ".repeat(60_000) })), hubs: [] })!;
    expect(huge).toMatch(/Boyut sınırı nedeniyle \d+ yazı eklenmedi/);
  });
});
