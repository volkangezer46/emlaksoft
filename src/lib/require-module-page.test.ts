import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/billing/page-gates", () => ({ lockedGate: vi.fn() }));
vi.mock("@/lib/cache/request", () => ({ getRequestProfile: vi.fn(), getTenantGateContext: vi.fn() }));
vi.mock("@/lib/supabase/auth-cache", () => ({ getRequestUser: vi.fn() }));
vi.mock("@/lib/platform", () => ({ getPlatformStaff: vi.fn() }));
vi.mock("@/lib/permissions-effective", () => ({
  effectiveCanAccessModule: vi.fn(),
  getEffectivePermissions: vi.fn(),
  immutableReadonlyPermissions: vi.fn(),
}));

import { resolvePageRole } from "./require-module-page";

describe("resolvePageRole (B12 fail-closed)", () => {
  it("profil yoksa advisor uydurmaz, null döner", () => {
    expect(resolvePageRole(false, null)).toBeNull();
    expect(resolvePageRole(false, undefined)).toBeNull();
    expect(resolvePageRole(false, { role: null })).toBeNull();
    expect(resolvePageRole(false, { role: "  " })).toBeNull();
  });
  it("profil rolünü ve impersonation readonly'yi korur", () => {
    expect(resolvePageRole(false, { role: "branch_manager" })).toBe("branch_manager");
    expect(resolvePageRole(true, null)).toBe("readonly");
  });
  it("kaynakta 'advisor' varsayılanı kalmadı ve null rol giriş sayfasına yönlenir", () => {
    const src = readFileSync("src/lib/require-module-page.ts", "utf8");
    expect(src).not.toContain('?? "advisor"');
    expect(src).toContain('if (!role) redirect("/giris")');
  });
});
