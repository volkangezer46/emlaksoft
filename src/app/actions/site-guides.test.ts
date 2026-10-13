import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Rehber eylemleri yetki sözleşmesi: operasyon (ops) taslak açar ve kaydeder ama YAYINLAYAMAZ, geri alamaz, yayından
 * kaldıramaz; süper admin yayınlar. Her yazma platform etkinlik günlüğüne düşer. platform_settings bellek içi taklittir.
 */
const h = vi.hoisted(() => ({
  staff: { id: "00000000-0000-4000-8000-0000000000aa", role: "super_admin", full_name: "Süper" } as { id: string; role: string; full_name: string },
  rows: new Map<string, { value: string | null; version: number }>(),
  audit: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/platform", () => ({ requirePlatformModule: async () => h.staff }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/platform-activity", () => ({
  logPlatformActivity: async (e: { action: string }) => {
    h.audit.push(e.action);
  },
}));
vi.mock("@/lib/platform-settings", () => ({
  readPlatformSettingStrict: async (key: string) => h.rows.get(key) ?? null,
  getPlatformSetting: async (key: string) => h.rows.get(key)?.value ?? null,
  setPlatformSetting: async (key: string, value: string | null, _s?: string, meta?: { expectedVersion?: number | null; out?: { conflict?: boolean } }) => {
    const cur = h.rows.get(key)?.version ?? 0;
    if (meta?.expectedVersion != null && meta.expectedVersion !== cur) {
      if (meta.out) meta.out.conflict = true;
      return false;
    }
    h.rows.set(key, { value, version: cur + 1 });
    return true;
  },
}));

import { createGuide, publishGuide, rollbackGuide, saveGuideDraft, unpublishGuide } from "./site-guides";
import { getPublishedGuideIndex, guideStore, readGuideIndexState } from "@/lib/guides/store";

const asOps = () => (h.staff = { id: "00000000-0000-4000-8000-0000000000bb", role: "ops", full_name: "Operasyon" });
const asSuper = () => (h.staff = { id: "00000000-0000-4000-8000-0000000000aa", role: "super_admin", full_name: "Süper" });

beforeEach(() => {
  h.rows.clear();
  h.audit.length = 0;
  asSuper();
});

describe("rehber eylemleri yetkisi", () => {
  it("ops taslak açar ve kaydeder; yayınlayamaz, yayından kaldıramaz, geri alamaz", async () => {
    asOps();
    const created = await createGuide("Kira Artışı Rehberi", "mevzuat-ve-kvkk");
    expect(created.ok).toBe(true);
    const id = created.id!;
    const idx = await readGuideIndexState();
    expect(idx.ok && idx.list[0]).toMatchObject({ slug: "kira-artisi-rehberi", status: "taslak" });

    const draft = (await guideStore(id).readState()).draft!;
    expect((await saveGuideDraft(id, { ...draft, body: [{ type: "p", text: "Yeni paragraf" }] })).ok).toBe(true);

    const pub = await publishGuide(id, "ops denemesi");
    expect(pub.error).toMatch(/yalnız süper admin/);
    expect(await guideStore(id).readLive()).toBeNull();
    expect(await getPublishedGuideIndex()).toEqual([]);
    expect((await unpublishGuide(id)).error).toMatch(/yalnız süper admin/);
    expect((await rollbackGuide(id, "x")).error).toMatch(/yalnız süper admin/);
    expect(h.audit).toEqual(["site_guide.create", "site_guide.draft_save"]);
  });

  it("süper admin yayınlar, kaldırır ve geri alır; her adım günlüğe düşer", async () => {
    const { id } = await createGuide("Ofis Yönetimi 101", "ofis-yonetimi");
    expect((await publishGuide(id!, "İlk yayın")).ok).toBe(true);
    expect((await getPublishedGuideIndex()).map((e) => e.id)).toEqual([id]);
    const historyId = (await guideStore(id!).readState()).history[0]!.id;
    expect((await unpublishGuide(id!)).ok).toBe(true);
    expect(await getPublishedGuideIndex()).toEqual([]);
    expect((await rollbackGuide(id!, historyId)).ok).toBe(true);
    expect((await getPublishedGuideIndex()).map((e) => e.id)).toEqual([id]);
    expect(h.audit).toEqual(["site_guide.create", "site_guide.publish", "site_guide.unpublish", "site_guide.rollback"]);
  });

  it("rezerve ve güvensiz girdiler reddedilir", async () => {
    expect((await createGuide("Admin", "ofis-yonetimi")).error).toMatch(/ayrılmış/);
    expect((await createGuide("Başlık", "blog")).error).toMatch(/Kategori/);
    const { id } = await createGuide("Güvenli yazı", "ofis-yonetimi");
    const draft = (await guideStore(id!).readState()).draft!;
    const bad = await saveGuideDraft(id!, { ...draft, body: [{ type: "p", text: "[x](javascript:alert(1))" }] });
    expect(bad.error).toBeTruthy();
    expect(bad.issues?.some((i) => i.level === "error")).toBe(true);
    expect((await saveGuideDraft(id!, draft, "giris")).error).toMatch(/ayrılmış/);
  });
});
