import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformPrincipal } from "@/lib/platform-access";

/**
 * DG1: personel ekleme / pasif personeli yeniden açma ROL ATAMASIDIR ve `updateStaffRole` kapısını atlayamaz.
 *  - personel modülünde yalnız "yaz" olan özel rol personel ekleyemez (onay yetkisi ister);
 *  - dört göz (rol değişikliği) açıkken süper admin doğrudan eklenemez, pasif personel farklı rolle açılamaz;
 *  - yeniden açmada eski özel rol temizlenir, yazım hatası `{ ok: true }` diye yutulmaz.
 */

type Row = Record<string, unknown>;
type Staff = PlatformPrincipal & { id: string; email: string; full_name: string; is_active: boolean };

const db = vi.hoisted(() => ({
  staff: [] as Row[],
  authUsers: [] as { id: string; email: string }[],
  writes: [] as { op: "insert" | "update"; values: Row }[],
  updateError: null as null | { code: string; message: string },
  fourEyesStaffRole: false,
}));
const who = vi.hoisted(() => ({ staff: null as null | Staff }));

function query(name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let pending: { op: "insert" | "update"; values: Row } | null = null;
  const rows = () => (name === "platform_staff" ? db.staff : []).filter((r) => filters.every((f) => f(r)));
  const run = () => {
    if (pending?.op === "update") {
      if (db.updateError) return { data: null, error: db.updateError };
      db.writes.push(pending);
      for (const r of rows()) Object.assign(r, pending.values);
    }
    if (pending?.op === "insert") {
      db.writes.push(pending);
      db.staff.push({ ...pending.values });
    }
    return { data: rows(), error: null };
  };
  const api = {
    select: () => api,
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), api),
    update: (values: Row) => ((pending = { op: "update", values }), api),
    insert: (values: Row) => ((pending = { op: "insert", values }), api),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
  };
  return api;
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: query,
    auth: { admin: { listUsers: async () => ({ data: { users: db.authUsers } }) } },
  }),
}));
vi.mock("@/lib/platform", () => ({ requirePlatformModule: vi.fn(async () => who.staff!) }));
vi.mock("@/lib/platform-guards", () => ({ guardPlatformAction: vi.fn() }));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/base-url", () => ({ getBaseUrl: () => "https://emlaksoft.com.tr" }));
vi.mock("@/lib/platform-security/step-up", () => ({
  requireStepUp: vi.fn(async (fd: FormData) =>
    fd.get("step_up_code") === "123456" ? { ok: true } : { ok: false, code: "step_up_required", error: "Doğrulayıcı kodu gerekli." },
  ),
}));
vi.mock("@/lib/platform-security/four-eyes", () => ({
  readFourEyesConfig: vi.fn(async () => ({ staffRole: db.fourEyesStaffRole })),
  fourEyesGate: vi.fn(async () => ({ proceed: true })),
  requireStepUpOrApproved: vi.fn(async () => ({ ok: true })),
}));

const { addPlatformStaff } = await import("./platform-staff");

const SUPER: Staff = { id: "s-1", email: "s@x", full_name: "Süper", is_active: true, role: "super_admin", customRole: null };
const WRITER: Staff = {
  id: "w-1",
  email: "w@x",
  full_name: "Yazar",
  is_active: true,
  role: "ops",
  customRole: { id: "r-1", label: "Personel yazar", baseRole: "ops", permissions: { personel: ["view", "write"] } },
};
const TARGET = "99999999-9999-4999-8999-999999999999";

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}
const base = { email: "hedef@x.com", full_name: "Hedef Kişi", step_up_code: "123456" };

beforeEach(() => {
  db.staff = [];
  db.authUsers = [{ id: TARGET, email: "hedef@x.com" }];
  db.writes = [];
  db.updateError = null;
  db.fourEyesStaffRole = false;
  who.staff = SUPER;
});

describe("addPlatformStaff rol atama kapısı", () => {
  it("personel modülünde yalnız 'yaz' olan özel rol personel ekleyemez ya da pasifi yeni rolle açamaz", async () => {
    who.staff = WRITER;
    db.staff = [{ id: TARGET, email: "hedef@x.com", is_active: false, role: "support", custom_role_id: null }];
    const r = await addPlatformStaff(form({ ...base, role: "ops" }));
    expect(r.error).toMatch(/onay yetkisi/);
    expect(db.writes).toHaveLength(0);
    expect(db.staff[0]).toMatchObject({ is_active: false, role: "support" });
  });

  it("yeniden açma eski özel rolü temizler ve sabit rolü yazar", async () => {
    db.staff = [{ id: TARGET, email: "hedef@x.com", is_active: false, role: "ops", custom_role_id: "r-9" }];
    const r = await addPlatformStaff(form({ ...base, role: "super_admin" }));
    expect(r).toEqual({ ok: true });
    expect(db.staff[0]).toMatchObject({ is_active: true, role: "super_admin", custom_role_id: null });
  });

  it("yeniden açmada yazım hatası başarı diye dönmez", async () => {
    db.staff = [{ id: TARGET, email: "hedef@x.com", is_active: false, role: "ops", custom_role_id: null }];
    db.updateError = { code: "23514", message: "platform_staff_custom_role_not_super" };
    const r = await addPlatformStaff(form({ ...base, role: "ops" }));
    expect(r.ok).toBeUndefined();
    expect(r.error).toBeTruthy();
  });

  it("dört göz açıkken pasif personel farklı rolle (ya da özel rolden sabit role) açılamaz", async () => {
    db.fourEyesStaffRole = true;
    db.staff = [{ id: TARGET, email: "hedef@x.com", is_active: false, role: "support", custom_role_id: null }];
    const up = await addPlatformStaff(form({ ...base, role: "super_admin" }));
    expect(up.error).toMatch(/Dört göz onayı açık/);

    db.staff[0]!.custom_role_id = "r-9";
    const same = await addPlatformStaff(form({ ...base, role: "support" }));
    expect(same.error).toMatch(/Dört göz onayı açık/);
    expect(db.writes).toHaveLength(0);
    expect(db.staff[0]).toMatchObject({ is_active: false, role: "support" });
  });

  it("dört göz açıkken aynı rolle yeniden açma yürür (rol değişmez)", async () => {
    db.fourEyesStaffRole = true;
    db.staff = [{ id: TARGET, email: "hedef@x.com", is_active: false, role: "support", custom_role_id: null }];
    const r = await addPlatformStaff(form({ ...base, role: "support" }));
    expect(r).toEqual({ ok: true });
    expect(db.staff[0]).toMatchObject({ is_active: true, role: "support" });
  });

  it("dört göz açıkken süper admin doğrudan eklenemez; başka rol eklenir", async () => {
    db.fourEyesStaffRole = true;
    const sup = await addPlatformStaff(form({ ...base, role: "super_admin" }));
    expect(sup.error).toMatch(/süper admin doğrudan eklenemez/);
    expect(db.staff).toHaveLength(0);

    const ops = await addPlatformStaff(form({ ...base, role: "ops" }));
    expect(ops).toEqual({ ok: true });
    expect(db.staff[0]).toMatchObject({ id: TARGET, role: "ops", is_active: true });
  });
});
