import { describe, expect, it, vi } from "vitest";
import { isSensitiveFieldName } from "@/lib/form-tabs";
import { activeSteps, runPlan, stepIssues } from "@/components/ui/wizard/engine";
import { RENT_DRAFT_FIELDS, rentInitialStep, rentPlan, rentRate, rentSteps, rentTotals, rentalNotes } from "./kira-adimlar";

const o = { canSetRate: true, canCreateCustomer: true, canHandover: true };
const steps = rentSteps(o);
const step = (id: string) => steps.find((s) => s.id === id);
const base = {
  property_id: "p1",
  property_rate: "100",
  renter_mode: "mevcut",
  renter_customer_id: "c1",
  monthly_rent: "25.000",
  due_day: "5",
  deposit: "50.000",
  dues: "1.500",
  start_date: "2026-11-01",
  end_date: "2027-10-31",
  usage: "konut",
  withholding_rate: "0",
  increase_rule: "tufe",
  tenant_pays_fee: "1",
  first_charge: "1",
  notes: "Evcil hayvan yok.",
};

function actions() {
  return {
    createCustomer: vi.fn(async (_fd: FormData) => ({ ok: true, id: "c-new" }) as { ok?: boolean; error?: string; id?: string; duplicate?: boolean }),
    setRate: vi.fn(async () => ({ ok: true as const })),
    createRental: vi.fn(async (_fd: FormData) => ({ ok: true, id: "r1" }) as { ok?: boolean; error?: string; id?: string }),
    createCharge: vi.fn(async () => ({ ok: true }) as { ok?: boolean; error?: string }),
    saveInspection: vi.fn(async () => ({ ok: true })),
    markStep: vi.fn(async () => ({ ok: true })),
  };
}

describe("kiralama sihirbazı adımları", () => {
  it("Mülk → Kiracı → Kira koşulları → Teslim → Özet; teslim yetkisi yoksa adım yok", () => {
    expect(activeSteps(steps, {}).map((s) => s.id)).toEqual(["mulk", "kiraci", "kosullar", "teslim", "ozet"]);
    expect(activeSteps(rentSteps({ ...o, canHandover: false }), {}).map((s) => s.id)).toEqual(["mulk", "kiraci", "kosullar", "ozet"]);
  });

  it("mülk: portföy ve komisyon oranı (kira kapanışı oran ister)", () => {
    expect(stepIssues(step("mulk"), {}).map((i) => i.field)).toEqual(["wz-rent-property"]);
    expect(stepIssues(step("mulk"), { property_id: "p1" }).map((i) => i.field)).toEqual(["wz-rent-rate"]);
    expect(stepIssues(step("mulk"), { property_id: "p1", commission_rate: "100" })).toEqual([]);
    expect(rentRate({ property_rate: "", commission_rate: "50" })).toBe(50);
  });

  it("kiracı: mevcut seçim ya da hızlı kayıt (ad + telefon)", () => {
    expect(stepIssues(step("kiraci"), { renter_mode: "mevcut" }).map((i) => i.field)).toEqual(["wz-renter"]);
    expect(stepIssues(step("kiraci"), { renter_mode: "yeni", renter_name: "Ali" }).map((i) => i.field)).toEqual(["wz-renter-phone"]);
    expect(stepIssues(step("kiraci"), { renter_mode: "basvuru" }).map((i) => i.field)).toEqual(["wz-renter-app"]);
  });

  it("koşullar: kira, vade 1-28, başlangıç, bitiş sonrası, sabit artış oranı", () => {
    expect(stepIssues(step("kosullar"), base)).toEqual([]);
    expect(stepIssues(step("kosullar"), { ...base, due_day: "31" }).map((i) => i.field)).toEqual(["wz-rent-due"]);
    expect(stepIssues(step("kosullar"), { ...base, end_date: "2026-10-01" }).map((i) => i.field)).toEqual(["wz-rent-end"]);
    expect(stepIssues(step("kosullar"), { ...base, increase_rule: "sabit", increase_fixed: "" }).map((i) => i.field)).toEqual(["wz-rent-inc-fixed"]);
    expect(stepIssues(step("kosullar"), { ...base, withholding_rate: "70" }).map((i) => i.field)).toEqual(["wz-rent-wh"]);
  });

  it("taşınma maliyeti ve kira notu (artış + aidat)", () => {
    expect(rentTotals(base)?.total).toBe(25_000 + 50_000 + 1_500 + 30_000);
    expect(rentalNotes(base)).toBe(
      "Evcil hayvan yok.\nArtış kuralı: her kira yılında TÜFE 12 aylık ortalaması (konutta TBK 344 tavanı).\nAidat: ₺1.500 / ay, kiracı öder.",
    );
  });

  it("bağlamdan gelen portföy + kiracı koşullardan açar", () => {
    expect(rentInitialStep(base)).toBe("kosullar");
    expect(rentInitialStep({ property_id: "p1", property_rate: "100" })).toBe("kiraci");
    expect(rentInitialStep({ property_id: "p1" })).toBe("mulk");
  });

  it("taslak beyaz listesi kişisel veri (ad, telefon, e-posta, not) içermez", () => {
    for (const f of RENT_DRAFT_FIELDS) expect(isSensitiveFieldName(f), f).toBe(false);
    for (const f of ["renter_name", "renter_phone", "renter_email", "notes"]) expect(RENT_DRAFT_FIELDS).not.toContain(f as never);
  });
});

describe("kiralama planı", () => {
  it("kira kaydı → ilk tahakkuk (başlangıç ayı) → teslim tutanağı, anahtar, abonelik", async () => {
    const a = actions();
    const v = { ...base, inspection_on: "1", inspected_on: "2026-11-01", meter_electricity: "12345", key_0: "3", keys_handed: "1", utilities_done: "1", application_id: "app1" };
    const tasks = rentPlan(v, new Set(), o, a);
    expect(tasks.map((t) => t.id)).toEqual(["kira", "tahakkuk", "tutanak", "anahtar", "abonelik"]);
    const res = await runPlan(tasks, { ctx: {}, done: [] });
    expect(res.status).toBe("done");
    const fd = a.createRental.mock.calls[0][0];
    expect(fd.get("renter_customer_id")).toBe("c1");
    expect(fd.get("application_id")).toBe("app1");
    expect(String(fd.get("notes"))).toContain("Aidat");
    expect(a.createCharge).toHaveBeenCalledWith("r1", "2026-11");
    expect(a.saveInspection).toHaveBeenCalledWith(expect.objectContaining({ rentalId: "r1", kind: "move_in", inspectedOn: "2026-11-01" }));
    expect(a.markStep).toHaveBeenCalledWith("r1", "keys", true);
  });

  it("yeni kiracı önce açılır; mükerrer telefonda hiçbir kayıt açılmadan durur", async () => {
    const a = actions();
    a.createCustomer.mockResolvedValueOnce({ error: "x", duplicate: true });
    const v = { ...base, renter_mode: "yeni", renter_customer_id: "", renter_name: "Ali", renter_phone: "05321234567" };
    const res = await runPlan(rentPlan(v, new Set(), o, a), { ctx: {}, done: [] });
    expect(res.status === "failed" && res.failedId).toBe("kiraci");
    expect(res.status === "failed" && res.error).toMatch(/mevcut müşteriyi seçin/);
    expect(res.done).toEqual([]);
    expect(a.createRental).not.toHaveBeenCalled();
    const ok = await runPlan(rentPlan(v, new Set(), o, a), { ctx: {}, done: [] });
    expect(ok.status).toBe("done");
    expect(a.createRental.mock.calls[0][0].get("renter_customer_id")).toBe("c-new");
    expect(a.createCustomer.mock.calls[1][0].get("type")).toBe("Kiracı");
  });

  it("oran portföyde yoksa kira kaydından önce yazılır; teslim atlandıysa teslim görevleri yok; 'zaten var' tahakkuk hata değil", async () => {
    const a = actions();
    a.createCharge.mockResolvedValueOnce({ error: "Bu dönem için tahakkuk zaten var." });
    const v = { ...base, property_rate: "", commission_rate: "100", inspection_on: "1", inspected_on: "2026-11-01" };
    const tasks = rentPlan(v, new Set(["teslim"]), o, a);
    expect(tasks.map((t) => t.id)).toEqual(["oran", "kira", "tahakkuk"]);
    expect((await runPlan(tasks, { ctx: {}, done: [] })).status).toBe("done");
  });
});
