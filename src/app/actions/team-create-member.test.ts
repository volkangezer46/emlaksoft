import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * createTeamMember (actions/team.ts) kritik akış testi — mock Supabase.
 * Odak: rol sınırı (kimse kendi seviyesinin üstünü/owner'ı atayamaz), tenant_id'nin istemciden değil kapıdan gelmesi,
 * şube/koltuk doğrulaması ve profil yazımı başarısızsa auth kullanıcısının geri silinmesi (telafi).
 */
type Op = "select" | "insert" | "update" | "delete";
const h = vi.hoisted(() => ({
  gate: { ok: true, userId: "actor-1", tenantId: "tenant-1", role: "owner", impersonating: false } as
    | { ok: true; userId: string; tenantId: string; role: string; impersonating: boolean }
    | { ok: false; error: string },
  actorRole: "owner" as string | undefined,
  user: true,
  branchFound: true,
  tenantRow: { plan: "office", status: "active" } as { plan: string; status: string } | null,
  seatCount: 1,
  seatLimit: 5,
  extraSeats: 0,
  profileError: null as null | { message: string },
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  inserts: [] as unknown[],
  revalidate: vi.fn(),
}));

function chain(table: string) {
  let op: Op = "select";
  const result = () => {
    if (table === "branches") return { data: h.branchFound ? { id: "branch-1" } : null, error: null };
    if (table === "tenants") return { data: h.tenantRow, error: null };
    if (table === "profiles" && op === "insert") return { error: h.profileError };
    if (table === "profiles") return { count: h.seatCount, error: null };
    return { data: null, error: null };
  };
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "in", "is"]) c[m] = () => c;
  c.insert = (row: unknown) => {
    op = "insert";
    h.inserts.push(row);
    return c;
  };
  c.maybeSingle = async () => result();
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
  return c;
}

vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: async () => h.gate }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: h.user ? { id: "actor-1", app_metadata: h.actorRole ? { role: h.actorRole } : {} } : null },
      }),
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => chain(t),
    auth: { admin: { createUser: h.createUser, deleteUser: h.deleteUser } },
  }),
}));
vi.mock("@/lib/billing/plan-definitions", () => ({
  getPlanDefinition: async () => ({ limits: { seats: h.seatLimit } }),
}));
vi.mock("@/lib/billing/seat-purchase", () => ({ getExtraSeats: async () => h.extraSeats }));

import { createTeamMember } from "./team";

function form(over: Record<string, string> = {}) {
  const f = new FormData();
  const base: Record<string, string> = {
    full_name: "Ali Veli",
    email: "ali@example.com",
    phone: "",
    password: "gecici-sifre-1",
    role: "advisor",
    branch_id: "",
    ...over,
  };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.gate = { ok: true, userId: "actor-1", tenantId: "tenant-1", role: "owner", impersonating: false };
  h.actorRole = "owner";
  h.user = true;
  h.branchFound = true;
  h.tenantRow = { plan: "office", status: "active" };
  h.seatCount = 1;
  h.seatLimit = 5;
  h.extraSeats = 0;
  h.profileError = null;
  h.inserts = [];
  h.createUser.mockResolvedValue({ data: { user: { id: "new-user" } }, error: null });
  h.deleteUser.mockResolvedValue({ error: null });
});

describe("createTeamMember — yetki ve rol sınırı", () => {
  it("izin kapısı reddederse hiçbir şey oluşmaz", async () => {
    h.gate = { ok: false, error: "Yetkiniz yok." };
    expect(await createTeamMember({}, form())).toEqual({ error: "Yetkiniz yok." });
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("oturum yoksa ve yönetici olmayan rollerde (advisor/team_lead/readonly) reddedilir", async () => {
    h.user = false;
    expect((await createTeamMember({}, form())).error).toBe("Oturum bulunamadı.");
    h.user = true;
    for (const role of ["advisor", "team_lead", "readonly", "accounting", undefined]) {
      h.actorRole = role;
      expect((await createTeamMember({}, form())).error, String(role)).toBe("Bu işlem için yetkiniz yok.");
    }
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("owner hiçbir akıştan atanamaz; geçersiz rol reddedilir", async () => {
    for (const role of ["owner", "superuser", ""]) {
      expect((await createTeamMember({}, form({ role }))).error, role).toBe("Bu rolü atama yetkiniz yok.");
    }
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("gm kendi seviyesini (gm) atayamaz ama advisor atar; branch_manager yalnız altını atar", async () => {
    h.actorRole = "gm";
    expect((await createTeamMember({}, form({ role: "gm" }))).error).toBe("Bu rolü atama yetkiniz yok.");
    expect((await createTeamMember({}, form({ role: "advisor" }))).ok).toBe(true);
    h.actorRole = "branch_manager";
    expect((await createTeamMember({}, form({ role: "gm" }))).error).toBe("Bu rolü atama yetkiniz yok.");
    expect((await createTeamMember({}, form({ role: "branch_manager" }))).error).toBe("Bu rolü atama yetkiniz yok.");
    expect((await createTeamMember({}, form({ role: "team_lead" }))).ok).toBe(true);
  });

  it("owner gm/branch_manager atayabilir", async () => {
    for (const role of ["gm", "branch_manager", "advisor"]) {
      expect((await createTeamMember({}, form({ role, email: `${role}@example.com` }))).ok, role).toBe(true);
    }
  });
});

describe("createTeamMember — girdi doğrulama", () => {
  it("ad/e-posta zorunlu, e-posta ve telefon biçimi, şifre en az 8 karakter", async () => {
    expect((await createTeamMember({}, form({ full_name: "" }))).error).toBe("Ad ve e-posta zorunlu.");
    expect((await createTeamMember({}, form({ email: "yanlis" }))).error).toBeTruthy();
    expect((await createTeamMember({}, form({ phone: "123" }))).error).toBeTruthy();
    expect((await createTeamMember({}, form({ password: "kisa" }))).error).toMatch(/8 karakter/);
    expect(h.createUser).not.toHaveBeenCalled();
  });
});

describe("createTeamMember — şube ve koltuk kapıları (auth kullanıcısı oluşmadan önce)", () => {
  it("başka ofisin/pasif şubesi reddedilir", async () => {
    h.branchFound = false;
    const r = await createTeamMember({}, form({ branch_id: "branch-x" }));
    expect(r.error).toMatch(/şube/i);
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it("koltuk dolu: plan + ek koltuk limitinde reddedilir, limit mesajda", async () => {
    h.seatLimit = 2;
    h.extraSeats = 1;
    h.seatCount = 3;
    const r = await createTeamMember({}, form());
    expect(r.error).toMatch(/en fazla 3 aktif kullanıcı/);
    expect(h.createUser).not.toHaveBeenCalled();
    h.seatCount = 2; // limit 3, 2 dolu -> yer var
    expect((await createTeamMember({}, form())).ok).toBe(true);
  });

  it("askıdaki/iptal edilmiş ofise ve doğrulanamayan kapasiteye üye eklenmez", async () => {
    h.tenantRow = { plan: "office", status: "suspended" };
    expect((await createTeamMember({}, form())).error).toMatch(/Askıdaki/);
    h.tenantRow = { plan: "office", status: "cancelled" };
    expect((await createTeamMember({}, form())).error).toMatch(/iptal/);
    h.tenantRow = null;
    expect((await createTeamMember({}, form())).error).toMatch(/doğrulanamadı/);
    expect(h.createUser).not.toHaveBeenCalled();
  });
});

describe("createTeamMember — oluşturma ve telafi", () => {
  it("başarı: tenant_id kapıdan gelir (formdan DEĞİL), profil o tenant'a yazılır, auth app_metadata aynı rol", async () => {
    const f = form({ role: "team_lead", branch_id: "branch-1", phone: "05321234567" });
    f.set("tenant_id", "baska-tenant"); // sızdırma denemesi: yok sayılmalı
    const r = await createTeamMember({}, f);
    expect(r).toEqual({ ok: true, id: "new-user" });
    expect(h.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ali@example.com", email_confirm: true, app_metadata: { tenant_id: "tenant-1", role: "team_lead" } }),
    );
    expect(h.inserts).toEqual([
      expect.objectContaining({ id: "new-user", tenant_id: "tenant-1", role: "team_lead", branch_id: "branch-1", phone: "05321234567" }),
    ]);
    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(h.revalidate).toHaveBeenCalledWith("/app/ekip");
  });

  it("auth 'already' hatası: 'Bu e-posta zaten kayıtlı.'; profil yazılmaz, silme yok", async () => {
    h.createUser.mockResolvedValue({ data: { user: null }, error: { message: "already been registered" } });
    expect((await createTeamMember({}, form())).error).toBe("Bu e-posta zaten kayıtlı.");
    expect(h.inserts).toEqual([]);
    expect(h.deleteUser).not.toHaveBeenCalled();
  });

  it("profil yazımı başarısızsa oluşan auth kullanıcısı SİLİNİR; genel mesaj döner", async () => {
    h.profileError = { message: "insert failed" };
    const r = await createTeamMember({}, form());
    expect(r.error).toBe("Profil oluşturulamadı.");
    expect(h.deleteUser).toHaveBeenCalledWith("new-user");
    expect(h.revalidate).not.toHaveBeenCalled();
  });

  it("DB plan-limit tetikleyicisi hatası da kullanıcıyı geri siler ve yükseltme mesajı verir", async () => {
    h.profileError = { message: "PLAN_LIMIT_EXCEEDED:seats:5" };
    const r = await createTeamMember({}, form());
    expect(r.error).toMatch(/en fazla 5 aktif kullanıcı/);
    expect(h.deleteUser).toHaveBeenCalledWith("new-user");
  });
});
