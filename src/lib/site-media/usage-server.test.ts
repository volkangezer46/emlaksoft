import { beforeEach, describe, expect, it, vi } from "vitest";

const ID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const h = vi.hoisted(() => ({
  settings: { current: {} as Record<string, string | null> },
  fail: { current: false },
  syncUsedBy: vi.fn(async (_rows: unknown, _usage: Map<string, string[]>) => undefined),
  listSiteMedia: vi.fn(async () => ({ status: "ok", items: [{ id: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f", usedBy: [] }] })),
}));

vi.mock("@/lib/platform-settings", () => ({
  getPlatformSettingsMany: async (keys: string[], opts?: { strict?: boolean }) => {
    if (!opts?.strict) throw new Error("sıkı okuma bekleniyor");
    if (h.fail.current) throw new Error("db down");
    return Object.fromEntries(keys.map((k) => [k, h.settings.current[k] ?? null]));
  },
}));
vi.mock("@/lib/site-content/store", () => ({ siteContentStore: { keys: { live: "sitecontent.live", draft: "sitecontent.draft" } } }));
vi.mock("./store", () => ({ listSiteMedia: () => h.listSiteMedia(), syncUsedBy: (r: unknown, u: Map<string, string[]>) => h.syncUsedBy(r, u) }));

import { readSiteMediaUsageStrict, syncSiteMediaUsage } from "./usage-server";

beforeEach(() => {
  h.settings.current = {};
  h.fail.current = false;
  h.syncUsedBy.mockClear();
});

describe("medya kullanımı (sunucu)", () => {
  it("yayın + taslak ham JSON'dan hesaplanır; okuma hatası FIRLATIR (boş kullanım sayılmaz)", async () => {
    h.settings.current = { "sitecontent.live": JSON.stringify({ hero: { image: { mediaId: ID } } }), "sitecontent.draft": "{bozuk" };
    expect((await readSiteMediaUsageStrict()).get(ID)).toEqual(["sitecontent.live:hero.image"]);
    h.fail.current = true;
    await expect(readSiteMediaUsageStrict()).rejects.toThrow();
  });

  it("syncSiteMediaUsage used_by'ı eşitler; hata yutulur (site içeriği yazmasını bozmaz)", async () => {
    h.settings.current = { "sitecontent.draft": JSON.stringify({ hero: { image: { mediaId: ID } } }) };
    await syncSiteMediaUsage();
    expect(h.syncUsedBy).toHaveBeenCalledOnce();
    expect(h.syncUsedBy.mock.calls[0]![1].get(ID)).toEqual(["sitecontent.draft:hero.image"]);
    h.fail.current = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(syncSiteMediaUsage()).resolves.toBeUndefined();
    err.mockRestore();
  });
});
