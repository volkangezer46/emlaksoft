import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { ADS_ALLOWED_METHODS, adsEndpoint, fetchAdsDaily, type AdsMethod } from "./ads";
import { GSC_API, GSC_ROW_LIMIT, fetchSearchAnalytics, gscFetchRange, suggestProperty } from "./gsc";
import { GOOGLE_ALLOWED_HOSTS, GoogleHostError, assertGoogleUrl, googleFetch } from "./http";
import { GOOGLE_AUTH_ENDPOINT, GOOGLE_REVOKE_ENDPOINT, GOOGLE_TOKEN_ENDPOINT } from "./oauth";
import { GOOGLE_QUOTAS, MinuteWindow, QuotaWindow, dailyWindow, stopAt } from "./quotas";
import { INSPECTION_ENDPOINT, LIVE_SITEMAP_URL, parseSitemap, readLiveSitemap, selectUrlsToInspect } from "./url-inspection";
import { fakeFetch, json } from "./test-support";

const ROOT = process.cwd();
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name) ? [relative(ROOT, p).split(sep).join("/")] : [];
  });
}
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const googleFiles = walk(join(ROOT, "src/lib/google")).filter((f) => !f.endsWith("test-support.ts"));

describe("dış çağrı sınırı: sabit Google host listesi", () => {
  it("izin listesi tam olarak beş host", () => {
    expect([...GOOGLE_ALLOWED_HOSTS].sort()).toEqual(
      ["accounts.google.com", "googleads.googleapis.com", "oauth2.googleapis.com", "searchconsole.googleapis.com", "www.googleapis.com"].sort(),
    );
  });

  it("listede olmayan host, http, port ve kimlik bilgili adres reddedilir; istek hiç gitmez", async () => {
    for (const bad of [
      "https://evil.example.com/x",
      "http://oauth2.googleapis.com/token",
      "https://oauth2.googleapis.com:8443/token",
      "https://user:pw@oauth2.googleapis.com/token",
      "https://oauth2.googleapis.com.evil.com/token",
      "https://googleads.googleapis.com.attacker.io/v22",
    ]) {
      expect(() => assertGoogleUrl(bad), bad).toThrow(GoogleHostError);
    }
    const f = fakeFetch([() => json({})]);
    await expect(googleFetch("https://evil.example.com", {}, { fetcher: f.fetcher })).rejects.toBeInstanceOf(GoogleHostError);
    expect(f.calls).toHaveLength(0);
  });

  it("kodda kullanılan tüm Google uç noktaları izin listesinde", () => {
    for (const u of [GOOGLE_AUTH_ENDPOINT, GOOGLE_TOKEN_ENDPOINT, GOOGLE_REVOKE_ENDPOINT, `${GSC_API}/sites`, INSPECTION_ENDPOINT, adsEndpoint("1234567890", "search")]) {
      expect(() => assertGoogleUrl(u), u).not.toThrow();
    }
  });

  it("src/lib/google içinde ham fetch yok; fetchExternal yalnız http.ts (Google) ve url-inspection.ts (kendi sitemap'imiz)", () => {
    for (const f of googleFiles) {
      const src = read(f);
      expect(/\bfetch\s*\(/.test(src), f).toBe(false);
      if (src.includes("fetchExternal(")) expect(["src/lib/google/http.ts", "src/lib/google/url-inspection.ts"], f).toContain(f);
    }
  });

  it("kaynaktaki googleapis/google.com adresleri izin listesinde (bağlantı amaçlı arayüz/belge adresleri hariç)", () => {
    const UI_ONLY = ["ads.google.com", "developers.google.com", "support.google.com", "www.google.com", "search.google.com"];
    for (const f of googleFiles) {
      for (const m of read(f).matchAll(/https:\/\/([a-z0-9.-]+)/gi)) {
        const host = m[1].toLowerCase();
        if (!host.includes("google")) continue;
        expect([...GOOGLE_ALLOWED_HOSTS, ...UI_ONLY], `${f}: ${host}`).toContain(host);
      }
    }
    // Arayüz adresleri asla googleFetch ile çağrılmaz: yalnız http.ts'ten geçenler fetch edilir.
    expect(() => assertGoogleUrl("https://ads.google.com/aw/overview")).toThrow(GoogleHostError);
  });

  it("canlı sitemap yalnız kendi alan adımızdan okunur (dizindeki yabancı alt sitemap izlenmez)", async () => {
    const seen: string[] = [];
    const entries = await readLiveSitemap(async (url) => {
      seen.push(url);
      if (url === LIVE_SITEMAP_URL) {
        return `<sitemapindex><sitemap><loc>https://emlaksoft.com.tr/s1.xml</loc></sitemap><sitemap><loc>https://evil.example.com/s.xml</loc></sitemap></sitemapindex>`;
      }
      return `<urlset><url><loc>https://emlaksoft.com.tr/fiyatlar</loc><lastmod>2026-10-01</lastmod></url></urlset>`;
    });
    expect(seen).toEqual([LIVE_SITEMAP_URL, "https://emlaksoft.com.tr/s1.xml"]);
    expect(entries).toEqual([{ url: "https://emlaksoft.com.tr/fiyatlar", lastmod: "2026-10-01" }]);
  });
});

describe("Google Ads: yalnız search / searchStream", () => {
  it("izin listesi yalnız iki yöntem; başka yöntem adresi kurulamaz", () => {
    expect([...ADS_ALLOWED_METHODS].sort()).toEqual(["search", "searchStream"]);
    expect(adsEndpoint("123-456-7890", "searchStream")).toMatch(/^https:\/\/googleads\.googleapis\.com\/v\d+\/customers\/1234567890\/googleAds:searchStream$/);
    expect(() => adsEndpoint("1234567890", "mutate" as AdsMethod)).toThrow();
    expect(() => adsEndpoint("1234567890", "x" as AdsMethod)).toThrow();
    expect(() => adsEndpoint("12", "search")).toThrow();
  });

  it("günlük çekim tek searchStream isteğidir; başlıklar developer-token ve MCC taşır", async () => {
    const f = fakeFetch([
      () =>
        json([
          {
            results: [
              {
                segments: { date: "2026-10-12" },
                campaign: { id: "11", name: "Marka", primaryStatusReasons: ["BUDGET_CONSTRAINED"] },
                adGroup: { id: "22", name: "Grup" },
                metrics: { costMicros: "1500000", clicks: "3", impressions: "40", conversions: 1, conversionsValue: 0 },
              },
            ],
          },
        ]),
    ]);
    const rows = await fetchAdsDaily(
      { customerId: "1234567890", loginCustomerId: "111-222-3333", developerToken: "dt", accessToken: "at", startDate: "2026-10-01", endDate: "2026-10-12" },
      { fetcher: f.fetcher },
    );
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url.endsWith("googleAds:searchStream")).toBe(true);
    const h = f.calls[0].init.headers as Record<string, string>;
    expect(h["developer-token"]).toBe("dt");
    expect(h["login-customer-id"]).toBe("1112223333");
    expect(String(f.calls[0].init.body)).toMatch(/^\{"query":"SELECT /);
    expect(rows).toEqual([
      expect.objectContaining({ day: "2026-10-12", campaign_id: "11", ad_group_id: "22", cost_micros: 1_500_000, clicks: 3, budget_limited: true }),
    ]);
  });

  it("grep: Google Ads çağrısı yapan hiçbir kaynakta değişiklik (mutate) uç noktası yok", () => {
    const all = walk(join(ROOT, "src"));
    const adsCallers = all.filter((f) => /googleads\.googleapis\.com|googleAds:/.test(read(f)));
    expect(adsCallers).toContain("src/lib/google/ads.ts");
    for (const f of adsCallers) expect(/mutate/i.test(read(f)), f).toBe(false);
    for (const f of googleFiles) expect(/mutate/i.test(read(f)), f).toBe(false);
    expect(read("src/app/actions/google-connect.ts")).not.toMatch(/mutate/i);
  });
});

describe("kotalar: %80'de durur", () => {
  it("günlük pencere eşiği limitin %80'i", () => {
    expect(stopAt(GOOGLE_QUOTAS.inspectionPerDay)).toBe(1600);
    expect(stopAt(GOOGLE_QUOTAS.adsPerDay)).toBe(2304);
    expect(stopAt(GOOGLE_QUOTAS.gscPerMinute)).toBe(960);
    const w = new QuotaWindow(10);
    let ok = 0;
    while (w.tryConsume()) ok += 1;
    expect(ok).toBe(8);
    expect(w.exhausted).toBe(true);
    expect(w.remaining()).toBe(0);
  });

  it("gün değişince sayaç sıfırlanır; aynı günde kaldığı yerden sürer", () => {
    expect(dailyWindow(100, { day: "2026-10-12", used: 79 }, "2026-10-13").count).toBe(0);
    const same = dailyWindow(100, { day: "2026-10-13", used: 79 }, "2026-10-13");
    expect(same.tryConsume()).toBe(true);
    expect(same.tryConsume()).toBe(false);
  });

  it("dakikalık pencere %80'de durur, yeni dakikada açılır", () => {
    let t = 0;
    const m = new MinuteWindow(10, () => t);
    expect(Array.from({ length: 10 }, () => m.tryConsume()).filter(Boolean)).toHaveLength(8);
    t = 60_000;
    expect(m.tryConsume()).toBe(true);
  });
});

describe("URL Inspection seçicisi", () => {
  const sitemap = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://emlaksoft.com.tr/s${i}`, lastmod: "2026-10-01" }));

  it("günde en çok 50 URL seçer (limit daha büyük verilse bile)", () => {
    expect(selectUrlsToInspect(sitemap(200), [], 500)).toHaveLength(50);
    expect(selectUrlsToInspect(sitemap(200), [], 7)).toHaveLength(7);
    expect(selectUrlsToInspect(sitemap(200), [], 0)).toHaveLength(0);
  });

  it("sıra: yeni → değişen (lastmod > checked_at) → en eski incelenen", () => {
    const sm = [
      { url: "https://emlaksoft.com.tr/eski-1", lastmod: "2026-01-01" },
      { url: "https://emlaksoft.com.tr/degisen", lastmod: "2026-10-10" },
      { url: "https://emlaksoft.com.tr/yeni", lastmod: null },
      { url: "https://emlaksoft.com.tr/eski-2", lastmod: null },
      { url: "https://baska.com/x", lastmod: null },
    ];
    const inspected = [
      { url: "https://emlaksoft.com.tr/eski-1", checked_at: "2026-09-01T00:00:00Z" },
      { url: "https://emlaksoft.com.tr/degisen", checked_at: "2026-10-01T00:00:00Z" },
      { url: "https://emlaksoft.com.tr/eski-2", checked_at: "2026-08-01T00:00:00Z" },
    ];
    expect(selectUrlsToInspect(sm, inspected)).toEqual([
      "https://emlaksoft.com.tr/yeni",
      "https://emlaksoft.com.tr/degisen",
      "https://emlaksoft.com.tr/eski-2",
      "https://emlaksoft.com.tr/eski-1",
    ]);
  });

  it("sitemap ayrıştırma: urlset ve dizin", () => {
    expect(parseSitemap("<urlset><url><loc>https://emlaksoft.com.tr/a?x=1&amp;y=2</loc></url></urlset>").entries[0].url).toBe(
      "https://emlaksoft.com.tr/a?x=1&y=2",
    );
    expect(parseSitemap("<sitemapindex><sitemap><loc>https://emlaksoft.com.tr/s.xml</loc></sitemap></sitemapindex>").kind).toBe("index");
  });
});

describe("Search Console: sayfalama ve aralık", () => {
  const rows = (n: number, offset: number) =>
    Array.from({ length: n }, (_, i) => ({ keys: ["2026-10-10", `https://emlaksoft.com.tr/p${offset + i}`, `q${offset + i}`, "MOBILE"], clicks: 1, impressions: 2, ctr: 0.5, position: 3 }));

  it("25.000 satırlık sayfalar startRow ile birleştirilir; kısa sayfada durur", async () => {
    const f = fakeFetch([() => json({ rows: rows(GSC_ROW_LIMIT, 0) }), () => json({ rows: rows(GSC_ROW_LIMIT, GSC_ROW_LIMIT) }), () => json({ rows: rows(10, 2 * GSC_ROW_LIMIT) })]);
    const res = await fetchSearchAnalytics(
      { property: "sc-domain:emlaksoft.com.tr", accessToken: "at", startDate: "2026-10-01", endDate: "2026-10-12", withQuery: true },
      { fetcher: f.fetcher },
    );
    expect(f.calls).toHaveLength(3);
    expect(f.calls.map((c) => JSON.parse(String(c.init.body)).startRow)).toEqual([0, 25_000, 50_000]);
    expect(JSON.parse(String(f.calls[0].init.body))).toMatchObject({ dimensions: ["date", "page", "query", "device"], rowLimit: 25_000 });
    expect(f.calls[0].url).toBe("https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Aemlaksoft.com.tr/searchAnalytics/query");
    expect(res.rows).toHaveLength(50_010);
    expect(res.pages).toBe(3);
    expect(res.rows[0]).toMatchObject({ device: "mobile", query: "q0" });
  });

  it("kota kapısı reddederse istek gitmez", async () => {
    const f = fakeFetch([() => json({ rows: [] })]);
    await expect(
      fetchSearchAnalytics(
        { property: "p", accessToken: "a", startDate: "2026-10-01", endDate: "2026-10-02", withQuery: false, quota: { tryConsume: () => false } },
        { fetcher: f.fetcher },
      ),
    ).rejects.toThrow(/kota/);
    expect(f.calls).toHaveLength(0);
  });

  it("son 3 gün yeniden çekilir; ilk bağlantıda 90 gün", () => {
    const now = Date.parse("2026-10-13T03:10:00Z");
    expect(gscFetchRange("2026-10-11", now)).toEqual({ startDate: "2026-10-09", endDate: "2026-10-12" });
    expect(gscFetchRange(null, now)).toEqual({ startDate: "2026-07-15", endDate: "2026-10-12" });
  });

  it("Alan (Domain) mülkü önerilir", () => {
    expect(suggestProperty([{ siteUrl: "https://emlaksoft.com.tr/", permissionLevel: "siteOwner" }, { siteUrl: "sc-domain:emlaksoft.com.tr", permissionLevel: "siteOwner" }])).toBe(
      "sc-domain:emlaksoft.com.tr",
    );
    expect(suggestProperty([{ siteUrl: "https://emlaksoft.com.tr/", permissionLevel: "siteOwner" }])).toBe("https://emlaksoft.com.tr/");
    expect(suggestProperty([])).toBeNull();
  });
});
