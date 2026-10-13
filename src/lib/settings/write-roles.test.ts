import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "support" as string, prepared: 0 }));

vi.mock("next/cache", () => ({ updateTag: vi.fn() }));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: vi.fn() }));
vi.mock("@/lib/platform-settings", () => ({ getPlatformSetting: vi.fn(), setPlatformSetting: vi.fn() }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: vi.fn() }));
vi.mock("./history", () => ({ getSettingHistory: vi.fn() }));
vi.mock("./read", () => ({ SETTINGS_PLATFORM_TAG: "settings-platform", settingsTenantTag: (id: string) => `settings-${id}` }));
vi.mock("./prepare", () => ({
  prepareWrite: vi.fn(() => {
    state.prepared += 1;
    return { ok: false, error: "durdu" };
  }),
}));
vi.mock("@/lib/platform-guards", () => ({
  guardPlatformAction: vi.fn(async () => ({ staff: { id: "s1", role: state.role } })),
}));

import { writeSetting } from "./write";

/** Destek ayarları sunucuda yalnız süper admin + operasyonca yazılır (tickets modülü erişimi tek başına yetmez). */
describe("writeSetting platform rol kapısı", () => {
  beforeEach(() => {
    state.prepared = 0;
  });

  it.each(["support", "billing"])("%s rolü support.waiting_automation_enabled yazamaz", async (role) => {
    state.role = role;
    const res = await writeSetting({ key: "support.waiting_automation_enabled", value: true, reason: "deneme" });
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.error).toContain("yetkiniz yok");
    expect(state.prepared).toBe(0);
  });

  it.each(["super_admin", "ops"])("%s rolü kapıdan geçer", async (role) => {
    state.role = role;
    await writeSetting({ key: "support.auto_assign_enabled", value: false, reason: "deneme" });
    expect(state.prepared).toBe(1);
  });
});
