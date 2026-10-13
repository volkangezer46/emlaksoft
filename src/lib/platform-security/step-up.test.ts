import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AD11 kritik işlem yeniden doğrulaması: (1) `requireStepUp` kod/faktör olmadan geçmez, yanlış kod denetime düşer;
 * (2) sözleşme: iade, kredi, sahiplik devri, ofis kapatma ve rol değişikliği eylemleri İLK yazımdan ÖNCE kodu ister.
 * Davranış düzeyi (kapatma talebi kodu bir kez doğrular ve tamamlanır): src/app/actions/platform-office-close-step-up.test.ts.
 */
const state = vi.hoisted(() => ({
  required: true as boolean,
  factors: [{ id: "f1", status: "verified" }] as { id: string; status: string }[],
  verifyError: null as null | { message: string },
  audits: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/settings/read", () => ({ getSetting: vi.fn(async () => state.required) }));
vi.mock("@/lib/platform-activity", () => ({
  logPlatformActivity: vi.fn(async (i: { action: string }) => {
    state.audits.push(i.action);
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      mfa: {
        listFactors: vi.fn(async () => ({ data: { totp: state.factors }, error: null })),
        challengeAndVerify: vi.fn(async () => ({ data: null, error: state.verifyError })),
      },
    },
  })),
}));

import { requireStepUp } from "./step-up";

describe("requireStepUp", () => {
  beforeEach(() => {
    state.required = true;
    state.factors = [{ id: "f1", status: "verified" }];
    state.verifyError = null;
    state.audits = [];
  });

  it("iade TOTP kodu olmadan tamamlanmaz", async () => {
    const fd = new FormData();
    const r = await requireStepUp(fd, "refund", "s1");
    expect(r).toMatchObject({ ok: false, code: "step_up_required" });
  });

  it("doğrulayıcısı olmayan personel kritik işlem yapamaz", async () => {
    state.factors = [];
    const fd = new FormData();
    fd.set("step_up_code", "123456");
    expect(await requireStepUp(fd, "refund", "s1")).toMatchObject({ ok: false, code: "step_up_no_factor" });
  });

  it("yanlış kod reddedilir ve denetim izine düşer; doğru kod geçer", async () => {
    const fd = new FormData();
    fd.set("step_up_code", "123456");
    state.verifyError = { message: "Invalid TOTP code entered" };
    expect(await requireStepUp(fd, "refund", "s1")).toMatchObject({ ok: false, code: "step_up_invalid" });
    expect(state.audits).toContain("platform.step_up.failed");
    state.verifyError = null;
    expect(await requireStepUp(fd, "refund", "s1")).toEqual({ ok: true });
    expect(state.audits).toContain("platform.step_up.ok");
  });

  it("ayar kapalıysa kod istenmez", async () => {
    state.required = false;
    expect(await requireStepUp(new FormData(), "refund", "s1")).toEqual({ ok: true });
  });
});

describe("kritik eylemler kodu ilk yazımdan önce ister (sözleşme)", () => {
  const ROOT = process.cwd();
  const CASES: { file: string; fn: string; action: string }[] = [
    { file: "src/app/actions/platform-billing.ts", fn: "recordInvoiceRefund", action: '"refund"' },
    { file: "src/app/actions/platform-billing.ts", fn: "resolveCapture", action: '"refund"' },
    { file: "src/app/actions/admin-account-credit.ts", fn: "grantAccountCredit", action: '"credit_grant"' },
    { file: "src/app/actions/admin-account-credit.ts", fn: "reverseAccountCredit", action: '"credit_reverse"' },
    { file: "src/app/actions/platform-tenants.ts", fn: "transferTenantOwnershipByAdmin", action: '"ownership_transfer"' },
    { file: "src/app/actions/platform-tenants.ts", fn: "setTenantLifecycleByAdmin", action: '"office_close"' },
    { file: "src/app/actions/platform-tenant-closure.ts", fn: "processOfficeClosureRequestByAdmin", action: '"office_close"' },
    { file: "src/app/actions/platform.ts", fn: "updateTenantPlanStatus", action: '"office_close"' },
    { file: "src/app/actions/platform-staff.ts", fn: "updateStaffRole", action: '"staff_role"' },
    { file: "src/app/actions/platform-staff.ts", fn: "addPlatformStaff", action: '"staff_role"' },
    { file: "src/app/actions/platform-members.ts", fn: "setMemberRoleAsStaff", action: '"member_role"' },
  ];
  for (const c of CASES) {
    it(`${c.fn}`, () => {
      const src = readFileSync(join(ROOT, c.file), "utf8");
      const start = src.indexOf(`export async function ${c.fn}(`);
      expect(start, c.fn).toBeGreaterThan(-1);
      const next = src.indexOf("\nexport async function ", start + 10);
      // İmza satırı atlanır (ör. `updateTenantPlanStatus(` kendi adını yazım sanmasın).
      const full = src.slice(start, next === -1 ? undefined : next);
      const body = full.slice(full.indexOf("\n"));
      const gate = body.indexOf("requireStepUp(");
      expect(gate, `${c.fn}: requireStepUp yok`).toBeGreaterThan(-1);
      expect(body.slice(gate, gate + 80)).toContain(c.action);
      // İlk yazım (update/insert/upsert/delete/yazan rpc) kod kapısından sonra gelir.
      const writes = [".update(", ".insert(", ".upsert(", ".delete(", "updateTenantPlanStatus(", "applyTenantPlanStatus(", "admin.rpc("]
        .map((w) => body.indexOf(w))
        .filter((i) => i > -1);
      if (writes.length) expect(Math.min(...writes), `${c.fn}: yazım kapıdan önce`).toBeGreaterThan(gate);
    });
  }
});

describe("toplu ofis kapatma kodu atlamaz (sözleşme)", () => {
  it("bulkTenantAction: askıya alma/iptal dalı yazımdan önce office_close kodunu doğrular", () => {
    const src = readFileSync(join(process.cwd(), "src/app/actions/platform-crm.ts"), "utf8");
    const start = src.indexOf("export async function bulkTenantAction(");
    expect(start).toBeGreaterThan(-1);
    const next = src.indexOf("\nexport async function ", start + 10);
    const body = src.slice(start, next === -1 ? undefined : next);
    const branch = body.slice(body.indexOf('action.op === "status"'));
    const gate = branch.indexOf("requireStepUp(");
    expect(gate, "requireStepUp yok").toBeGreaterThan(-1);
    expect(branch.slice(gate, gate + 80)).toContain('"office_close"');
    expect(branch.indexOf("applyTenantPlanStatus(")).toBeGreaterThan(gate);
    expect(branch.indexOf("statusChangeNeedsStepUp(")).toBeGreaterThan(-1);
  });
});

describe("erişim politikası anahtarları merkezden yazılamaz", () => {
  it("IP listesi, boşta/ömür ve step-up bridge; yazım yalnız saveAdminAccessPolicy (fromBridge)", async () => {
    const { prepareWrite } = await import("@/lib/settings/prepare");
    for (const key of ["platform.step_up_required", "platform.admin_ip_allowlist", "platform.session_idle_minutes", "platform.session_max_hours"]) {
      const r = prepareWrite({ key, value: key === "platform.step_up_required" ? false : key === "platform.admin_ip_allowlist" ? "" : 30, reason: "test gerekçesi uzun" });
      expect(r.ok, key).toBe(false);
    }
    const src = readFileSync(join(process.cwd(), "src/app/actions/platform-access-policy.ts"), "utf8");
    expect(src).toContain("fromBridge: true");
  });
});
