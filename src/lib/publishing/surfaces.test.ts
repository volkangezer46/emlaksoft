import { beforeEach, describe, expect, it, vi } from "vitest";

/** Bellek içi platform_settings: yüzey bağdaştırıcıları gerçek depo kodu (menü/içerik depoları) üzerinden çalışır. */
const db = new Map<string, string>();
let failReads = false;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/platform-settings", () => ({
  getPlatformSetting: async (k: string) => db.get(k) ?? null,
  getPlatformSettingsMany: async (keys: string[], opts?: { strict?: boolean }) => {
    if (failReads && opts?.strict) throw new Error("PostgREST 503");
    return Object.fromEntries(keys.map((k) => [k, failReads ? null : (db.get(k) ?? null)]));
  },
  setPlatformSetting: async (k: string, v: string | null) => {
    if (v === null) db.delete(k);
    else db.set(k, v);
    return true;
  },
}));

import { defaultSiteMenu } from "@/lib/site-menu/defaults";
import type { SiteMenuConfig } from "@/lib/site-menu/schema";
import { surfaceById } from "./surfaces";

const MEDIA = "abcdef123456";
const OLD = "2020-01-01T00:00:00.000Z";

function menu(text: string, withMedia = false): SiteMenuConfig {
  const m = defaultSiteMenu();
  m.announcement = { ...m.announcement, text };
  if (withMedia) {
    const g = m.groups.find((x) => x.items.length > 0)!;
    g.items[0] = { ...g.items[0]!, icon: { kind: "media", mediaId: MEDIA } };
  }
  return m;
}

/** Editörde yarım kalmış, 24 saatten eski medyaya başvuran taslak; canlı başka bir menü. */
function seedMenu(live: SiteMenuConfig | null) {
  db.clear();
  if (live) db.set("sitemenu.live", JSON.stringify(live));
  db.set("sitemenu.draft", JSON.stringify(menu("Editördeki taslak", true)));
  db.set("sitemenu.media.index", JSON.stringify([{ id: MEDIA, type: "image/png", kind: "image", bytes: 10, w: 1, h: 1, name: "a.png", at: OLD }]));
  db.set(`sitemenu.media.${MEDIA}`, JSON.stringify({ type: "image/png", enc: "base64", data: "AA==" }));
}

const draft = () => JSON.parse(db.get("sitemenu.draft") ?? "null") as SiteMenuConfig | null;

describe("yayın masası yüzeyleri (bellek içi depo)", () => {
  beforeEach(() => {
    failReads = false;
  });

  it("menü: zamanlı yayın editördeki taslağı ve medyasını korur (budama taslak geri yazıldıktan sonra)", async () => {
    seedMenu(menu("Canlı"));
    const s = surfaceById("sitemenu")!;
    const res = await s.publish(menu("Zamanlı"), "staff-1", "Zamanlı yayın: X", "Ayşe", { keepDraft: true });
    expect(res.ok).toBe(true);
    expect((JSON.parse(db.get("sitemenu.live")!) as SiteMenuConfig).announcement.text).toBe("Zamanlı");
    expect(draft()?.announcement.text).toBe("Editördeki taslak");
    expect(db.has(`sitemenu.media.${MEDIA}`)).toBe(true);
    expect(db.get("sitemenu.media.index")).toContain(MEDIA);
  });

  it("menü: varsayılana dönüşte de taslak ve medyası korunur", async () => {
    seedMenu(menu("Zamanlı"));
    const s = surfaceById("sitemenu")!;
    const res = await s.resetToDefault("staff-1", "Ayşe", { keepDraft: true });
    expect(res.ok).toBe(true);
    expect(db.has("sitemenu.live")).toBe(false);
    expect(draft()?.announcement.text).toBe("Editördeki taslak");
    expect(db.has(`sitemenu.media.${MEDIA}`)).toBe(true);
  });

  it("menü: keepDraft yoksa taslak canlıya eşitlenir ve kullanılmayan eski medya budanır", async () => {
    seedMenu(menu("Canlı"));
    const s = surfaceById("sitemenu")!;
    await s.publish(menu("Elle"), "staff-1", "Elle", "Ayşe");
    expect(draft()?.announcement.text).toBe("Elle");
    expect(db.has(`sitemenu.media.${MEDIA}`)).toBe(false);
  });

  it("sıkı canlı okuma: okunamazsa fırlatır, kayıt yoksa null, varsa ayrıştırılmış değer", async () => {
    seedMenu(null);
    const s = surfaceById("sitemenu")!;
    expect(await s.readLiveStrict()).toBeNull();
    db.set("sitemenu.live", JSON.stringify(menu("Canlı")));
    expect((await s.readLiveStrict()) as SiteMenuConfig).toMatchObject({ announcement: { text: "Canlı" } });
    failReads = true;
    await expect(s.readLiveStrict()).rejects.toThrow("PostgREST 503");
    await expect(surfaceById("sitecontent")!.readLiveStrict()).rejects.toThrow("PostgREST 503");
  });
});
