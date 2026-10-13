import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeCampaignOnlyRows } from "./ads";
import { adsRecommendations, CAMPAIGN_ONLY_AD_GROUP_ID, type AdsMetricRow } from "./ads-rules";
import { buildAdsDashboard } from "./ads-dashboard";
import { buildGoogleIssues, canAutoOptimize, type GoogleIssueInput } from "./collector";
import { GOOGLE_KEYS } from "./keys";
import { runGoogleSync, type GoogleDataStore } from "./sync";
import { readToken, saveToken, writeSealed } from "./token-store";
import { fakeFetch, json, memoryPort, withSecrets } from "./test-support";

const row = (p: Partial<AdsMetricRow>): AdsMetricRow => ({
  day: "2026-10-12",
  campaign_id: "c1",
  campaign: "Kampanya 1",
  ad_group_id: "g1",
  ad_group: "Grup 1",
  cost_micros: 0,
  clicks: 0,
  impressions: 0,
  conversions: 0,
  conv_value: 0,
  budget_limited: false,
  ...p,
});
const M = 1_000_000;

describe("ads-rules (saf)", () => {
  it("veri yoksa öneri yok", () => {
    expect(adsRecommendations([])).toEqual([]);
  });

  it("harcaması olup dönüşümü 0 olan kampanya", () => {
    const recs = adsRecommendations([row({ cost_micros: 600 * M, clicks: 40 }), row({ campaign_id: "c2", campaign: "K2", cost_micros: 100 * M, clicks: 50 })]);
    expect(recs.map((r) => [r.code, r.campaignId])).toEqual([["ads-spend-no-conversion", "c1"]]);
    expect(recs[0].adsUrl).toContain("ads.google.com");
    expect(recs[0].explain).toMatch(/dönüşüm/);
  });

  it("CPA'sı ortalamanın 2 katını aşan reklam grubu", () => {
    const rows = [
      row({ ad_group_id: "g1", ad_group: "Ucuz", cost_micros: 100 * M, clicks: 50, conversions: 10 }),
      row({ ad_group_id: "g2", ad_group: "Ucuz2", cost_micros: 100 * M, clicks: 50, conversions: 10 }),
      row({ ad_group_id: "g3", ad_group: "Pahalı", cost_micros: 300 * M, clicks: 50, conversions: 1 }),
    ];
    // ortalama CPA = 500 / 21 ≈ 23.8; Pahalı CPA = 300 > 47.6
    const recs = adsRecommendations(rows).filter((r) => r.code === "ads-adgroup-high-cpa");
    expect(recs.map((r) => r.adGroupId)).toEqual(["g3"]);
    expect(recs[0].adsUrl).toContain("adGroupId=g3");
  });

  it("reklam grubu olmayan kampanya (PMax) toplamlara girer ama reklam grubu önerisi üretmez", () => {
    const rows = [
      row({ ad_group_id: "g1", ad_group: "Ucuz", cost_micros: 100 * M, clicks: 50, conversions: 10 }),
      row({ ad_group_id: "g2", ad_group: "Ucuz2", cost_micros: 100 * M, clicks: 50, conversions: 10 }),
      row({ campaign_id: "pm", campaign: "PMax", ad_group_id: CAMPAIGN_ONLY_AD_GROUP_ID, ad_group: "(reklam grubu yok)", cost_micros: 300 * M, clicks: 50, conversions: 1 }),
    ];
    const recs = adsRecommendations(rows);
    expect(recs.filter((r) => r.code === "ads-adgroup-high-cpa")).toEqual([]);
    expect(buildAdsDashboard(rows, []).total.spend).toBe(500);
    // Dönüşümsüz harcama kuralı PMax kampanyasını da değerlendirir.
    const noConv = adsRecommendations([row({ campaign_id: "pm", ad_group_id: CAMPAIGN_ONLY_AD_GROUP_ID, cost_micros: 600 * M, clicks: 40 })]);
    expect(noConv.map((r) => [r.code, r.campaignId])).toEqual([["ads-spend-no-conversion", "pm"]]);
  });

  it("mergeCampaignOnlyRows: reklam grubu satırı olan kampanya-gün kampanya toplamıyla çift sayılmaz", () => {
    const ag = [row({ campaign_id: "c1", ad_group_id: "g1", cost_micros: 5 * M })];
    const camp = [
      row({ campaign_id: "c1", ad_group_id: CAMPAIGN_ONLY_AD_GROUP_ID, cost_micros: 5 * M }),
      row({ campaign_id: "pm", ad_group_id: CAMPAIGN_ONLY_AD_GROUP_ID, cost_micros: 7 * M }),
      row({ campaign_id: "c1", ad_group_id: CAMPAIGN_ONLY_AD_GROUP_ID, day: "2026-10-11", cost_micros: 2 * M }),
    ];
    const merged = mergeCampaignOnlyRows(ag, camp);
    expect(merged.map((r) => `${r.day}|${r.campaign_id}|${r.ad_group_id}`)).toEqual([
      "2026-10-12|c1|g1",
      "2026-10-12|pm|-",
      "2026-10-11|c1|-",
    ]);
  });

  it("dönüşüm hiç yoksa CPA kuralları çalışmaz (sahte ortalama yok)", () => {
    const recs = adsRecommendations([row({ cost_micros: 50 * M, clicks: 5, budget_limited: true })]);
    expect(recs.filter((r) => r.code !== "ads-spend-no-conversion")).toEqual([]);
  });

  it("bütçesi kısıtlı ama verimli kampanya (son gün bayrağı)", () => {
    const rows = [
      row({ campaign_id: "a", campaign: "Verimli", ad_group_id: "1", cost_micros: 100 * M, conversions: 10, day: "2026-10-12", budget_limited: true }),
      row({ campaign_id: "b", campaign: "Pahalı", ad_group_id: "2", cost_micros: 400 * M, conversions: 5, day: "2026-10-12", budget_limited: true }),
      row({ campaign_id: "c", campaign: "Eskiden kısıtlı", ad_group_id: "3", cost_micros: 10 * M, conversions: 5, day: "2026-10-11", budget_limited: true }),
      row({ campaign_id: "c", campaign: "Eskiden kısıtlı", ad_group_id: "3", cost_micros: 10 * M, conversions: 5, day: "2026-10-12", budget_limited: false }),
    ];
    const recs = adsRecommendations(rows).filter((r) => r.code === "ads-budget-limited-efficient");
    expect(recs.map((r) => r.campaignId)).toEqual(["a"]);
  });

  it("pano: CAC gerçek atıflı kayıttan; kayıt yoksa null; CPA dönüşüm yoksa null", () => {
    const d = buildAdsDashboard(
      [row({ campaign_id: "1", campaign: "Marka TR", cost_micros: 300 * M, conversions: 3 }), row({ campaign_id: "2", campaign: "Rakip", cost_micros: 100 * M })],
      [
        { utm_campaign: "marka tr", count: 2 },
        { utm_campaign: "baska", count: 4 },
      ],
    );
    const marka = d.campaigns.find((c) => c.campaignId === "1")!;
    expect(marka).toMatchObject({ spend: 300, signups: 2, cac: 150, cpa: 100 });
    const rakip = d.campaigns.find((c) => c.campaignId === "2")!;
    expect(rakip).toMatchObject({ signups: 0, cac: null, cpa: null });
    expect(d.total).toMatchObject({ spend: 400, signups: 2, cac: 200 });
    expect(d.unmatchedSignups).toBe(4);
  });
});

const connectedSnapshot = (over: Partial<GoogleIssueInput["snapshot"]> = {}): GoogleIssueInput["snapshot"] => ({
  tokens: {
    gsc: { refreshToken: "x", scope: "s", connectedAt: "t", connectedBy: null },
    ads: { refreshToken: "y", scope: "s", connectedAt: "t", connectedBy: null },
  },
  problems: [],
  adsAccount: { customerId: "1234567890", loginCustomerId: null, developerToken: "d" },
  ...over,
});

describe("Google toplayıcısı (K1)", () => {
  const page = (path: string, p: Partial<{ clicks: number; impressions: number; ctr: number; avg_position: number }> = {}) => ({
    key: `https://emlaksoft.com.tr${path}`,
    clicks: 1,
    impressions: 1000,
    ctr: 0.001,
    avg_position: 6,
    ...p,
  });

  it("canAutoOptimize: /fiyatlar evet; /kayit, /giris, /admin hayır", () => {
    expect(canAutoOptimize("/fiyatlar")).toBe(true);
    expect(canAutoOptimize("/kayit")).toBe(false);
    expect(canAutoOptimize("/giris")).toBe(false);
    expect(canAutoOptimize("/admin/seo")).toBe(false);
    expect(canAutoOptimize("/kayit/tamamla")).toBe(false);
  });

  it("gsc-ctr-opportunity yalnız kapsam içi sayfa için (kayit/giris için üretilmez); href SEO kaydına gider", () => {
    const r = buildGoogleIssues({ snapshot: connectedSnapshot(), inspections: [], pages28: [page("/fiyatlar"), page("/kayit"), page("/giris")], adsRows: [] });
    const ctr = r.issues.filter((i) => i.code === "gsc-ctr-opportunity");
    expect(ctr.map((i) => i.url)).toEqual(["https://emlaksoft.com.tr/fiyatlar"]);
    expect(ctr[0].href).toBe("/admin/seo?sekme=sayfalar&sayfa=%2Ffiyatlar#editor");
    expect(ctr[0].area).toBe("seo");
  });

  it("eşik dışı sayfalar bulgu üretmez (az gösterim, ilk 3 sıra, iyi CTR)", () => {
    const r = buildGoogleIssues({
      snapshot: connectedSnapshot(),
      inspections: [],
      pages28: [page("/fiyatlar", { impressions: 50 }), page("/araclar", { avg_position: 2 }), page("/", { ctr: 0.2 })],
      adsRows: [],
    });
    expect(r.issues.filter((i) => i.code === "gsc-ctr-opportunity")).toEqual([]);
  });

  it("gsc-not-indexed ve gsc-canonical-mismatch", () => {
    const r = buildGoogleIssues({
      snapshot: connectedSnapshot(),
      inspections: [
        { url: "https://emlaksoft.com.tr/fiyatlar", verdict: "FAIL", coverage: "Tarandı - dizine eklenmedi", google_canonical: null, user_canonical: null },
        { url: "https://emlaksoft.com.tr/araclar", verdict: "PASS", coverage: null, google_canonical: "https://emlaksoft.com.tr/", user_canonical: "https://emlaksoft.com.tr/araclar" },
        { url: "https://emlaksoft.com.tr/", verdict: "PASS", coverage: null, google_canonical: "https://emlaksoft.com.tr/", user_canonical: "https://emlaksoft.com.tr" },
      ],
      pages28: [],
      adsRows: [],
    });
    expect(r.issues.map((i) => [i.code, i.url, i.severity])).toEqual([
      ["gsc-not-indexed", "https://emlaksoft.com.tr/fiyatlar", "kritik"],
      ["gsc-canonical-mismatch", "https://emlaksoft.com.tr/araclar", "uyari"],
    ]);
  });

  it("bağlı değilken bulgu yok ve eski adresler 'taranmış' sayılmaz", () => {
    const r = buildGoogleIssues({
      snapshot: { tokens: { gsc: null, ads: null }, problems: [], adsAccount: null },
      inspections: [{ url: "https://emlaksoft.com.tr/fiyatlar", verdict: "FAIL", coverage: null, google_canonical: null, user_canonical: null }],
      pages28: [page("/fiyatlar")],
      adsRows: [row({ cost_micros: 900 * M, clicks: 90 })],
    });
    expect(r.issues).toEqual([]);
    expect(r.scanned).toEqual(["google:gsc", "google:ads"]);
  });

  it("invalid_grant ('yeniden bağla') kritik 'bağlantı kopuk' bulgusu üretir (alan seo / reklam)", () => {
    const snap = connectedSnapshot();
    snap.tokens.ads = { ...snap.tokens.ads!, needsReconnect: true };
    const r = buildGoogleIssues({ snapshot: snap, inspections: [], pages28: [], adsRows: [row({ cost_micros: 900 * M, clicks: 90 })] });
    const broken = r.issues.filter((i) => i.code === "google-baglanti-kopuk");
    expect(broken).toEqual([expect.objectContaining({ area: "reklam", severity: "kritik", url: "google:ads", href: "/admin/site/baglantilar" })]);
    expect(r.issues.some((i) => i.code.startsWith("ads-") && i.code !== "google-baglanti-kopuk")).toBe(false);
  });

  it("ads önerileri reklam alanında, Google Ads derin bağlantılı ve manualOnly", () => {
    const r = buildGoogleIssues({ snapshot: connectedSnapshot(), inspections: [], pages28: [], adsRows: [row({ cost_micros: 900 * M, clicks: 90 })] });
    const ads = r.issues.filter((i) => i.code === "ads-spend-no-conversion");
    expect(ads).toEqual([expect.objectContaining({ area: "reklam", url: "ads:campaign:c1", manualOnly: true })]);
    expect(ads[0].href).toMatch(/^https:\/\/ads\.google\.com\//);
  });
});

function memoryStore(): GoogleDataStore & { gsc: number; ads: number; inspected: string[]; pruned: number } {
  const s = {
    gsc: 0,
    ads: 0,
    inspected: [] as string[],
    pruned: 0,
    async lastGscDay() {
      return null;
    },
    async lastAdsDay() {
      return null;
    },
    async upsertGscRows(rows: readonly unknown[]) {
      s.gsc += rows.length;
      return { ok: true as const, count: rows.length };
    },
    async upsertAdsRows(rows: readonly unknown[]) {
      s.ads += rows.length;
      return { ok: true as const, count: rows.length };
    },
    async readInspectionIndex() {
      return [];
    },
    async upsertInspection(r: { url: string }) {
      s.inspected.push(r.url);
      return { ok: true as const, count: 1 };
    },
    async prune() {
      s.pruned += 1;
      return 0;
    },
  };
  return s;
}

describe("senkron çekirdeği", () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
    vi.restoreAllMocks();
  });

  it("bağlantı yokken atlar ve 0 dış çağrı yapar", async () => {
    const { port } = memoryPort();
    const f = fakeFetch([() => json({})]);
    const store = memoryStore();
    const out = await runGoogleSync({ port, store, google: { fetcher: f.fetcher }, nowMs: () => 0, readSitemap: async () => [] });
    expect(out).toEqual({ skipped: true, reason: "bağlı değil" });
    expect(f.calls).toHaveLength(0);
    expect(store.pruned).toBe(0);
  });

  it("invalid_grant: hizmet 'yeniden bağla' işaretlenir, diğer hizmet sürer", async () => {
    restore = withSecrets(true);
    const { port } = memoryPort();
    await writeSealed(port, GOOGLE_KEYS.client, { clientId: "c", clientSecret: "s" }, null, "t");
    await writeSealed(port, GOOGLE_KEYS.gscProperty, { siteUrl: "sc-domain:emlaksoft.com.tr" }, null, "t");
    await writeSealed(port, GOOGLE_KEYS.adsAccount, { customerId: "1234567890", loginCustomerId: null, developerToken: "dtdtdtdtdt" }, null, "t");
    await saveToken(port, "gsc", { refreshToken: "rt-gsc", scope: "s", connectedAt: "t", connectedBy: null }, null);
    await saveToken(port, "ads", { refreshToken: "rt-ads", scope: "s", connectedAt: "t", connectedBy: null }, null);

    const f = fakeFetch([
      ({ init }) =>
        new URLSearchParams(String(init.body)).get("refresh_token") === "rt-gsc" ? json({ error: "invalid_grant" }, 400) : json({ access_token: "at" }),
      () => json({ access_token: "at-ads" }),
      () => json([{ results: [] }]),
    ]);
    const store = memoryStore();
    const out = await runGoogleSync({
      port,
      store,
      google: { fetcher: f.fetcher },
      nowMs: () => Date.parse("2026-10-13T03:10:00Z"),
      readSitemap: async () => [],
    });
    expect(out.skipped).toBe(false);
    if (out.skipped) return;
    expect(out.reconnect).toEqual(["gsc"]);
    expect((await readToken(port, "gsc"))?.needsReconnect).toBe(true);
    expect(f.calls.some((c) => c.url.includes("googleAds:searchStream"))).toBe(true);
    expect(f.calls.some((c) => c.url.includes("searchconsole"))).toBe(false);
    expect(store.pruned).toBe(1);
    expect(out.failed).toBeGreaterThan(0);

    // Sonraki tur: GSC yeniden bağlama bekliyor → GSC'ye hiç çağrı yok; toplayıcı kritik bulgu üretir.
    const snap = { tokens: { gsc: await readToken(port, "gsc"), ads: await readToken(port, "ads") }, problems: [], adsAccount: null };
    const issues = buildGoogleIssues({ snapshot: snap, inspections: [], pages28: [], adsRows: [] }).issues;
    expect(issues).toEqual([expect.objectContaining({ code: "google-baglanti-kopuk", area: "seo", severity: "kritik" })]);
  });
});
