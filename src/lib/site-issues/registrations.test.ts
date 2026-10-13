import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * KOKPİT KAYITLARI (S2/S3/S4 dikişleri): paket toplayıcı/yürütücü/kancalarının Kokpit sözleşmesine çevrilmesi ve
 * listelere kaydı. platform_settings bellek içi sahte ile değiştirilir: SEO "Taslağa al" yalnız taslağa yazar.
 */

vi.mock("server-only", () => ({}));
const mem = new Map<string, string | null>();
vi.mock("@/lib/platform-settings", () => ({
  getPlatformSetting: async (k: string) => mem.get(k) ?? null,
  getPlatformSettingsMany: async (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, mem.get(k) ?? null])),
  readPlatformSettingStrict: async (k: string) => (mem.has(k) ? { value: mem.get(k) ?? null, version: 1 } : null),
  setPlatformSetting: async (k: string, v: string | null) => {
    mem.set(k, v);
    return true;
  },
}));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: async () => undefined }));

const { googleResultToCollector, measureResultToCollector, speedResultToCollector, fromStaticExecutor, fromStaticHook, issueToFixTarget } = await import("./adapters");
const { auditRunToCollectorResult } = await import("./builtin-seo-latest");
const { EXECUTORS, canDraft, executorFor } = await import("./executors");
const { COLLECTORS, AREA_META } = await import("./collectors");
const { planCollectorMerge } = await import("./state");
const { HOOKS } = await import("@/lib/publishing/after-publish");
const { SURFACES, surfaceById } = await import("@/lib/publishing/surfaces");
const { DEFAULT_SEO_SETTINGS } = await import("@/lib/seo/store");
const { SEO_KEYS } = await import("@/lib/seo/schema");
const { seoOverridesStore } = await import("@/lib/seo/publish-surface");
const { buildGoogleIssues } = await import("@/lib/google/collector");
const { createStaticRefreshExecutor } = await import("@/lib/static-home/executors");
const { speedIssues } = await import("@/lib/static-home/collector");
const { AUTOPILOT_KINDS } = await import("./autopilot");

import type { SiteIssue } from "./types";

const AT = "2026-10-13T02:00:00.000Z";
const ORIGIN = "https://emlaksoft.com.tr";

beforeEach(() => mem.clear());

describe("kayıt listeleri", () => {
  it("toplayıcılar: SEO robotu, Search Console, Hız, Ölçüm, Google Ads; kimlikler benzersiz, her alanın kurulum ekranı gerçek sayfa", () => {
    expect(COLLECTORS.map((c) => [c.id, c.area])).toEqual([
      ["builtin-seo-latest", "seo"],
      ["google-gsc", "seo"],
      ["speed", "hiz"],
      ["olcum", "olcum"],
      ["google-ads", "reklam"],
    ]);
    for (const m of Object.values(AREA_META)) expect(existsSync(join(process.cwd(), `src/app${m.setupHref}/page.tsx`)), m.setupHref).toBe(true);
    expect(AREA_META.hiz.setupHref).toBe("/admin/site/hiz");
    expect(AREA_META.olcum.setupHref).toBe("/admin/site/reklam");
    expect(AREA_META.reklam.setupHref).toBe("/admin/site/baglantilar");
  });

  it("yürütücüler Otopilot izin listesini karşılar; kancalar statik(10) → doğrulama(20) → SEO(30)", () => {
    for (const k of AUTOPILOT_KINDS) expect(EXECUTORS.some((e) => e.kind === k), k).toBe(true);
    expect([...HOOKS].sort((a, b) => a.order - b.order).map((h) => [h.id, h.order])).toEqual([
      ["static_refresh", 10],
      ["verify", 20],
      ["seo", 30],
    ]);
  });

  it("SEO taslak yüzeyi Yayın masasında kayıtlı (Otopilot taslak yüzeyini yayınlayabilsin)", () => {
    expect(SURFACES.map((s) => s.id)).toContain("seo");
    expect(surfaceById("seo")?.module).toBe("seo");
  });
});

describe("K1 bağdaştırıcıları", () => {
  it("Hız: statik yedeğe düşme 'static_refresh' önerisi taşır; veri yoksa kaynak tarihi boş (sahte not yok)", () => {
    const route = { id: "home", path: "/", label: "Ana sayfa", mode: "on" as const, lastRenderAt: 1, lastStatic: false, rawBytes: 1, gzipBytes: 1, lastFallbackReason: "x" };
    const r = speedResultToCollector({ area: "hiz", ...speedIssues({ routes: [route], labRuns: [], compression: null }) }, AT);
    expect(r).toMatchObject({ collector: "speed", area: "hiz", scanned: ["/"], sourceAt: AT });
    expect(r.issues[0]).toMatchObject({ code: "static_fallback", manualOnly: false, proposal: { kind: "static_refresh", params: { url: "/" } } });
    expect(speedResultToCollector({ area: "hiz", scanned: [], issues: [] }, AT).sourceAt).toBeNull();
  });

  it("Ölçüm: bulgular yalnız elle (öneri yok), kapsam 'all'", () => {
    const r = measureResultToCollector({ area: "olcum", scanned: "all", issues: [{ area: "olcum", url: "/", code: "olcum-akis-yok", severity: "uyari", title: "t", explain: "e", href: "/admin/site/reklam" }] }, AT);
    expect(r).toMatchObject({ collector: "olcum", scanned: "all", sourceAt: AT });
    expect(r.issues[0]).toMatchObject({ manualOnly: true, proposal: null });
  });

  it("Google: Search Console (seo) ve Ads (reklam) ayrılır; bağlı olmayan hizmetin kaynak tarihi boş", () => {
    const snapshot = { tokens: { gsc: { refreshToken: "x", scope: "s", connectedAt: "t", connectedBy: null }, ads: null }, problems: [], adsAccount: null };
    const res = buildGoogleIssues({
      snapshot: snapshot as never,
      inspections: [{ url: `${ORIGIN}/fiyatlar`, verdict: "FAIL", coverage: null, google_canonical: null, user_canonical: null }],
      pages28: [],
      adsRows: [],
    });
    const gsc = googleResultToCollector(res, "seo", AT);
    const ads = googleResultToCollector(res, "reklam", AT);
    expect(gsc).toMatchObject({ collector: "google-gsc", area: "seo", sourceAt: AT });
    expect(gsc.issues.map((i) => i.code)).toEqual(["gsc-not-indexed"]);
    expect(gsc.scanned).not.toContain("google:ads");
    expect(ads).toMatchObject({ collector: "google-ads", area: "reklam", sourceAt: null, issues: [] });
    expect(ads.scanned).toEqual(["google:ads"]);
  });
});

describe("K2: SEO 'Güvenli düzeltmeleri hazırla' uçtan uca (toplayıcı → kuyruk → plan → taslak)", () => {
  const LONG = "EmlakSoft paketleri, aylık ve yıllık fiyatlar, kullanıcı ve portföy limitleri ile özellik karşılaştırması. Ücretsiz deneme, kredi kartı gerekmez; dilediğiniz an paketinizi değiştirin.";
  const run = {
    at: AT,
    durationMs: 1,
    trigger: "cron" as const,
    summary: { critical: 0, warning: 0, info: 2, pagesChecked: 2, linksChecked: 0 },
    findings: [
      { code: "long-description", severity: "info" as const, url: `${ORIGIN}/fiyatlar`, message: "Açıklama 178 karakter.", fix: "Kısaltın." },
      { code: "long-description", severity: "info" as const, url: `${ORIGIN}/kayit`, message: "Açıklama 178 karakter.", fix: "Kısaltın." },
    ],
    h1: {},
    truncated: false,
    notes: [],
  };
  const toRow = (i: ReturnType<typeof auditRunToCollectorResult>["issues"][number], n: number): SiteIssue => {
    const plan = planCollectorMerge([], { ...auditRunToCollectorResult(run, null), issues: [i] }, AT);
    return { ...plan.inserts[0]!, id: `00000000-0000-4000-8000-00000000000${n}` } as SiteIssue;
  };

  it("/fiyatlar taslağa alınır (canlı değişmez, yüzey 'seo', durum 'taslakta'); /kayit hiçbir zaman", async () => {
    mem.set(SEO_KEYS.pages, JSON.stringify({ "/fiyatlar": { description: LONG }, "/kayit": { description: LONG } }));
    const settings = { ...DEFAULT_SEO_SETTINGS, pages: { "/fiyatlar": { description: LONG }, "/kayit": { description: LONG } } };
    const result = auditRunToCollectorResult(run, settings);
    const [fiyat, kayit] = result.issues.map(toRow);

    expect(canDraft(kayit!)).toBe(false);
    expect(await executorFor("seo_meta_draft:long-description")!.plan!(kayit!)).toBeNull();

    expect(canDraft(fiyat!)).toBe(true);
    const ex = executorFor(fiyat!.proposal!.kind)!;
    const plan = await ex.plan!(fiyat!);
    expect(plan).toMatchObject({ issueId: fiyat!.id, kind: "seo_meta_draft:long-description", target: "/fiyatlar", risk: "guvenli" });
    const before = mem.get(SEO_KEYS.pages);
    const out = await ex.apply!(plan!, { actorId: "staff-1", source: "staff" });
    expect(out).toMatchObject({ ok: true, draftSurface: "seo", status: "taslakta" });
    expect(mem.get(SEO_KEYS.pages)).toBe(before);
    const draft = (await seoOverridesStore.readState()).draft!;
    expect(draft["/fiyatlar"]?.description?.length).toBeLessThanOrEqual(155);
  });

  it("kuyruk satırı → SEO hedefi: alan ve kural öneri parametrelerinden gelir", () => {
    const t = issueToFixTarget({ url: "/fiyatlar", code: "missing-og-title", manual_only: false, evidence: null, proposal: { kind: "seo_meta_draft:missing-og-title", summary: "s", after: "x", params: { rule: "missing-og-title", field: "ogTitle", risk: "guvenli" } } });
    expect(t.proposal).toMatchObject({ rule: "missing-og-title", field: "ogTitle", after: "x", action: { kind: "seo_meta_draft", risk: "guvenli" } });
  });
});

describe("K2/K3: statik tazeleme", () => {
  it("statik yürütücü doğrudan uygular, bulgu 'yayında, doğrulama bekliyor' olur; kapalı sayfa planlanmaz", async () => {
    const refreshed: string[] = [];
    const ex = fromStaticExecutor(
      createStaticRefreshExecutor({
        state: async () => ({ etag: "a", at: 1, isStatic: true, gzipBytes: 40 * 1024 }),
        enabledIds: async () => ["home"],
        refresh: async (id) => {
          refreshed.push(id);
          return { ok: true };
        },
      }),
    );
    const issue = { id: "i1", url: "/", proposal: { kind: "static_refresh", summary: "s", params: { url: "/" } } } as unknown as SiteIssue;
    const plan = await ex.plan!(issue);
    expect(plan).toMatchObject({ kind: "static_refresh", target: "/", before: "statik · 40 KB", risk: "guvenli" });
    expect(refreshed).toEqual([]);
    expect(await ex.apply!(plan!, { actorId: null, source: "otopilot" })).toMatchObject({ ok: true, status: "yayinda" });
    expect(refreshed).toEqual(["home"]);
    expect(await ex.plan!({ ...issue, url: "/gizlilik", proposal: { kind: "static_refresh", summary: "s", params: { url: "/gizlilik" } } })).toBeNull();
  });

  it("statik kanca Kokpit olayını paket olayına çevirir (surface → surfaceId)", async () => {
    const seen: unknown[] = [];
    const hook = fromStaticHook({ id: "static_refresh", order: 10, label: "x", run: async (ev) => (seen.push(ev), { ok: true, message: "m" }) });
    await hook.run({ surface: "sitecontent", kind: "publish", livePaths: ["/"], actorId: "a", source: "staff" });
    expect(seen).toEqual([{ surfaceId: "sitecontent", livePaths: ["/"], actorId: "a", source: "staff" }]);
  });
});
