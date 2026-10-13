import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SEO motoru — depolama/ağ kapıları. platform_settings bellek içi sahte ile değiştirilir; `fetch` casus ile izlenir.
 * Kanıtlanan: SEO yayın yüzeyi (taslak canlıyı değiştirmez, yayın canlıya yazar, geri dönüş önceki değeri getirir),
 * AI kapalıyken ve kapsam dışı sayfada ağ çağrısı SIFIR, IndexNow kapalıyken dış çağrı SIFIR, toplayıcının "read"
 * dönüşümü (`seo.audit.latest` biçimi; /kayit 178 karakter bulgusu long-description önerisiyle, eylemsiz).
 */

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
vi.mock("@/lib/ai-advisor", () => ({ getOpenAiKey: async () => "sk-test" }));
vi.mock("@/lib/ai/platform-quota", () => ({ takePlatformAiQuota: async () => ({ ok: true }) }));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: async () => undefined }));
const sitemapEntries: { url: string; lastModified?: string }[] = [];
vi.mock("./sitemap-data", async (orig) => ({
  ...(await orig<typeof import("./sitemap-data")>()),
  loadSitemapFresh: async () => ({ chunks: [sitemapEntries], total: sitemapEntries.length }),
}));

const { seoPublishSurface, draftSeoPageField, seoOverridesStore, discardSeoDraftPatch, changedPagePaths } = await import("./publish-surface");
type SeoPagesT = Parameters<typeof changedPagePaths>[0];
const { suggestSeoWithAi } = await import("./ai-suggest");
const { notifyIndexNow, indexNowPrint } = await import("./indexnow-events");
const { runIndexNow } = await import("./audit-runner");
const { auditRunToIssues } = await import("./issues-collector");
const { seoMetaDraftExecutor, indexNowExecutor, redirect404DraftExecutor } = await import("./executors");
const { readSeoSettingsFresh } = await import("./store");
const { SEO_KEYS } = await import("./schema");
const { ogImageFindings } = await import("./audit-runner");
const { extractFacts } = await import("./audit-rules");

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  mem.clear();
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 200 }));
});
afterEach(() => fetchSpy.mockRestore());

const pages = () => JSON.parse(mem.get(SEO_KEYS.pages) ?? "{}") as Record<string, { description?: string; ogTitle?: string; updatedAt?: string }>;

describe("SEO yayın yüzeyi (K5)", () => {
  it("taslak canlıyı değiştirmez; yayın canlıya yazar; geri dönüş önceki değeri getirir", async () => {
    mem.set(SEO_KEYS.pages, JSON.stringify({ "/fiyatlar": { description: "Eski açıklama" } }));

    const d = await draftSeoPageField("/fiyatlar", "description", "Yeni açıklama", "staff-1");
    expect(d.ok).toBe(true);
    expect(pages()["/fiyatlar"]?.description).toBe("Eski açıklama");

    const state = await seoPublishSurface.readState();
    expect((state.draft as Record<string, { description: string }>)["/fiyatlar"]?.description).toBe("Yeni açıklama");

    const pub = await seoPublishSurface.publish(state.draft, "staff-1", "Test yayını");
    expect(pub.ok).toBe(true);
    expect(pages()["/fiyatlar"]?.description).toBe("Yeni açıklama");
    expect(pages()["/fiyatlar"]?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(seoPublishSurface.livePaths.map((p) => p.path)).toEqual(["/fiyatlar"]);
    // Mevcut SEO geçmiş halkası da dolar (history.ts uyumu).
    expect(mem.get(SEO_KEYS.history)).toContain("Eski açıklama");

    const hist = (await seoOverridesStore.readState()).history;
    const previous = hist.find((h) => h.label.startsWith("Önceki canlı"));
    expect(previous).toBeTruthy();
    const back = await seoPublishSurface.restore(previous!.id, "staff-1");
    expect(back.ok).toBe(true);
    expect(pages()["/fiyatlar"]?.description).toBe("Eski açıklama");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("taslak bir farktır: yayın -> doğrudan kayıt -> yeni taslak -> yayın doğrudan kaydı EZMEZ, hayalet taslak yok", async () => {
    mem.set(SEO_KEYS.pages, JSON.stringify({ "/fiyatlar": { description: "Eski" } }));
    await draftSeoPageField("/fiyatlar", "description", "Yeni", "staff-1");
    const first = await seoPublishSurface.readState();
    expect((await seoPublishSurface.publish(first.draft, "staff-1", "İlk yayın")).ok).toBe(true);
    // Yayından sonra bekleyen taslak yok.
    expect((await seoPublishSurface.readState()).draft).toBeNull();

    // Doğrudan kayıt (saveSeoPage -> writeSeoSetting("pages")) taslağa dokunmaz.
    mem.set(SEO_KEYS.pages, JSON.stringify({ ...pages(), "/araclar": { title: "Doğrudan kayıt" } }));
    expect((await seoPublishSurface.readState()).draft).toBeNull();

    await draftSeoPageField("/fiyatlar", "ogTitle", "OG yeni", "staff-1");
    const second = await seoPublishSurface.readState();
    expect(changedPagePaths(second.live as SeoPagesT, second.draft as SeoPagesT)).toEqual(["/fiyatlar"]);
    expect((await seoPublishSurface.publish(second.draft, "staff-1", "İkinci yayın")).ok).toBe(true);
    const live = pages() as Record<string, { title?: string; description?: string; ogTitle?: string }>;
    expect(live["/araclar"]?.title).toBe("Doğrudan kayıt");
    expect(live["/fiyatlar"]).toMatchObject({ description: "Yeni", ogTitle: "OG yeni" });
  });
  it("taslağı atmak bekleyen farkı boşaltır; canlıyla aynı değer taslak sayılmaz", async () => {
    mem.set(SEO_KEYS.pages, JSON.stringify({ "/fiyatlar": { description: "Aynı" } }));
    await draftSeoPageField("/fiyatlar", "description", "Aynı", "staff-1");
    expect((await seoPublishSurface.readState()).draft).toBeNull();
    await draftSeoPageField("/fiyatlar", "description", "Farklı", "staff-1");
    expect((await seoPublishSurface.readState()).draft).not.toBeNull();
    expect((await discardSeoDraftPatch("staff-1")).ok).toBe(true);
    mem.set(SEO_KEYS.pages, JSON.stringify({ "/fiyatlar": { description: "Aynı" }, "/araclar": { title: "Sonra" } }));
    expect((await seoPublishSurface.readState()).draft).toBeNull();
  });
  it("geçersiz yapılandırma kalıcı hata ile reddedilir", async () => {
    const r = await seoPublishSurface.publish({ "/x": { title: "<b>html</b>" } }, "s", "x");
    expect(r).toMatchObject({ ok: false, permanent: true });
  });
});

describe("AI önerisi kapıları: ağ çağrısı yok", () => {
  const actor = { id: "staff-1", role: "super_admin" };
  const text = "EmlakSoft paketleri, aylık ve yıllık fiyatlar, kullanıcı ve portföy limitleri ile özellik karşılaştırması burada.";
  it("varsayılan KAPALI: fetch hiç çağrılmaz", async () => {
    const r = await suggestSeoWithAi({ path: "/fiyatlar", visibleText: text, actor });
    expect(r).toMatchObject({ ok: false, code: "kapali" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("açıkken bile: super_admin değilse ve kapsam dışı sayfada fetch çağrılmaz", async () => {
    mem.set(SEO_KEYS.ai, JSON.stringify({ enabled: true, monthlyLimit: 10 }));
    expect(await suggestSeoWithAi({ path: "/fiyatlar", visibleText: text, actor: { id: "o", role: "ops" } })).toMatchObject({ code: "yetki" });
    for (const p of ["/kayit", "/kayit/tamamla", "/giris", "/admin", "/app", "/sifre-yenile"]) {
      expect(await suggestSeoWithAi({ path: p, visibleText: text, actor }), p).toMatchObject({ code: "kapsam" });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("açık + kapsam içi: tek çağrı yapılır, çıktı doğrulanır ve işaretlenir", async () => {
    mem.set(SEO_KEYS.ai, JSON.stringify({ enabled: true, monthlyLimit: 10 }));
    const body = { title: "EmlakSoft Fiyatları ve Paketleri", description: "Aylık ve yıllık fiyatlar, kullanıcı ve portföy limitleri ile paket karşılaştırması; %100 garanti.", ogTitle: "Fiyatlar" };
    fetchSpy.mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), { status: 200 }));
    const r = await suggestSeoWithAi({ path: "/fiyatlar", visibleText: text, actor });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.suggestion.flags.ungroundedNumbers).toBe(true);
      expect(r.suggestion.flags.riskyWords).toEqual(expect.arrayContaining(["%100", "garanti"]));
    }
  });
});

describe("og-image-unreachable: dış görsel ÇEKİLMEZ", () => {
  const O = "https://emlaksoft.com.tr";
  const withOg = (url: string, og: string) => ({ facts: extractFacts(url, 200, `<html><head><meta property="og:image" content="${og}"></head><body></body></html>`), deep: null });
  it("dış OG görseli için fetch çağrılmaz, bilgi bulgusu yazılır", async () => {
    const out = await ogImageFindings([withOg(`${O}/fiyatlar`, "https://cdn.baska.example/og.png")], O, Date.now() + 10_000);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.map((f) => f.code)).toEqual(["og-image-external"]);
  });
  it("kendi kökenimizdeki görsel HEAD ile yoklanır; 404 ise uyarı", async () => {
    fetchSpy.mockImplementation(async () => new Response(null, { status: 404 }));
    const out = await ogImageFindings([withOg(`${O}/fiyatlar`, `${O}/og.png`)], O, Date.now() + 10_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(`${O}/og.png`);
    expect(out.map((f) => f.code)).toEqual(["og-image-unreachable"]);
  });
});

describe("IndexNow olay bildirimi", () => {
  it("kapalıyken 0 dış çağrı", async () => {
    const r = await notifyIndexNow(["https://emlaksoft.com.tr/fiyatlar"], { source: "yayin", sitemapPaths: new Set(["/fiyatlar"]) });
    expect(r.sent).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("açıkken yalnız uygun adresler gönderilir ve son bildirimlere yazılır", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://emlaksoft.com.tr");
    mem.set(SEO_KEYS.indexnow, JSON.stringify({ enabled: true, key: "a".repeat(32) }));
    const r = await notifyIndexNow(["https://emlaksoft.com.tr/fiyatlar", "https://emlaksoft.com.tr/kayit"], { source: "yayin", sitemapPaths: new Set(["/fiyatlar", "/kayit"]) });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body)) as { urlList: string[] };
    expect(sent.urlList).toEqual(["https://emlaksoft.com.tr/fiyatlar"]);
    expect(r.sent).toBe(1);
    const log = JSON.parse(mem.get(SEO_KEYS.indexnowLog) ?? "[]") as { url: string; status: number; source: string }[];
    expect(log[0]).toMatchObject({ url: "https://emlaksoft.com.tr/fiyatlar", status: 200, source: "yayin" });
    vi.unstubAllEnvs();
  });
  it("olay gönderimi url|lastmod parmak izini görüldü kümesine yazar: ertesi günkü sitemap farkı yeniden göndermez", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://emlaksoft.com.tr");
    mem.set(SEO_KEYS.indexnow, JSON.stringify({ enabled: true, key: "a".repeat(32) }));
    sitemapEntries.splice(0, sitemapEntries.length, { url: "https://emlaksoft.com.tr/fiyatlar", lastModified: "2026-10-12T10:00:00.000Z" });
    const r = await notifyIndexNow(["https://emlaksoft.com.tr/fiyatlar"], { source: "yayin" });
    expect(r.sent).toBe(1);
    expect((mem.get(SEO_KEYS.indexnowSeen) ?? "").split(",")).toContain(indexNowPrint("https://emlaksoft.com.tr/fiyatlar", "2026-10-12T10:00:00.000Z"));
    const daily = await runIndexNow(sitemapEntries, new Set(), Date.parse("2026-10-13T03:00:00.000Z"));
    expect(daily).toMatchObject({ sent: 0, status: "değişiklik yok" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    sitemapEntries.length = 0;
    vi.unstubAllEnvs();
  });
});

describe("seoCollector read dönüşümü ve eylem kapsamı", () => {
  const ORIGIN = "https://emlaksoft.com.tr";
  // Canlıdaki `seo.audit.latest` biçimi (scanned alanı olmayan eski kayıt).
  const run = {
    at: "2026-10-12T01:20:00.000Z",
    durationMs: 9000,
    trigger: "cron" as const,
    summary: { critical: 0, warning: 0, info: 2, pagesChecked: 16, linksChecked: 40 },
    findings: [
      { code: "long-description", severity: "info" as const, url: `${ORIGIN}/kayit`, message: "Açıklama 178 karakter; arama sonucunda kesilebilir.", fix: "Açıklamayı 160 karakter altına indirin." },
      { code: "long-description", severity: "info" as const, url: `${ORIGIN}/fiyatlar`, message: "Açıklama 170 karakter.", fix: "x" },
      { code: "missing-og-title", severity: "info" as const, url: `${ORIGIN}/giris`, message: "og:title yok.", fix: "x" },
    ],
    h1: { [`${ORIGIN}/kayit`]: 1, [`${ORIGIN}/fiyatlar`]: 1 },
    truncated: false,
    notes: [],
  };
  it("/kayit 178 karakter bulgusu long-description önerisiyle gelir ama manualOnly ve eylemsiz", async () => {
    const settings = await readSeoSettingsFresh();
    const res = auditRunToIssues(run, settings);
    expect(res.scanned).toEqual([`${ORIGIN}/kayit`, `${ORIGIN}/fiyatlar`]);
    const kayit = res.issues[0]!;
    expect(kayit).toMatchObject({ area: "seo", code: "long-description", severity: "bilgi", manualOnly: true });
    expect(kayit.proposal?.rule).toBe("long-description");
    expect(kayit.proposal?.before?.length).toBe(178);
    expect(kayit.proposal?.after?.length).toBeLessThanOrEqual(155);
    expect(kayit.proposal?.action).toBeUndefined();
    expect(kayit.href).toBe("/admin/seo?sekme=sayfalar&sayfa=%2Fkayit#editor");
    expect(kayit.explain.length).toBeGreaterThan(10);
    expect(seoMetaDraftExecutor.canHandle(kayit)).toBe(false);
    expect(indexNowExecutor.canHandle(kayit)).toBe(false);
  });
  const LONG = "EmlakSoft paketleri, aylık ve yıllık fiyatlar, kullanıcı ve portföy limitleri ile özellik karşılaştırması. Ücretsiz deneme, kredi kartı gerekmez; dilediğiniz an paketinizi değiştirin.";
  it("kapsam yolları hiçbir zaman seo_meta_draft almaz", async () => {
    mem.set(SEO_KEYS.pages, JSON.stringify({ "/fiyatlar": { description: LONG } }));
    const settings = await readSeoSettingsFresh();
    for (const p of ["/kayit", "/kayit/tamamla", "/giris", "/admin", "/app", "/sifre-yenile"]) {
      const issue = { url: `${ORIGIN}${p}`, code: "long-description", manualOnly: false, proposal: { rule: "long-description", summary: "x", field: "description", after: "kısa", action: { kind: "seo_meta_draft", risk: "guvenli" as const } } };
      expect(seoMetaDraftExecutor.canHandle(issue), p).toBe(false);
      expect(await seoMetaDraftExecutor.plan(issue), p).toBeNull();
    }
    const fiyat = auditRunToIssues(run, settings).issues[1]!;
    expect(fiyat.manualOnly).toBe(false);
    expect(fiyat.proposal?.action).toEqual({ kind: "seo_meta_draft", risk: "guvenli" });
    expect(seoMetaDraftExecutor.canHandle(fiyat)).toBe(true);
    expect(seoMetaDraftExecutor.risk(fiyat)).toBe("guvenli");
    expect(seoMetaDraftExecutor.risk({ ...fiyat, code: "long-title" })).toBe("dikkat");
  });
  it("seo_meta_draft uygulaması yalnız taslağa yazar", async () => {
    mem.set(SEO_KEYS.pages, JSON.stringify({ "/fiyatlar": { description: LONG } }));
    const settings = await readSeoSettingsFresh();
    const fiyat = auditRunToIssues({ ...run, findings: [{ ...run.findings[1]!, message: "x" }] }, settings).issues[0]!;
    const before = mem.get(SEO_KEYS.pages) ?? null;
    const r = await seoMetaDraftExecutor.apply(fiyat, { actorId: "staff-1", source: "otopilot" });
    expect(r.ok).toBe(true);
    expect(mem.get(SEO_KEYS.pages) ?? null).toBe(before);
    const draft = (await seoOverridesStore.readState()).draft!;
    expect(draft["/fiyatlar"]?.description?.length).toBeLessThanOrEqual(155);
  });
});

describe("redirect_404_draft kapsam kapısı", () => {
  const ORIGIN = "https://emlaksoft.com.tr";
  const notFound = (p: string, extra: Record<string, unknown> = {}) => ({ url: `${ORIGIN}${p}`, code: "http-error", manualOnly: false, evidence: { status: 404 }, ...extra });
  it("manualOnly ya da kapsam dışı yol hiçbir zaman yönlendirme taslağı almaz", async () => {
    for (const p of ["/kayit", "/kayit/tamamla", "/giris", "/app", "/admin", "/sifre-yenile", "/vitrin/ofis", "/"]) {
      expect(redirect404DraftExecutor.canHandle(notFound(p)), p).toBe(false);
      expect(await redirect404DraftExecutor.plan(notFound(p)), p).toBeNull();
    }
    expect(redirect404DraftExecutor.canHandle(notFound("/fiyat", { manualOnly: true }))).toBe(false);
  });
  it("yalnız bulunamadı bulgusu: başka kodlar ve broken-link (kaynak sayfa adresi) reddedilir", () => {
    expect(redirect404DraftExecutor.canHandle({ url: `${ORIGIN}/fiyat`, code: "long-description", manualOnly: false })).toBe(false);
    expect(redirect404DraftExecutor.canHandle({ url: `${ORIGIN}/fiyat`, code: "broken-link", manualOnly: false })).toBe(false);
    expect(redirect404DraftExecutor.canHandle(notFound("/fiyat", { evidence: { status: 500 } }))).toBe(false);
    expect(redirect404DraftExecutor.canHandle(notFound("/fiyat"))).toBe(true);
    expect(redirect404DraftExecutor.canHandle({ url: `${ORIGIN}/fiyat`, code: "x", manualOnly: false, proposal: { rule: "redirect_404", summary: "x" } })).toBe(true);
  });
});
