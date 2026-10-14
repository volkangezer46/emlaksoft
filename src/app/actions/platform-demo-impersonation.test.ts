import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * YD1 "ofis adına gör" kapısı (davranış): demo platform kişiliği (giriş sayfasındaki süper admin kartı,
 * `@demo.emlaksoft.test`) gerçek ofise destek erişimi başlatamaz — sunucu `?destek=demo` ile reddeder ve oturum
 * adımlarına (getUser, oturum anlık görüntüsü) hiç geçmez. Aynı kişilik demo ofise girebilir; gerçek personel her ofise.
 */
type Row = Record<string, unknown>;
const DEMO_T = "11111111-1111-4111-8111-111111111111";
const REAL_T = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  staff: { id: "staff-1", role: "super_admin", email: "admin@demo.emlaksoft.test", full_name: "Süper admin", is_active: true },
  tenants: [] as Record<string, unknown>[],
  getUser: vi.fn(async () => ({ data: { user: null } })),
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() })), headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));
vi.mock("@/lib/platform", () => ({
  requirePlatformModule: vi.fn(async () => h.staff),
  getPlatformStaffIdentity: vi.fn(async () => null),
}));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: vi.fn(async () => undefined), clientIpFrom: () => null }));
vi.mock("@/lib/error-log", () => ({ logError: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(name: string) {
      const filters: ((r: Row) => boolean)[] = [];
      const api = {
        select: () => api,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), api),
        maybeSingle: async () => ({ data: (name === "tenants" ? h.tenants : []).find((r) => filters.every((f) => f(r))) ?? null, error: null }),
      };
      return api;
    },
  }),
}));

import { startImpersonation } from "./platform";

function form(tenantId: string): FormData {
  const fd = new FormData();
  fd.set("tenant_id", tenantId);
  fd.set("reason", "Müşteri ekran sorununu bildirdi, inceleme");
  fd.set("ticket_id", "DST-42");
  return fd;
}

beforeEach(() => {
  h.tenants.splice(0, h.tenants.length, { id: DEMO_T, name: "Demo Emlak Ofisi", status: "active", slug: "demo-ofis" }, { id: REAL_T, name: "Gerçek Ofis", status: "active", slug: "gercek-ofis" });
  h.getUser.mockClear();
  h.redirect.mockClear();
  h.staff.email = "admin@demo.emlaksoft.test";
});

describe("demo süper admin — ofis adına gör", () => {
  it("gerçek ofise girişi reddedilir (?destek=demo), oturum adımlarına geçilmez", async () => {
    await expect(startImpersonation(form(REAL_T))).rejects.toThrow("redirect:/admin/tenants?destek=demo");
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it("demo ofise girebilir (kapıyı geçer, oturum adımına ilerler)", async () => {
    await startImpersonation(form(DEMO_T));
    expect(h.redirect).not.toHaveBeenCalled();
    expect(h.getUser).toHaveBeenCalledTimes(1);
  });

  it("gerçek personel için kural değişmez: gerçek ofise kapıyı geçer", async () => {
    h.staff.email = "volkan@emlaksoft.com.tr";
    await startImpersonation(form(REAL_T));
    expect(h.redirect).not.toHaveBeenCalled();
    expect(h.getUser).toHaveBeenCalledTimes(1);
  });
});
