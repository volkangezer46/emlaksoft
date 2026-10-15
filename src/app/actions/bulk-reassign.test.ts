import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DAVRANIŞ TESTİ: toplu sorumlu değiştirme (portföy, görev, randevu) — `bulkAssignCustomers` deseniyle aynı kurallar:
 * izin kapısı, ofis süzgeci, hedef üyenin bu ofiste aktif olması, toplu sınır, tek denetim kaydı (`*.reassign`) ve
 * el değiştiren kayıt varsa hedefe tek seferlik bildirim.
 */
type Call = { table: string; op: string; args: unknown[] };
let calls: Call[] = [];
let profileRow: { id: string; role?: string | null } | null = null;
let rows: Record<string, { id: string; assigned_to: string | null }[]> = {};
let updateError: { message: string } | null = null;

let gate: { ok: true; tenantId: string; userId: string; role: string } | { ok: false; error: string } = {
  ok: true,
  tenantId: "t1",
  userId: "u1",
  role: "owner",
};
const requirePermission = vi.fn(async (..._a: unknown[]) => gate);
const logActivity = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const notifyAssignment = vi.fn(async (..._a: unknown[]) => undefined);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/revalidate", () => ({ revalidateTenantData: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: (...a: unknown[]) => logActivity(...a) }));
vi.mock("@/lib/notify", () => ({ notifyTenant: vi.fn() }));
vi.mock("@/lib/assignment-notify", () => ({
  notifyAssignment: (...a: unknown[]) => notifyAssignment(...a),
  idsDigest: (ids: readonly string[]) => [...ids].sort().join("|"),
}));
vi.mock("@/lib/require-permission", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...a) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/oversight/approval-gate", () => ({ requestApprovalIfNeeded: vi.fn() }));
vi.mock("@/lib/property-owner/server", () => ({ publishBlockReasons: vi.fn() }));
vi.mock("@/lib/appointment-customer-messages", () => ({ sendAppointmentConfirmation: vi.fn() }));
vi.mock("@/lib/base-url", () => ({ getBaseUrl: () => "https://example.test" }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      let op = "select";
      const chain: Record<string, unknown> = {};
      const record = (name: string) => (...args: unknown[]) => {
        calls.push({ table, op: name, args });
        if (name === "update") op = "update";
        return chain;
      };
      for (const m of ["select", "update", "eq", "in", "is", "neq", "order"]) chain[m] = record(m);
      chain.maybeSingle = async () => ({ data: table === "profiles" ? profileRow : null, error: null });
      chain.then = (resolve: (v: unknown) => unknown) =>
        resolve(op === "update" ? { data: null, error: updateError } : { data: rows[table] ?? [], error: null });
      return chain;
    },
  }),
}));

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const TARGET = "33333333-3333-4333-8333-333333333333";

const filtersOn = (table: string, op: string) => calls.filter((c) => c.table === table && c.op === op).map((c) => c.args);

beforeEach(() => {
  calls = [];
  profileRow = { id: TARGET, role: "advisor" };
  rows = {};
  updateError = null;
  gate = { ok: true, tenantId: "t1", userId: "u1", role: "owner" };
  requirePermission.mockClear();
  logActivity.mockClear();
  notifyAssignment.mockClear();
});

describe("bulkAssignProperties", () => {
  it("ofis süzgeçli günceller, tek denetim kaydı ve tek bildirim yazar", async () => {
    const { bulkAssignProperties } = await import("./bulk-property");
    rows.properties = [
      { id: A, assigned_to: "u9" },
      { id: B, assigned_to: TARGET },
    ];
    const res = await bulkAssignProperties([A, B, A], TARGET);
    expect(res).toEqual({ ok: true, updatedCount: 2 });
    expect(requirePermission).toHaveBeenCalledWith("properties", "edit");
    expect(filtersOn("properties", "eq")).toContainEqual(["tenant_id", "t1"]);
    expect(filtersOn("properties", "is")).toContainEqual(["deleted_at", null]);
    expect(filtersOn("profiles", "eq")).toEqual(expect.arrayContaining([["tenant_id", "t1"], ["is_active", true]]));
    expect(filtersOn("properties", "update")[0][0]).toMatchObject({ assigned_to: TARGET });
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity.mock.calls[0][0]).toMatchObject({ action: "property.reassign", newValue: { count: 2, bulk: true } });
    expect(notifyAssignment).toHaveBeenCalledTimes(1);
    expect(notifyAssignment.mock.calls[0][0]).toMatchObject({ userId: TARGET, title: "Size 1 portföy devredildi" });
  });

  it("başka ofisin/pasif kullanıcısı ve satış dışı rol reddedilir", async () => {
    const { bulkAssignProperties } = await import("./bulk-property");
    rows.properties = [{ id: A, assigned_to: null }];
    profileRow = null;
    expect((await bulkAssignProperties([A], TARGET)).error).toBe("Seçilen danışman bu ofiste aktif değil.");
    profileRow = { id: TARGET, role: "accounting" };
    expect((await bulkAssignProperties([A], TARGET)).error).toMatch(/satış rolleri/);
    expect(filtersOn("properties", "update")).toHaveLength(0);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("izin, boş seçim, sınır ve bulunamayan kayıt", async () => {
    const { bulkAssignProperties } = await import("./bulk-property");
    gate = { ok: false, error: "Yetkiniz yok." };
    expect((await bulkAssignProperties([A], TARGET)).error).toBe("Yetkiniz yok.");
    gate = { ok: true, tenantId: "t1", userId: "u1", role: "owner" };
    expect((await bulkAssignProperties([], TARGET)).error).toBe("Portföy seçilmedi.");
    const many = Array.from({ length: 201 }, (_, i) => `id-${i}`);
    expect((await bulkAssignProperties(many, TARGET)).error).toMatch(/en fazla 200/);
    expect((await bulkAssignProperties([A], "")).error).toBe("Danışman seçin.");
    rows.properties = [];
    expect((await bulkAssignProperties([A], TARGET)).error).toBe("Güncellenecek portföy bulunamadı.");
    expect(filtersOn("properties", "update")).toHaveLength(0);
  });

  it("kendine devirde bildirim yazılmaz; güncelleme hatası döner", async () => {
    const { bulkAssignProperties } = await import("./bulk-property");
    rows.properties = [{ id: A, assigned_to: null }];
    profileRow = { id: "u1", role: "owner" };
    expect((await bulkAssignProperties([A], "u1")).ok).toBe(true);
    expect(notifyAssignment).not.toHaveBeenCalled();
    updateError = { message: "boom" };
    expect((await bulkAssignProperties([A], TARGET)).error).toBeTruthy();
  });
});

describe("bulkAssignTasks", () => {
  it("yalnız açık görevleri ofis süzgeciyle devreder; denetim + bildirim", async () => {
    const { bulkAssignTasks } = await import("./tasks");
    profileRow = { id: TARGET };
    rows.tasks = [
      { id: A, assigned_to: "u9" },
      { id: B, assigned_to: "u8" },
    ];
    const res = await bulkAssignTasks([A, B], TARGET);
    expect(res).toEqual({ ok: true, updatedCount: 2 });
    expect(requirePermission).toHaveBeenCalledWith("tasks", "edit");
    expect(filtersOn("tasks", "eq")).toEqual(expect.arrayContaining([["tenant_id", "t1"], ["status", "open"]]));
    expect(logActivity.mock.calls[0][0]).toMatchObject({ action: "task.reassign", entityType: "task" });
    expect(notifyAssignment.mock.calls[0][0]).toMatchObject({ userId: TARGET, title: "Size 2 görev devredildi" });
  });

  it("aktif olmayan hedef, boş seçim ve sınır reddedilir", async () => {
    const { bulkAssignTasks } = await import("./tasks");
    profileRow = null;
    rows.tasks = [{ id: A, assigned_to: null }];
    expect((await bulkAssignTasks([A], TARGET)).error).toBe("Seçilen ekip üyesi bu ofiste aktif değil.");
    expect((await bulkAssignTasks([], TARGET)).error).toBe("Görev seçilmedi.");
    expect((await bulkAssignTasks(Array.from({ length: 201 }, (_, i) => `t-${i}`), TARGET)).error).toMatch(/en fazla 200/);
    expect(filtersOn("tasks", "update")).toHaveLength(0);
  });
});

describe("bulkAssignAppointments", () => {
  it("yönetim katmanı kapanmamış randevuları devreder; randevu tercihiyle bildirir", async () => {
    const { bulkAssignAppointments } = await import("./appointments");
    profileRow = { id: TARGET };
    rows.appointments = [{ id: A, assigned_to: "u9" }];
    const res = await bulkAssignAppointments([A], TARGET);
    expect(res).toEqual({ ok: true, updatedCount: 1 });
    expect(requirePermission).toHaveBeenCalledWith("appointments", "edit");
    const statusFilter = filtersOn("appointments", "in").find((a) => a[0] === "status");
    expect(statusFilter?.[1]).toEqual(expect.arrayContaining(["pending", "confirmed"]));
    expect(statusFilter?.[1]).not.toContain("cancelled");
    expect(statusFilter?.[1]).not.toContain("completed");
    expect(logActivity.mock.calls[0][0]).toMatchObject({ action: "appointment.reassign" });
    expect(notifyAssignment.mock.calls[0][0]).toMatchObject({ prefKey: "appointment", title: "Size 1 randevu devredildi" });
  });

  it("danışman rolü başkasına devredemez; aktif olmayan hedef reddedilir", async () => {
    const { bulkAssignAppointments } = await import("./appointments");
    rows.appointments = [{ id: A, assigned_to: "u1" }];
    gate = { ok: true, tenantId: "t1", userId: "u1", role: "advisor" };
    expect((await bulkAssignAppointments([A], TARGET)).error).toBe("Randevu danışmanını değiştirme yetkiniz yok.");
    gate = { ok: true, tenantId: "t1", userId: "u1", role: "team_lead" };
    profileRow = null;
    expect((await bulkAssignAppointments([A], TARGET)).error).toBe("Seçilen danışman bu ofiste aktif değil.");
    expect(filtersOn("appointments", "update")).toHaveLength(0);
    expect(notifyAssignment).not.toHaveBeenCalled();
  });
});
