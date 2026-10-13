import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Hero görsel bütçesi kalite kapısı SUNUCUDA (S7 artığı): bütçeyi aşan YENİ hero görseli gerekçesiz taslağa yazılamaz;
 * gerekçe denetim kaydına düşer. Daha önce istemcide yalnız panel vardı (doğrudan eylem çağrısı kapıyı atlatırdı).
 */
const h = vi.hoisted(() => {
  const OVER = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  const UNDER = "4f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  const variants = (kb: number) => [{ file: "960w-0a1b2c3d.avif", w: 960, h: 540, format: "avif", bytes: kb * 1024 }];
  return {
    OVER,
    UNDER,
    state: { current: { live: null as unknown, draft: null as unknown, history: [] as unknown[] } },
    saveDraft: vi.fn(async () => ({ ok: true })),
    log: vi.fn(async (_x: unknown) => undefined),
    readSiteMedia: vi.fn(async (id: string) => (id === OVER ? { id, variants: variants(300) } : id === UNDER ? { id, variants: variants(60) } : null)),
  };
});

vi.mock("@/lib/platform", () => ({ requirePlatformModule: async () => ({ id: "s1", role: "super_admin", email: "x@y", full_name: "X" }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: (x: unknown) => h.log(x) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/after-safe", () => ({ afterSafe: vi.fn() }));
vi.mock("@/lib/publishing/after-publish", () => ({ captureLiveDigests: async () => ({}), runAfterPublish: async () => ({ hooks: [], ok: true }) }));
vi.mock("@/lib/site-content/schema", () => ({ validateSiteContent: (x: unknown) => ({ config: x, issues: [] }), hasErrors: () => false }));
vi.mock("@/lib/site-content/store", () => ({
  SITE_CONTENT_CACHE_TAG: "site-content",
  siteContentStore: { readState: async () => h.state.current, saveDraft: h.saveDraft },
}));
vi.mock("@/lib/site-media/store", () => ({ listSiteMediaIds: async () => new Set([h.OVER, h.UNDER]), readSiteMedia: h.readSiteMedia }));
vi.mock("@/lib/site-media/usage", () => ({ mediaRefs: () => [] }));
vi.mock("@/lib/site-media/usage-server", () => ({ syncSiteMediaUsage: async () => undefined }));

const { saveSiteContentDraft } = await import("./site-content");
const { heroBudgetNeedsReason } = await import("@/lib/site-media/quota");

const content = (mediaId?: string) => ({ hero: mediaId ? { image: { mediaId } } : {}, faq: [] });
const overrides = () => h.log.mock.calls.map((c) => c[0] as { action: string; entityId: string; meta: { reason: string } }).filter((x) => x.action === "site_media.hero_budget_override");

beforeEach(() => {
  h.state.current = { live: null, draft: null, history: [] };
  h.saveDraft.mockClear();
  h.log.mockClear();
});

describe("hero bütçe kapısı (sunucu)", () => {
  it("bütçeyi aşan YENİ hero görseli gerekçesiz kaydedilmez (doğrudan eylem çağrısı da)", async () => {
    const r = await saveSiteContentDraft(content(h.OVER));
    expect(r).toMatchObject({ heroBudgetReasonRequired: true });
    expect(r.error).toMatch(/gerekçe/);
    expect(h.saveDraft).not.toHaveBeenCalled();
    expect(await saveSiteContentDraft(content(h.OVER), "  kısa ")).toMatchObject({ heroBudgetReasonRequired: true });
    expect(overrides()).toEqual([]);
  });

  it("gerekçeyle kaydedilir ve gerekçe denetim kaydına yazılır", async () => {
    const r = await saveSiteContentDraft(content(h.OVER), "Kampanya görseli, bir hafta yayında");
    expect(r.ok).toBe(true);
    expect(h.saveDraft).toHaveBeenCalledTimes(1);
    expect(overrides()).toEqual([expect.objectContaining({ entityId: h.OVER, meta: expect.objectContaining({ reason: "Kampanya görseli, bir hafta yayında" }) })]);
  });

  it("taslakta ya da canlıda zaten olan görsel ve bütçe içi görsel gerekçe istemez", async () => {
    h.state.current = { live: null, draft: content(h.OVER), history: [] };
    expect((await saveSiteContentDraft(content(h.OVER))).ok).toBe(true);
    h.state.current = { live: content(h.OVER), draft: null, history: [] };
    expect((await saveSiteContentDraft(content(h.OVER))).ok).toBe(true);
    h.state.current = { live: null, draft: null, history: [] };
    expect((await saveSiteContentDraft(content(h.UNDER))).ok).toBe(true);
    expect((await saveSiteContentDraft(content())).ok).toBe(true);
    expect(overrides()).toEqual([]);
  });

  it("saf karar", () => {
    expect(heroBudgetNeedsReason({ nextId: "a", draftId: null, liveId: null, over: true })).toBe(true);
    expect(heroBudgetNeedsReason({ nextId: "a", draftId: "a", liveId: null, over: true })).toBe(false);
    expect(heroBudgetNeedsReason({ nextId: "a", draftId: null, liveId: "a", over: true })).toBe(false);
    expect(heroBudgetNeedsReason({ nextId: "a", draftId: null, liveId: null, over: false })).toBe(false);
    expect(heroBudgetNeedsReason({ nextId: null, draftId: null, liveId: null, over: true })).toBe(false);
  });
});
