import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "super_admin" as string,
  writes: [] as { key: string; value: string | null }[],
  logs: [] as { action: string }[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/platform", () => ({ requirePlatformModule: async () => ({ id: "staff1", role: h.role }) }));
vi.mock("@/lib/platform-activity", () => ({
  logPlatformActivity: async (e: { action: string }) => {
    h.logs.push(e);
  },
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/platform-settings", () => ({
  getPlatformSetting: async () => null,
  setPlatformSetting: async (key: string, value: string | null) => {
    h.writes.push({ key, value });
    return true;
  },
}));

import { saveEfWelcomeUnits } from "./platform-billing-plans";

const fd = (v: string) => {
  const f = new FormData();
  f.set("welcome_units", v);
  return f;
};

beforeEach(() => {
  h.role = "super_admin";
  h.writes = [];
  h.logs = [];
});

describe("saveEfWelcomeUnits (admin)", () => {
  it("yalnız süper admin yazar", async () => {
    h.role = "support";
    const r = await saveEfWelcomeUnits(fd("10"));
    expect(r.error).toMatch(/süper admin/i);
    expect(h.writes).toEqual([]);
  });

  it("süper admin: ef.welcome_units yazılır ve etkinlik günlüğüne düşer; 0 = kapalı", async () => {
    expect((await saveEfWelcomeUnits(fd("25"))).ok).toBe(true);
    const off = await saveEfWelcomeUnits(fd("0"));
    expect(off.ok).toBe(true);
    expect(off.notice).toMatch(/kapat/i);
    expect(h.writes).toEqual([
      { key: "ef.welcome_units", value: "25" },
      { key: "ef.welcome_units", value: "0" },
    ]);
    expect(h.logs.map((l) => l.action)).toEqual(["billing.ef_welcome.save", "billing.ef_welcome.save"]);
  });

  it("geçersiz değer reddedilir ve yazılmaz", async () => {
    for (const v of ["", "-1", "1.5", "abc", "1001"]) {
      expect((await saveEfWelcomeUnits(fd(v))).error, v).toBeTruthy();
    }
    expect(h.writes).toEqual([]);
  });
});
