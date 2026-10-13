import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "super_admin" as string,
  stored: null as string | null,
  writes: [] as string[],
  audits: [] as unknown[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/platform", () => ({ requirePlatformModule: async () => ({ id: "staff-1", role: h.role }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: async (x: unknown) => void h.audits.push(x) }));
vi.mock("@/lib/platform-settings", () => ({
  getPlatformSetting: async () => h.stored,
  setPlatformSetting: async (_k: string, v: string) => {
    h.writes.push(v);
    h.stored = v;
    return true;
  },
}));

import { saveMeasureSettings } from "./measure-admin";
import { parseMeasureSettings } from "@/lib/measure/settings";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe("saveMeasureSettings", () => {
  beforeEach(() => {
    h.role = "super_admin";
    h.stored = null;
    h.writes.length = 0;
    h.audits.length = 0;
  });

  it("yalnız süper admin değiştirebilir", async () => {
    h.role = "ops";
    const r = await saveMeasureSettings(form({ pageviews: "on", vitals: "on", attribution: "on", legalConfirmed: "on" }));
    expect(r.error).toMatch(/süper admin/);
    expect(h.writes).toHaveLength(0);
  });

  it("atıf taşımayı açmak aydınlatma onayı ister", async () => {
    const r = await saveMeasureSettings(form({ pageviews: "on", vitals: "on", attribution: "on" }));
    expect(r.error).toMatch(/aydınlatma/i);
    expect(h.writes).toHaveLength(0);
  });

  it("onayla açılır, onay zamanı saklanır ve denetim izine yazılır; kapatmak onay istemez", async () => {
    const r = await saveMeasureSettings(form({ pageviews: "on", vitals: "on", attribution: "on", legalConfirmed: "on" }));
    expect(r.ok).toBe(true);
    const s = parseMeasureSettings(h.stored);
    expect(s.attribution).toBe(true);
    expect(s.attributionLegalAt).not.toBeNull();
    expect(h.audits).toHaveLength(1);
    const off = await saveMeasureSettings(form({ pageviews: "on" }));
    expect(off.ok).toBe(true);
    expect(parseMeasureSettings(h.stored)).toMatchObject({ pageviews: true, vitals: false, attribution: false });
  });

  it("ayar çözümleyici: onay zamanı yoksa atıf açık sayılmaz; bozuk değer varsayılan", () => {
    expect(parseMeasureSettings('{"attribution":true}').attribution).toBe(false);
    expect(parseMeasureSettings("bozuk")).toEqual({ pageviews: true, vitals: true, attribution: false, attributionLegalAt: null });
  });
});
