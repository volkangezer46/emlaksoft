import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Kapı: sitecontent modülü olmayan personel requirePlatformModule'da yönlendirilir (redirect fırlatır).
const h = vi.hoisted(() => {
  const ID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  const staff = { current: { id: "s1", role: "super_admin" as string, hasModule: true } };
  const row = { id: ID, alt: "Ofis", title: null, w: 1600, h: 900, bytes: 1000, mime: "image/jpeg", lqip: "", usedBy: [] as string[], createdAt: "2026-10-13T00:00:00Z", variants: [{ file: "960w-0a1b2c3d.avif", w: 960, h: 540, format: "avif", bytes: 1000 }] };
  const store = {
    usedBytes: vi.fn(async (): Promise<number | null> => 0),
    readSiteMedia: vi.fn(async (id: string) => (id === ID ? row : null)),
    uploadVariants: vi.fn(async () => true),
    insertSiteMedia: vi.fn(async () => true),
    replaceSiteMediaFiles: vi.fn(async () => true),
    removeVariantFiles: vi.fn(async () => undefined),
    deleteSiteMediaRow: vi.fn(async () => true),
    updateSiteMediaText: vi.fn(async () => true),
    listSiteMedia: vi.fn(async () => ({ status: "ok", items: [row] })),
    syncUsedBy: vi.fn(async () => undefined),
  };
  return {
    ID,
    staff,
    store,
    contentState: { current: { live: null as unknown, draft: null as unknown } },
    logPlatformActivity: vi.fn(async (_x: unknown) => undefined),
    requirePlatformModule: vi.fn(async (mod: string) => {
      if (mod !== "sitecontent" || !staff.current.hasModule) throw new Error("NEXT_REDIRECT:/admin");
      return { id: staff.current.id, role: staff.current.role, email: "x@y", full_name: "X" };
    }),
  };
});
const { ID, staff, store, contentState, logPlatformActivity } = h;

vi.mock("@/lib/platform", () => ({ requirePlatformModule: (m: string) => h.requirePlatformModule(m) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: (x: unknown) => h.logPlatformActivity(x) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/site-content/store", () => ({
  SITE_CONTENT_CACHE_TAG: "site-content",
  siteContentStore: { readState: async () => ({ ...h.contentState.current, history: [] }) },
}));
vi.mock("@/lib/site-media/store", () => ({ SITE_MEDIA_CACHE_TAG: "site-media", ...h.store }));

import { deleteSiteMedia, uploadSiteMedia } from "./site-media";

async function form(alt = "Ofiste danışman") {
  const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 10, g: 80, b: 160 } } }).png().toBuffer();
  const f = new FormData();
  // Dosya adı .svg olsa da içerik PNG: tür bayttan belirlenir.
  f.set("file", new File([new Uint8Array(png)], "kapak.svg", { type: "image/svg+xml" }));
  f.set("alt", alt);
  return f;
}

beforeEach(() => {
  staff.current = { id: "s1", role: "super_admin", hasModule: true };
  contentState.current = { live: null, draft: null };
  for (const fn of Object.values(store)) fn.mockClear();
  logPlatformActivity.mockClear();
  store.usedBytes.mockResolvedValue(0);
});

describe("uploadSiteMedia", () => {
  it("yükler: bayt imzası esas, 2 biçim varyant depoya, satır yazılır, denetime düşer", async () => {
    const res = await uploadSiteMedia(await form());
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(res.media?.mime).toBe("image/png");
    expect(res.media?.variants.map((v) => v.format).sort()).toEqual(["avif", "webp"]);
    expect(store.uploadVariants).toHaveBeenCalledOnce();
    expect(store.insertSiteMedia).toHaveBeenCalledOnce();
    expect(logPlatformActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "site_media.upload", entityType: "site_media" }));
  }, 60_000);

  it("alt metin zorunlu", async () => {
    const res = await uploadSiteMedia(await form("  "));
    expect(res.error).toMatch(/Alt metin zorunludur/);
    expect(store.uploadVariants).not.toHaveBeenCalled();
  });

  it("kota aşımı reddedilir (depoya yazılmaz)", async () => {
    store.usedBytes.mockResolvedValue(1024 * 1024 * 1024 - 10);
    const res = await uploadSiteMedia(await form());
    expect(res.error).toMatch(/kotası doldu/);
    expect(store.uploadVariants).not.toHaveBeenCalled();
    expect(store.insertSiteMedia).not.toHaveBeenCalled();
  }, 60_000);

  it("tablo yokken 'kurulum bekliyor'", async () => {
    store.usedBytes.mockResolvedValue(null);
    expect((await uploadSiteMedia(await form())).error).toMatch(/kurulmadı/);
  });

  it("yetki: sitecontent modülü olmayan kullanıcı yükleyemez; operasyon (salt okur) yükleyemez", async () => {
    staff.current = { id: "s2", role: "billing", hasModule: false };
    await expect(uploadSiteMedia(await form())).rejects.toThrow(/NEXT_REDIRECT/);
    staff.current = { id: "s3", role: "ops", hasModule: true };
    expect((await uploadSiteMedia(await form())).error).toMatch(/salt okunur/);
    expect(store.uploadVariants).not.toHaveBeenCalled();
  });
});

describe("deleteSiteMedia", () => {
  it("kullanımdaki (yayın ya da taslak) medya silinemez", async () => {
    contentState.current = { live: null, draft: { hero: { image: { mediaId: ID } } } };
    const res = await deleteSiteMedia(ID);
    expect(res.error).toMatch(/kullanımda/);
    expect(store.deleteSiteMediaRow).not.toHaveBeenCalled();
    contentState.current = { live: { hero: { image: { mediaId: ID } } }, draft: null };
    expect((await deleteSiteMedia(ID)).error).toMatch(/yayında/);
  });

  it("kullanılmayan medya silinir; dosyaları kaldırılır ve denetime düşer", async () => {
    const res = await deleteSiteMedia(ID);
    expect(res.ok).toBe(true);
    expect(store.deleteSiteMediaRow).toHaveBeenCalledWith(ID);
    expect(store.removeVariantFiles).toHaveBeenCalledWith(ID, ["960w-0a1b2c3d.avif"]);
    expect(logPlatformActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "site_media.delete" }));
  });
});
