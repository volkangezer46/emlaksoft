import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DG1 kabul: özel rol atanan personel yalnız izinli modülleri görür ve eylemler SUNUCUDA reddedilir.
 * Gerçek `src/lib/platform.ts` kimlik kapısı (özel rol gömmesi, fail-closed, migration öncesi geri düşüş) ve
 * `guardPlatformAction` çalışır; yalnız Supabase istemcisi ve Next istek evresi taklittir.
 */

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  firstError: null as { code: string } | null,
  legacyRow: null as Record<string, unknown> | null,
  phase: "render" as "render" | "action",
  selects: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/platform-action-phase", () => ({
  inServerActionPhase: () => state.phase === "action",
  gateAction: (a?: string) => a ?? (state.phase === "action" ? "write" : "view"),
}));
vi.mock("@/lib/supabase/auth-cache", () => ({ getRequestUser: async () => ({ id: "u1", email: "c@x", app_metadata: {}, user_metadata: {} }) }));
vi.mock("@/lib/platform-security/mfa-policy", () => ({ getPlatformMfaPolicyNow: async () => ({ enforced: false }), mfaRequiredFor: () => false }));
vi.mock("@/lib/platform-security/admin-access-cache", () => ({ readAdminAccessPolicyCached: async () => ({ maxHours: 0 }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      let cols = "";
      const q = {
        select: (c: string) => ((cols = c), state.selects.push(c), q),
        eq: () => q,
        maybeSingle: async () => {
          if (cols.includes("custom_role")) return state.firstError ? { data: null, error: state.firstError } : { data: state.row, error: null };
          return { data: state.legacyRow, error: null };
        },
      };
      return q;
    },
    auth: { getClaims: async () => ({ data: null, error: null }) },
  }),
}));

const { requirePlatformModule, getPlatformStaff } = await import("@/lib/platform");
const { guardPlatformAction } = await import("@/lib/platform-guards");
const { platformModulesFor } = await import("@/lib/platform-access");

const BASE = { id: "u1", email: "c@x", full_name: "Cem", is_active: true };

describe("DG1 özel rol: sunucu kapıları", () => {
  beforeEach(() => {
    state.phase = "render";
    state.firstError = null;
    state.selects = [];
    // Taban rol ops (geniş) ama özel rol yalnız destek görüntüleme + faturalama yazma verir.
    state.row = {
      ...BASE,
      role: "ops",
      custom_role_id: "r1",
      custom_role: { id: "r1", label: "Destek izleyici", base_role: "ops", permissions: { tickets: ["view"], billing: ["write"] } },
    };
    state.legacyRow = null;
  });

  it("kimlik özel rolü taşır; menü modülleri yalnız matristekiler", async () => {
    const staff = await getPlatformStaff();
    expect(staff?.customRole?.label).toBe("Destek izleyici");
    expect(platformModulesFor(staff!)).toEqual(["dashboard", "billing", "tickets"]);
  });

  it("izinsiz modül sayfası /admin'e döner (taban rol ops'un modülleri sızmaz)", async () => {
    await expect(requirePlatformModule("tenants")).rejects.toThrow("REDIRECT:/admin");
    await expect(requirePlatformModule("sistem")).rejects.toThrow("REDIRECT:/admin");
    await expect(requirePlatformModule("tickets")).resolves.toMatchObject({ id: "u1" });
  });

  it("salt okunur modülde server action reddedilir, yazma yetkili modülde geçer", async () => {
    state.phase = "action";
    await expect(requirePlatformModule("tickets")).rejects.toThrow("REDIRECT:/admin");
    expect(await guardPlatformAction({ module: "tickets" })).toEqual({ error: "Bu işlem için yetkiniz yok." });
    expect(await guardPlatformAction({ module: "tenants" })).toEqual({ error: "Bu işlem için yetkiniz yok." });
    expect(await guardPlatformAction({ module: "billing" })).toMatchObject({ staff: { id: "u1" } });
    // Kritik (approve) eylem: yazma yetkisi yetmez.
    expect(await guardPlatformAction({ module: "billing", action: "approve" })).toEqual({ error: "Bu işlem için yetkiniz yok." });
    // Rol listeli kapı (yalnız süper admin) özel rolle aşılmaz.
    expect(await guardPlatformAction({ module: "billing", roles: ["super_admin"] })).toEqual({ error: "Bu işlem yalnız süper admin içindir." });
  });

  it("FAIL-CLOSED: özel rol atanmış ama okunamıyorsa taban rol yetkisi verilmez", async () => {
    state.row = { ...BASE, role: "ops", custom_role_id: "r1", custom_role: null };
    const staff = await getPlatformStaff();
    expect(platformModulesFor(staff!)).toEqual(["dashboard"]);
    await expect(requirePlatformModule("tenants")).rejects.toThrow("REDIRECT:/admin");
  });

  it("migration öncesi (sütun yok): eski sorguya düşer, sabit rol aynen çalışır", async () => {
    state.firstError = { code: "42703" };
    state.legacyRow = { ...BASE, role: "ops" };
    const staff = await getPlatformStaff();
    expect(staff?.customRole).toBeNull();
    await expect(requirePlatformModule("tenants")).resolves.toMatchObject({ role: "ops" });
    state.phase = "action";
    await expect(requirePlatformModule("tenants")).resolves.toMatchObject({ role: "ops" });
    // Her kimlik okumasında önce özel rollü sorgu, sütun yok hatasında eski sorgu (istek önbelleği testte yok).
    expect(state.selects.filter((c) => !c.includes("custom_role")).length).toBe(state.selects.length / 2);
  });

  it("sabit rol: action evresinde de aynı modüller (ops × reklam dışında davranış değişmez)", async () => {
    state.row = { ...BASE, role: "billing", custom_role_id: null, custom_role: null };
    state.phase = "action";
    await expect(requirePlatformModule("billing")).resolves.toMatchObject({ role: "billing" });
    await expect(requirePlatformModule("tickets")).resolves.toMatchObject({ role: "billing" });
    await expect(requirePlatformModule("sistem")).rejects.toThrow("REDIRECT:/admin");
  });
});
