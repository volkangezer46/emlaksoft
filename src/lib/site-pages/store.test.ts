import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sayfa listesi depolaması: "okunamadı" asla "kayıt yok" sayılmaz (yazma ezmez, önbelleğe boş girmez) ve liste
 * sürüm kilidiyle yazılır.
 */
const db = vi.hoisted(() => ({
  rows: new Map<string, { value: string | null; version: number }>(),
  failRead: false,
  calls: [] as Array<{ key: string; expectedVersion: number | null | undefined }>,
}));

vi.mock("next/cache", () => ({ unstable_cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/platform-settings", () => ({
  readPlatformSettingStrict: vi.fn(async (key: string) => {
    if (db.failRead) throw new Error("bağlantı koptu");
    return db.rows.get(key) ?? null;
  }),
  getPlatformSetting: vi.fn(async (key: string) => (db.failRead ? null : (db.rows.get(key)?.value ?? null))),
  setPlatformSetting: vi.fn(async (key: string, value: string | null, _staff?: string, meta?: { expectedVersion?: number | null; out?: { conflict?: boolean } }) => {
    db.calls.push({ key, expectedVersion: meta?.expectedVersion });
    const cur = db.rows.get(key)?.version ?? 0;
    if (meta?.expectedVersion != null && meta.expectedVersion !== cur) {
      if (meta.out) meta.out.conflict = true;
      return false;
    }
    db.rows.set(key, { value, version: cur + 1 });
    return true;
  }),
}));

import { SITE_PAGES_INDEX_KEY, getLiveSitePage, getPublishedSlugMap, readSitePageIndexState, writeSitePageIndex } from "./store";
import type { SitePageIndexEntry } from "./schema";

const entry = (id: string, slug: string, status: SitePageIndexEntry["status"] = "yayinda"): SitePageIndexEntry => ({
  id,
  slug,
  title: slug,
  kind: "kurumsal",
  status,
  updatedAt: "2026-10-13T00:00:00.000Z",
  updatedBy: "Test",
});

beforeEach(() => {
  db.rows.clear();
  db.failRead = false;
  db.calls.length = 0;
});

describe("sayfa listesi okuma", () => {
  it("kayıt yoksa boş liste ve sürüm 0", async () => {
    expect(await readSitePageIndexState()).toEqual({ ok: true, list: [], version: 0 });
  });

  it("okuma hatası ve bozuk liste 'boş' değil, okunamadı sayılır", async () => {
    db.failRead = true;
    expect(await readSitePageIndexState()).toEqual({ ok: false });
    db.failRead = false;
    db.rows.set(SITE_PAGES_INDEX_KEY, { value: "{bozuk", version: 3 });
    expect(await readSitePageIndexState()).toEqual({ ok: false });
    db.rows.set(SITE_PAGES_INDEX_KEY, { value: JSON.stringify([{ id: "x" }]), version: 3 });
    expect(await readSitePageIndexState()).toEqual({ ok: false });
  });

  it("önbellekli okumalar hata fırlatır (boş sonuç önbelleğe girmez)", async () => {
    db.failRead = true;
    await expect(getPublishedSlugMap()).rejects.toThrow();
    await expect(getLiveSitePage("aaaaaaaaaaaa")).rejects.toThrow();
  });
});

describe("sayfa listesi yazma (sürüm kilidi)", () => {
  it("okunan sürümle yazar; arada değişmişse çakışma döner ve yazmaz", async () => {
    const a = entry("aaaaaaaaaaaa", "hakkimizda");
    const first = await readSitePageIndexState();
    if (!first.ok) throw new Error("okunamadı");
    expect(await writeSitePageIndex([a], "staff", first.version)).toBe("ok");
    expect(db.calls.at(-1)).toEqual({ key: SITE_PAGES_INDEX_KEY, expectedVersion: 0 });

    // İki oturum aynı sürümü okur; ikincisi çakışır, ilk yazılan kaybolmaz.
    const s1 = await readSitePageIndexState();
    const s2 = await readSitePageIndexState();
    if (!s1.ok || !s2.ok) throw new Error("okunamadı");
    expect(await writeSitePageIndex([...s1.list, entry("bbbbbbbbbbbb", "iletisim")], "staff", s1.version)).toBe("ok");
    expect(await writeSitePageIndex([...s2.list, entry("cccccccccccc", "kampanya")], "staff", s2.version)).toBe("conflict");
    const after = JSON.parse(db.rows.get(SITE_PAGES_INDEX_KEY)?.value ?? "[]") as SitePageIndexEntry[];
    expect(after.map((e) => e.slug)).toEqual(["hakkimizda", "iletisim"]);
  });
});
