import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const ensureMock = vi.fn();
vi.mock("@/lib/sample-data/seed", () => ({ ensureSampleData: (...a: unknown[]) => ensureMock(...a) }));

import { seedDemoDataForNewTenant, wantsDemoData } from "./sample-registration-seed";

beforeEach(() => {
  ensureMock.mockReset();
});

describe("wantsDemoData", () => {
  it("işaretli kutu (on) demo ister; alan yoksa istemez", () => {
    const f = new FormData();
    expect(wantsDemoData(f)).toBe(false);
    f.set("demo_data", "on");
    expect(wantsDemoData(f)).toBe(true);
    f.set("demo_data", "off");
    expect(wantsDemoData(f)).toBe(false);
  });
});

describe("seedDemoDataForNewTenant", () => {
  const db = {} as SupabaseClient;
  it("idempotent çekirdeğe (ensureSampleData) kayıt kaynağı ve paketle delege eder", async () => {
    ensureMock.mockResolvedValue({ ok: true, skipped: null, report: { counts: {}, skipped: [], failed: [] } });
    expect((await seedDemoDataForNewTenant(db, "t-1", "u-1", "arsa")).ok).toBe(true);
    expect(ensureMock).toHaveBeenCalledWith(db, "t-1", "u-1", { pack: "arsa", by: "registration" });
  });
  it("paket verilmezse konut; çekirdek ok=false dönerse ok=false (fırlatmaz)", async () => {
    ensureMock.mockResolvedValue({ ok: false, skipped: null, report: null });
    expect((await seedDemoDataForNewTenant(db, "t-1", "u-1")).ok).toBe(false);
    expect(ensureMock).toHaveBeenCalledWith(db, "t-1", "u-1", { pack: "konut", by: "registration" });
  });
});

describe("kayıt demo veri sözleşmesi", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("signUp provizyondan SONRA, aynı admin client ile ve yeni createAdminClient çağrısı eklemeden tohumlar", () => {
    const src = read("src/app/actions/auth.ts");
    const fn = src.slice(src.indexOf("export async function signUp"), src.indexOf("export async function signOut"));
    // signUp (e-posta + Google yolu) tek provizyon çekirdeğini AYNI admin client ile çağırır.
    expect(fn.match(/createAdminClient()/g)).toHaveLength(1);
    expect(fn).toContain("provisionOfficeForUser(admin, publicClient");
    const core = read("src/lib/registration/provision-office.ts");
    expect(core).not.toContain("createAdminClient(");
    expect(core.indexOf("provision_registration")).toBeLessThan(core.indexOf("applyWizardOfficeProfile(admin"));
    expect(core.indexOf("applyWizardOfficeProfile(admin")).toBeLessThan(core.indexOf("seedDemoDataForNewTenant(admin"));
    expect(core).toContain("wantsDemoData(formData)");
  });

  it("kayıt sihirbazında 'Demo veriyle başla' kutusu varsayılan açıktır ve açıklaması tek tuşla temizlemeyi söyler", () => {
    const src = read("src/app/kayit/register-form.tsx");
    expect(src).toMatch(/name="demo_data"[\s\S]{0,200}defaultChecked/);
    expect(src).toContain("Demo veriyle başla");
    expect(src).toContain("tek tuşla");
  });

  it("temizleme: RPC öncelikli, geri dönüş yalnız is_sample + tenant_id ile; eylem owner/gm kapılı", () => {
    const clear = read("src/lib/sample-clear.ts");
    expect(clear).toContain('.eq("tenant_id", tenantId)');
    expect(clear).toContain('.eq("is_sample", true)');
    const action = read("src/app/actions/sample-data.ts");
    expect(action).toMatch(/clearSampleData[\s\S]*requirePermission\("settings", "edit"\)/);
    expect(action).toMatch(/clearSampleData[\s\S]*canSwitchToRealUse\(gate\.role\)/);
    expect(action).toContain("purgeSampleData(");
    expect(action).toContain("sample_data.clear");
  });
});
