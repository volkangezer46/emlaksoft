import { describe, expect, it } from "vitest";
import { buildRentalProcess, isManualRentalStepKey, parseHandoverSteps } from "./rental-process";

const base = { createdDay: "2026-10-01", manual: {}, contractStatuses: [], deposit: 50_000, depositReceived: false, firstChargePaid: false };

describe("buildRentalProcess", () => {
  it("yeni kira: yalnız başvuru tamam, sıradaki adım kefil", () => {
    const r = buildRentalProcess(base);
    expect(r.done).toBe(1);
    expect(r.total).toBe(8);
    expect(r.next?.key).toBe("guarantor");
    expect(r.steps[0]).toMatchObject({ key: "application", state: "done", source: "auto", doneDay: "2026-10-01", canToggle: false });
  });

  it("imzalı sözleşme ve kasaya işlenmiş depozito + ödenmiş ilk kira kendiliğinden tamamlar ve elle geri alınamaz", () => {
    const r = buildRentalProcess({ ...base, contractStatuses: ["cancelled", "signed"], depositReceived: true, firstChargePaid: true });
    const byKey = Object.fromEntries(r.steps.map((s) => [s.key, s]));
    expect(byKey.contract_signed).toMatchObject({ state: "done", source: "auto", canToggle: false });
    expect(byKey.deposit_first_rent).toMatchObject({ state: "done", source: "auto", canToggle: false });
  });

  it("taslak sözleşme ve yalnız depozito = sürüyor; depozitosuz kirada ilk kira yeterli", () => {
    const r = buildRentalProcess({ ...base, contractStatuses: ["sent"], depositReceived: true });
    const byKey = Object.fromEntries(r.steps.map((s) => [s.key, s]));
    expect(byKey.contract_signed.state).toBe("in_progress");
    expect(byKey.deposit_first_rent.state).toBe("in_progress");
    const noDeposit = buildRentalProcess({ ...base, deposit: null, firstChargePaid: true });
    expect(noDeposit.steps.find((s) => s.key === "deposit_first_rent")?.state).toBe("done");
  });

  it("elle işaretlenen adım tarihiyle tamam; hepsi bitince sıradaki yok", () => {
    const manual = { guarantor: "2026-10-02", owner_approval: "2026-10-02", contract_signed: "2026-10-03", deposit_first_rent: "2026-10-03", handover_report: "2026-10-04", utilities: "2026-10-05", keys: "2026-10-05" };
    const r = buildRentalProcess({ ...base, manual });
    expect(r.done).toBe(8);
    expect(r.next).toBeNull();
    expect(r.steps.find((s) => s.key === "keys")).toMatchObject({ source: "manual", doneDay: "2026-10-05", canToggle: true });
  });
});

describe("parseHandoverSteps", () => {
  it("bilinmeyen anahtar, başvuru adımı ve biçimsiz tarih atılır", () => {
    expect(parseHandoverSteps({ keys: "2026-10-05", application: "2026-10-01", x: "2026-10-01", utilities: "dün" })).toEqual({ keys: "2026-10-05" });
    expect(parseHandoverSteps(null)).toEqual({});
    expect(parseHandoverSteps([1])).toEqual({});
    expect(isManualRentalStepKey("application")).toBe(false);
    expect(isManualRentalStepKey("keys")).toBe(true);
  });
});
