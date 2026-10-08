import { describe, expect, it } from "vitest";
import { getHtmlAdapter, PARSER_VERSION, PORTAL_RULES_VERSION } from "./index";
import { buildFixture, fixtureProfile, FIXTURE_PORTALS, type Scenario } from "./test-fixtures";
import { currencyHint, extractMeta, extractStates, normalizeTlPrice, stripSiteSuffix, visibleText } from "./parse-layers";
import { replyToReport } from "../../worker/core";

/**
 * Portal başına katmanlı ayrıştırıcı testleri — SENTETİK sayfalar (`test-fixtures.ts`; gerçek portal sayfası kopyalanmadı,
 * GERÇEK SAYFAYA KARŞI DOĞRULANMADI). Her portal için: yayında (JSON-LD / meta / durum JSON'u / DOM), kaldırıldı, bulunamadı
 * (404/410), engel (captcha, giriş, hız sınırı, 403), belirsiz (tanınmayan yapı, ilan no uyuşmazlığı, çelişen işaret).
 */

const SEEN = "2026-10-08T10:00:00.000Z";

type Expect = {
  classification: "live" | "removed" | "not_found" | "blocked" | "unknown";
  result: "present" | "absent" | "blocked" | "error";
  layer?: string;
  price?: number | null;
  error?: string;
  partial?: boolean;
  drift?: boolean;
};

const TABLE: Record<Scenario, (priceNum: number) => Expect> = {
  live_jsonld: (p) => ({ classification: "live", result: "present", layer: "json_ld", price: p, partial: false }),
  live_meta: (p) => ({ classification: "live", result: "present", layer: "meta", price: p, partial: false }),
  live_state_next: (p) => ({ classification: "live", result: "present", layer: "state", price: p, partial: false }),
  live_state_window: (p) => ({ classification: "live", result: "present", layer: "state", price: p, partial: false }),
  live_dom: (p) => ({ classification: "live", result: "present", layer: "pattern", price: p, partial: false }),
  live_usd: () => ({ classification: "live", result: "present", layer: "json_ld", price: null, partial: true }),
  live_dom_phrase_in_script: (p) => ({ classification: "live", result: "present", layer: "pattern", price: p, partial: false }),
  live_dom_no_price: () => ({ classification: "live", result: "present", layer: "pattern", price: null, partial: true }),
  removed_text: () => ({ classification: "removed", result: "absent" }),
  removed_state: () => ({ classification: "removed", result: "absent" }),
  not_found_404: () => ({ classification: "not_found", result: "absent" }),
  gone_410: () => ({ classification: "not_found", result: "absent" }),
  captcha: () => ({ classification: "blocked", result: "blocked", error: "captcha" }),
  captcha_status_200_large_live_like: () => ({ classification: "unknown", result: "error", error: "unexpected_structure", drift: true }),
  login_redirect: () => ({ classification: "blocked", result: "blocked", error: "login_required" }),
  rate_limited: () => ({ classification: "blocked", result: "blocked", error: "http_429" }),
  forbidden: () => ({ classification: "blocked", result: "blocked", error: "http_403" }),
  server_error: () => ({ classification: "unknown", result: "blocked", error: "http_503" }),
  unknown_structure: () => ({ classification: "unknown", result: "error", error: "unexpected_structure", drift: true }),
  id_mismatch: () => ({ classification: "unknown", result: "error", error: "id_mismatch" }),
  conflicting_signals: () => ({ classification: "unknown", result: "error", error: "conflicting_signals" }),
  redirected_out: () => ({ classification: "unknown", result: "error", error: "redirected" }),
};

describe.each(FIXTURE_PORTALS)("%s ayrıştırıcı fixture'ları", (portal) => {
  const adapter = getHtmlAdapter(portal)!;
  const prof = fixtureProfile(portal);

  it.each(Object.keys(TABLE) as Scenario[])("%s", (scenario) => {
    const { page, expectedId } = buildFixture(portal, scenario);
    const exp = TABLE[scenario](prof.priceNum);
    const reply = adapter.parseListing(page, expectedId);
    expect(reply.classification).toBe(exp.classification);
    expect(reply.parserVersion).toBe(PARSER_VERSION);
    expect(replyToReport(reply, SEEN).result).toBe(exp.result);
    if (exp.error) expect(reply.error).toBe(exp.error);
    else expect(reply.error ?? null).toBeNull();
    if (exp.layer) expect(reply.layer).toBe(exp.layer);
    if (exp.price !== undefined) expect(reply.price ?? null).toBe(exp.price);
    if (exp.partial !== undefined) expect(reply.partial).toBe(exp.partial);
    if (exp.drift) expect(reply.drift).toBe(true);
    if (exp.classification === "live" && exp.price !== null) {
      expect(reply.title).toBe(prof.title);
    }
  });

  it("yayında sayfada ilan sahibi adı okunur (JSON-LD / durum / DOM)", () => {
    for (const s of ["live_jsonld", "live_state_next", "live_dom"] as const) {
      const { page, expectedId } = buildFixture(portal, s);
      expect(adapter.parseListing(page, expectedId).advisorName, s).toBe(prof.advisor);
    }
  });

  it("benzer ilan kutusundaki başka ilan no yanlışlıkla eşleşmez (durum JSON'unda)", () => {
    const { page } = buildFixture(portal, "live_state_next");
    const r = adapter.parseListing(page, "999999999");
    // Beklenen id yalnız 'benzer' kutusundadır: o nesnenin alanları okunur; ana ilanın fiyatı karışmaz.
    expect(r.price ?? null).not.toBe(prof.priceNum);
  });

  it("hiçbir engel/belirsizlik 'yok' (absent) sayılmaz", () => {
    for (const s of ["captcha", "login_redirect", "rate_limited", "forbidden", "server_error", "unknown_structure", "id_mismatch", "conflicting_signals", "redirected_out", "captcha_status_200_large_live_like"] as const) {
      const { page, expectedId } = buildFixture(portal, s);
      const r = adapter.parseListing(page, expectedId);
      expect(r.found, s).not.toBe(false);
      expect(r.notFound, s).not.toBe(true);
      expect(replyToReport(r, SEEN).result, s).not.toBe("absent");
    }
  });
});

describe("seçici kayması: güvenli düşüş + telemetri işareti", () => {
  it("tanınmayan 200 sayfa: kontrol edilemedi + drift işareti; sürüm sonuçta", () => {
    const a = getHtmlAdapter("sahibinden")!;
    const { page, expectedId } = buildFixture("sahibinden", "unknown_structure");
    const r = a.parseListing(page, expectedId);
    expect(r).toMatchObject({ error: "unexpected_structure", drift: true, classification: "unknown", parserVersion: PARSER_VERSION });
  });
  it("sürüm biçimi motor@kural", () => {
    expect(PARSER_VERSION).toBe(`e2@${PORTAL_RULES_VERSION}`);
    expect(PARSER_VERSION.length).toBeLessThanOrEqual(40);
  });
  it("fiyat seçicisi kayarsa ilan yine bulundu ama partial:true (telemetri bunu sayar)", () => {
    const a = getHtmlAdapter("hepsiemlak")!;
    const { page, expectedId } = buildFixture("hepsiemlak", "live_dom_no_price");
    expect(a.parseListing(page, expectedId)).toMatchObject({ found: true, price: null, partial: true });
  });
});

describe("yardımcı katmanlar", () => {
  it("TL normalizasyonu: biçimler, para birimi, sınırlar", () => {
    expect(normalizeTlPrice("4.750.000", null)).toEqual({ price: 4_750_000, nonTl: false });
    expect(normalizeTlPrice("4.750.000,50", "TRY")).toEqual({ price: 4_750_000.5, nonTl: false });
    expect(normalizeTlPrice(3_250_000, "TL")).toEqual({ price: 3_250_000, nonTl: false });
    expect(normalizeTlPrice("1.250", "₺")).toEqual({ price: 1250, nonTl: false });
    expect(normalizeTlPrice("250.000", "USD")).toEqual({ price: null, nonTl: true });
    expect(normalizeTlPrice("250.000", "eur")).toEqual({ price: null, nonTl: true });
    expect(normalizeTlPrice("abc", null)).toEqual({ price: null, nonTl: false });
    expect(normalizeTlPrice(-5, null).price).toBeNull();
    expect(normalizeTlPrice(5e12, null).price).toBeNull();
  });
  it("DOM fiyatının ardından para birimi ipucu", () => {
    expect(currencyHint(" TL</span>")).toBe("TRY");
    expect(currencyHint(" $ ")).toBe("USD");
    expect(currencyHint("€")).toBe("EUR");
    expect(currencyHint("</span>")).toBeNull();
  });
  it("meta/canonical, site son eki, görünür metin", () => {
    const { meta, canonical } = extractMeta(`<meta property="og:title" content="A &amp; B - sahibinden.com"><link href='https://x.y/z-1' rel="canonical">`);
    expect(meta.get("og:title")).toBe("A & B - sahibinden.com");
    expect(canonical).toBe("https://x.y/z-1");
    expect(stripSiteSuffix("Moda 3+1 | Hepsiemlak")).toBe("Moda 3+1");
    expect(visibleText(`<script>var a="kaldırıldı"</script><p>Merhaba   <b>dünya</b></p><!-- gizli -->`).trim()).toBe("Merhaba dünya");
  });
  it("durum JSON'u: bozuk JSON atlanır, dengeli ayrıştırma dize içi parantezi bozmaz", () => {
    expect(extractStates(`<script id="__NEXT_DATA__" type="application/json">{bozuk</script>`)).toEqual([]);
    const s = extractStates(`<script>window.__STATE__ = {"a":"}{","b":[1,2,{"c":3}]}; var x=1;</script>`);
    expect(s).toEqual([{ a: "}{", b: [1, 2, { c: 3 }] }]);
  });
  it("devasa/derin durum JSON'u bütçeyle sınırlı kalır (sonsuz döngü yok)", () => {
    let deep: unknown = { listingId: "123456789", title: "x" };
    for (let i = 0; i < 50; i += 1) deep = { child: deep };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(deep)}</script>`;
    expect(extractStates(html).length).toBe(1);
  });
});
