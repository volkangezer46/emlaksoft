import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Rehber deposu: taslak canlıyı değiştirmez, yayın ve geri dönüş çalışır, liste sürüm kilidiyle yazılır ve "okunamadı"
 * asla "kayıt yok" sayılmaz. Yayın masası yüzeyi aynı depo işlevlerini kullanır. platform_settings bellek içi taklittir.
 */
const db = vi.hoisted(() => ({
  rows: new Map<string, { value: string | null; version: number }>(),
  failRead: false,
}));

vi.mock("next/cache", () => ({ unstable_cache: <T,>(fn: T) => fn }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/platform-settings", () => ({
  readPlatformSettingStrict: vi.fn(async (key: string) => {
    if (db.failRead) throw new Error("bağlantı koptu");
    return db.rows.get(key) ?? null;
  }),
  getPlatformSetting: vi.fn(async (key: string) => (db.failRead ? null : (db.rows.get(key)?.value ?? null))),
  setPlatformSetting: vi.fn(async (key: string, value: string | null, _staff?: string, meta?: { expectedVersion?: number | null; out?: { conflict?: boolean } }) => {
    const cur = db.rows.get(key)?.version ?? 0;
    if (meta?.expectedVersion != null && meta.expectedVersion !== cur) {
      if (meta.out) meta.out.conflict = true;
      return false;
    }
    db.rows.set(key, { value, version: cur + 1 });
    return true;
  }),
}));

import { guidePublishSurface } from "./publish-surface";
import { emptyGuide, type GuideContent, type GuideIndexEntry } from "./schema";
import { listGuideSitemapEntries } from "./sitemap";
import {
  GUIDES_INDEX_KEY,
  getLiveGuide,
  getPublishedGuideIndex,
  guideStore,
  listPublishedGuides,
  publishGuideContent,
  readGuideIndexState,
  unpublishGuideEntry,
  writeGuideIndex,
} from "./store";

const ID = "aaaaaaaaaaaa";
const content = (title: string): GuideContent => ({ ...emptyGuide(title, "ofis-yonetimi"), body: [{ type: "p", text: `${title} ${"söz ".repeat(320)}` }] });
const entry = (over: Partial<GuideIndexEntry> = {}): GuideIndexEntry => ({
  id: ID,
  slug: "ofis-rehberi",
  title: "Taslak",
  category: "ofis-yonetimi",
  status: "taslak",
  publishedAt: null,
  firstPublishedAt: null,
  updatedAt: "2026-10-01T00:00:00.000Z",
  updatedBy: "Test",
  ...over,
});
const meta = (id: string, at: string, label = "Yayın") => ({ id, at, by: "Süper", label });

async function seed(list: GuideIndexEntry[]) {
  const r = await readGuideIndexState();
  if (!r.ok) throw new Error("okunamadı");
  expect(await writeGuideIndex(list, "staff", r.version)).toBe("ok");
}

beforeEach(() => {
  db.rows.clear();
  db.failRead = false;
});

describe("rehber listesi", () => {
  it("kayıt yoksa boş liste; okuma hatası ve bozuk liste 'okunamadı' sayılır, önbellekli okuma fırlatır", async () => {
    expect(await readGuideIndexState()).toEqual({ ok: true, list: [], version: 0 });
    db.rows.set(GUIDES_INDEX_KEY, { value: "{bozuk", version: 2 });
    expect(await readGuideIndexState()).toEqual({ ok: false });
    db.failRead = true;
    expect(await readGuideIndexState()).toEqual({ ok: false });
    await expect(getPublishedGuideIndex()).rejects.toThrow();
    await expect(listPublishedGuides()).rejects.toThrow();
    expect(await listGuideSitemapEntries("https://x.test")).toEqual([]);
  });

  it("sürüm kilidi: arada değişmişse çakışma döner ve yazmaz", async () => {
    const first = await readGuideIndexState();
    if (!first.ok) throw new Error("okunamadı");
    expect(await writeGuideIndex([entry()], "s", first.version)).toBe("ok");
    expect(await writeGuideIndex([], "s", first.version)).toBe("conflict");
    const after = await readGuideIndexState();
    expect(after.ok && after.list.map((e) => e.id)).toEqual([ID]);
  });
});

describe("taslak / yayın / geri dönüş", () => {
  it("taslak canlıyı değiştirmez; yayın canlıya alır ve listeyi işaretler", async () => {
    await seed([entry()]);
    const store = guideStore(ID);
    await store.saveDraft(content("İlk"), "s");
    expect(await getLiveGuide(ID)).toBeNull();
    expect(await getPublishedGuideIndex()).toEqual([]);

    const res = await publishGuideContent(ID, content("İlk"), meta("h1", "2026-10-10T09:00:00.000Z"), "s");
    expect(res.ok).toBe(true);
    expect((await getLiveGuide(ID))?.title).toBe("İlk");
    const [pub] = await getPublishedGuideIndex();
    expect(pub).toMatchObject({ status: "yayinda", publishedAt: "2026-10-10T09:00:00.000Z", firstPublishedAt: "2026-10-10T09:00:00.000Z" });

    // Yeni taslak canlıyı değiştirmez.
    await store.saveDraft(content("Taslak iki"), "s");
    expect((await getLiveGuide(ID))?.title).toBe("İlk");
    expect((await listPublishedGuides())[0]?.content.title).toBe("İlk");
  });

  it("ikinci yayın publishedAt'i ilerletir, ilk yayın sabit kalır; geçmişten geri dönüş canlıyı eski sürüme alır", async () => {
    await seed([entry()]);
    await publishGuideContent(ID, content("Bir"), meta("h1", "2026-10-01T09:00:00.000Z"), "s");
    await publishGuideContent(ID, content("İki"), meta("h2", "2026-10-05T09:00:00.000Z"), "s");
    const state = await guideStore(ID).readState();
    expect(state.history.map((h) => h.id)).toEqual(["h2", "h1"]);
    const [e] = await getPublishedGuideIndex();
    expect(e).toMatchObject({ publishedAt: "2026-10-05T09:00:00.000Z", firstPublishedAt: "2026-10-01T09:00:00.000Z" });

    // Sitemap lastmod = yayın geçmişindeki en son `at` (yazı, liste ve kategori sayfası aynı gerçek zamanı taşır).
    const sm = await listGuideSitemapEntries("https://x.test");
    const at = state.history[0]!.at;
    expect(sm).toEqual([
      expect.objectContaining({ url: "https://x.test/rehber", lastModified: at }),
      expect.objectContaining({ url: "https://x.test/rehber/kategori/ofis-yonetimi", lastModified: at }),
      expect.objectContaining({ url: "https://x.test/rehber/ofis-rehberi", lastModified: at }),
    ]);

    const surface = guidePublishSurface({ id: ID, slug: "ofis-rehberi", category: "ofis-yonetimi", title: "İki" });
    const back = await surface.restore("h1", "s", "Süper");
    expect(back.ok).toBe(true);
    expect((await getLiveGuide(ID))?.title).toBe("Bir");
    expect((await guideStore(ID).readState()).history[0]?.label).toBe("Geri dönüş: Yayın");
  });

  it("yayından kaldırma yolu kapatır, içerik ve geçmiş saklanır; yüzey 'varsayılana dön' de aynı işi yapar", async () => {
    await seed([entry()]);
    await publishGuideContent(ID, content("Bir"), meta("h1", "2026-10-01T09:00:00.000Z"), "s");
    const r = await unpublishGuideEntry(ID, "s", "Süper", "2026-10-02T00:00:00.000Z");
    expect(r.ok && r.entry.status).toBe("arsiv");
    expect(await getPublishedGuideIndex()).toEqual([]);
    expect((await guideStore(ID).readState()).history).toHaveLength(1);

    await publishGuideContent(ID, content("Bir"), meta("h2", "2026-10-03T09:00:00.000Z"), "s");
    const surface = guidePublishSurface({ id: ID, slug: "ofis-rehberi", category: "ofis-yonetimi", title: "Bir" });
    expect(await surface.resetToDefault("s", "Süper")).toEqual({ ok: true });
    expect(await getPublishedGuideIndex()).toEqual([]);
  });

  it("yüzey: zamanlı yayında editördeki farklı taslak korunur; geçersiz içerik kalıcı hatadır", async () => {
    await seed([entry()]);
    const store = guideStore(ID);
    await store.saveDraft(content("Editörde süren"), "s");
    const surface = guidePublishSurface({ id: ID, slug: "ofis-rehberi", category: "ofis-yonetimi", title: "x" });
    expect(surface.surfaceId).toBe("guide");
    expect(surface.livePaths.map((p) => p.path)).toEqual(["/rehber", "/rehber/ofis-rehberi", "/rehber/kategori/ofis-yonetimi", "/rehber/rss.xml"]);
    expect(await surface.publish(content("Zamanlı"), "s", "Zamanlı yayın", "Süper", { keepDraft: true })).toEqual({ ok: true });
    const s = await store.readState();
    expect(s.live?.title).toBe("Zamanlı");
    expect(s.draft?.title).toBe("Editörde süren");

    const bad = await surface.publish({ ...content("x"), body: [{ type: "p", text: "[x](javascript:alert(1))" }] }, "s", "Kötü");
    expect(bad).toMatchObject({ ok: false, permanent: true });
  });

  it("liste okunamıyorsa yayın yapılmaz (canlı yazılmaz)", async () => {
    db.rows.set(GUIDES_INDEX_KEY, { value: "[{\"id\":1}]", version: 1 });
    const res = await publishGuideContent(ID, content("x"), meta("h1", "2026-10-01T00:00:00.000Z"), "s");
    expect(res.ok).toBe(false);
    expect(db.rows.has(guideStore(ID).keys.live)).toBe(false);
  });
});

describe("Yayın masası kaydı (S5): rehber yazısı dinamik yüzeydir", () => {
  it("resolveSurface('guide:<id>') yazının yüzeyini verir; toplu yayın listesinde (SURFACES) rehber yok", async () => {
    const { SURFACES, resolveSurface } = await import("@/lib/publishing/surfaces");
    await seed([entry()]);
    const s = await resolveSurface(`guide:${ID}`);
    expect(s).toMatchObject({ id: `guide:${ID}`, module: "sitecontent", editorHref: `/admin/site/rehber/${ID}` });
    expect(s!.livePaths.map((p) => p.path)).toContain("/rehber");
    expect(await resolveSurface("guide:bbbbbbbbbbbb")).toBeNull();
    expect(await resolveSurface("guide:../x")).toBeNull();
    expect(SURFACES.some((x) => x.id.startsWith("guide:"))).toBe(false);
    // Yayın masası yüzeyi depoyu kullanır: yayın canlıya alır.
    await guideStore(ID).saveDraft(content("Masadan"), "s");
    const st = await s!.readState();
    expect((await s!.publish(st.draft, "s", "Masadan yayın", "Süper")).ok).toBe(true);
    expect((await getLiveGuide(ID))?.title).toBe("Masadan");
  });

  it("masa adayları: taslağı yayından yeni ya da hiç yayınlanmamış yazılar (arşiv hariç)", async () => {
    const { deskGuideSurfaces } = await import("@/lib/publishing/surfaces");
    await seed([
      entry(),
      entry({ id: "bbbbbbbbbbbb", slug: "yayinda", status: "yayinda", publishedAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z" }),
      entry({ id: "cccccccccccc", slug: "duzenlenen", status: "yayinda", publishedAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-06T00:00:00.000Z" }),
      entry({ id: "dddddddddddd", slug: "arsiv", status: "arsiv" }),
    ]);
    expect((await deskGuideSurfaces()).map((s) => s.id).sort()).toEqual([`guide:${ID}`, "guide:cccccccccccc"]);
    expect((await deskGuideSurfaces(["guide:bbbbbbbbbbbb"])).map((s) => s.id)).toContain("guide:bbbbbbbbbbbb");
  });
});
