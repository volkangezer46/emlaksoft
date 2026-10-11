import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * updateTeamMember + ensureSeatAvailable (paket tavanı) davranış testi — mock Supabase.
 * createTeamMember akışı `team-create-member.test.ts` içinde; burada pasif üyeyi yeniden etkinleştirme (koltuk kapısı),
 * kiracı izolasyonu, owner koruması, kendini kilitleme koruması ve paket kullanıcı TAVANI mesajı.
 */
const h = vi.hoisted(() => ({
  gate: { ok: true, userId: "actor-1", tenantId: "tenant-1", role: "owner", impersonating: false } as
    | { ok: true; userId: string; tenantId: string; role: string; impersonating: boolean }
    | { ok: false; error: string },
  actorRole: "owner" as string,
  target: { id: "m1", tenant_id: "tenant-1", role: "advisor", branch_id: null, is_active: false } as Record<string, unknown> | null,
  seatCount: 1,
  seatLimit: 5,
  maxSeats: undefined as number | undefined,
  extraSeats: 0,
  updates: [] as unknown[],
  updateUserById: vi.fn(),
}));

function chain(table: string) {
  let op = "select";
  const result = () => {
    if (table === "tenants") return { data: { plan: "office", status: "active" }, error: null };
    if (table === "profiles" && op === "update") return { error: null };
    if (table === "profiles") return { data: h.target, count: h.seatCount, error: null };
    return { data: null, error: null };
  };
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "limit"]) c[m] = () => c;
  c.update = (patch: unknown) => {
    op = "update";
    h.updates.push(patch);
    return c;
  };
  c.maybeSingle = async () => result();
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
  return c;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: async () => h.gate }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/access-control/scope-sync", () => ({ syncScopeForRoleChange: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "actor-1", app_metadata: { role: h.actorRole } } } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => chain(t),
    rpc: async () => ({ error: null }),
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { id: "m1", app_metadata: {} } }, error: null }),
        updateUserById: h.updateUserById,
      },
    },
  }),
}));
vi.mock("@/lib/billing/plan-definitions", () => ({
  getPlanDefinition: async () => ({ name: "Ofis", maxSeats: h.maxSeats, limits: { seats: h.seatLimit } }),
}));
vi.mock("@/lib/billing/seat-purchase", () => ({ getExtraSeats: async () => h.extraSeats }));

import { updateTeamMember } from "./team";

function form(over: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ id: "m1", is_active: "true", ...over })) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { ok: true, userId: "actor-1", tenantId: "tenant-1", role: "owner", impersonating: false };
  h.actorRole = "owner";
  h.target = { id: "m1", tenant_id: "tenant-1", role: "advisor", branch_id: null, is_active: false };
  h.seatCount = 1;
  h.seatLimit = 5;
  h.maxSeats = undefined;
  h.extraSeats = 0;
  h.updates = [];
  h.updateUserById.mockResolvedValue({ error: null });
});

describe("updateTeamMember", () => {
  it("izin kapısı ve yönetici olmayan roller reddedilir", async () => {
    h.gate = { ok: false, error: "Yetkiniz yok." };
    expect(await updateTeamMember(form())).toEqual({ error: "Yetkiniz yok." });
    h.gate = { ok: true, userId: "actor-1", tenantId: "tenant-1", role: "advisor", impersonating: false };
    h.actorRole = "advisor";
    expect((await updateTeamMember(form())).error).toBe("Bu işlem için yetkiniz yok.");
    expect(h.updates).toEqual([]);
  });

  it("başka ofisin üyesi düzenlenemez (kiracı izolasyonu)", async () => {
    h.target = { id: "m1", tenant_id: "baska-tenant", role: "advisor", branch_id: null, is_active: true };
    expect((await updateTeamMember(form())).error).toBe("Üye bu ofise ait değil.");
    h.target = null;
    expect((await updateTeamMember(form())).error).toBe("Üye bu ofise ait değil.");
    expect(h.updates).toEqual([]);
  });

  it("ofis sahibi bu ekrandan düzenlenemez; üye kimliği zorunlu", async () => {
    h.target = { id: "m1", tenant_id: "tenant-1", role: "owner", branch_id: null, is_active: true };
    expect((await updateTeamMember(form())).error).toBe("Ofis sahibi bu ekrandan düzenlenemez.");
    expect((await updateTeamMember(form({ id: "" }))).error).toBe("Üye bulunamadı.");
  });

  it("kendini pasife alamaz ve yönetici rolünü düşüremez", async () => {
    expect((await updateTeamMember(form({ id: "actor-1", is_active: "false" }))).error).toBe("Kendinizi pasife alamazsınız.");
    expect((await updateTeamMember(form({ id: "actor-1", role: "advisor", is_active: "" }))).error).toMatch(/yönetici rolünüzü/);
  });

  it("alt yönetici üstünü yönetemez / owner atayamaz", async () => {
    h.actorRole = "branch_manager";
    h.target = { id: "m1", tenant_id: "tenant-1", role: "gm", branch_id: null, is_active: true };
    expect((await updateTeamMember(form())).error).toBe("Bu üyeyi yönetme yetkiniz yok.");
    h.target = { id: "m1", tenant_id: "tenant-1", role: "advisor", branch_id: null, is_active: true };
    expect((await updateTeamMember(form({ role: "owner", is_active: "" }))).error).toBe("Bu rolü atama yetkiniz yok.");
  });

  it("pasif üyeyi yeniden etkinleştirmek koltuk limitini kontrol eder (Türkçe mesaj)", async () => {
    h.seatLimit = 2;
    h.seatCount = 2;
    const r = await updateTeamMember(form());
    expect(r.error).toMatch(/en fazla 2 aktif kullanıcı/);
    expect(h.updates).toEqual([]);
    h.seatCount = 1;
    expect((await updateTeamMember(form())).ok).toBe(true);
    expect(h.updates).toContainEqual({ is_active: true });
  });

  it("paket kullanıcı TAVANI aşılamaz; ek koltuk tavanı yükseltmez", async () => {
    h.seatLimit = 3;
    h.extraSeats = 10;
    h.maxSeats = 5;
    h.seatCount = 5;
    const r = await updateTeamMember(form());
    expect(r.error).toMatch(/en fazla 5 kullanıcı olabilir/);
    expect(r.error).toMatch(/üst pakete/);
    expect(h.updates).toEqual([]);
  });

  it("zaten aktif üyeye rol değişimi koltuk kapısına takılmaz", async () => {
    h.target = { id: "m1", tenant_id: "tenant-1", role: "advisor", branch_id: null, is_active: true };
    h.seatLimit = 1;
    h.seatCount = 5;
    expect((await updateTeamMember(form({ role: "team_lead", is_active: "" }))).ok).toBe(true);
  });
});
