import { describe, expect, it } from "vitest";
import {
  affordability,
  buildComparison,
  canTransitionApplication,
  parseApplicationForm,
  parseCompareIds,
  rentToIncomeRatio,
  type ComparableApplication,
} from "./applications";

const fd = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k]! : null) });
const TODAY = "2026-10-15";

describe("kiracı başvurusu formu", () => {
  it("zorunlu alanlar ve Türkçe para biçimi", () => {
    expect(parseApplicationForm(fd({ full_name: "A" }), TODAY)).toEqual({ ok: false, error: "Adınızı ve soyadınızı yazın." });
    expect(parseApplicationForm(fd({ full_name: "Ayşe Yıldız" }), TODAY).ok).toBe(false);
    const r = parseApplicationForm(fd({ full_name: "  Ayşe   Yıldız ", phone: "0532 123 45 67", monthly_income: "45.000", household_size: "3" }), TODAY);
    expect(r.ok && r.value).toMatchObject({ fullName: "Ayşe Yıldız", monthlyIncome: 45000, householdSize: 3, guarantorName: null });
  });

  it("geçmiş taşınma tarihi, geçersiz gelir ve adsız kefil telefonu reddedilir", () => {
    const base = { full_name: "Ayşe Yıldız", phone: "05321234567" };
    expect(parseApplicationForm(fd({ ...base, move_in_date: "2026-10-01" }), TODAY).ok).toBe(false);
    expect(parseApplicationForm(fd({ ...base, monthly_income: "-5" }), TODAY).ok).toBe(false);
    expect(parseApplicationForm(fd({ ...base, guarantor_phone: "05321234568" }), TODAY).ok).toBe(false);
    expect(parseApplicationForm(fd({ ...base, household_size: "0" }), TODAY).ok).toBe(false);
  });

  it("kefil yoksa kefil alt alanları atılır; evcil hayvan notu yalnız işaretliyse", () => {
    const r = parseApplicationForm(fd({ full_name: "Ayşe Yıldız", phone: "05321234567", guarantor_income: "50.000", pets_note: "kedi" }), TODAY);
    expect(r.ok && r.value.guarantorIncome).toBeNull();
    expect(r.ok && r.value.petsNote).toBeNull();
    const p = parseApplicationForm(fd({ full_name: "Ayşe Yıldız", phone: "05321234567", has_pets: "on", pets_note: "kedi", guarantor_name: "Ali Yıldız", guarantor_income: "50.000" }), TODAY);
    expect(p.ok && p.value).toMatchObject({ hasPets: true, petsNote: "kedi", guarantorName: "Ali Yıldız", guarantorIncome: 50000 });
  });
});

describe("ödeme gücü", () => {
  it("kira/gelir oranı ve eşikler", () => {
    expect(rentToIncomeRatio(20000, 60000)).toBeCloseTo(1 / 3);
    expect(affordability(rentToIncomeRatio(20000, 60000))).toBe("comfortable");
    expect(affordability(rentToIncomeRatio(20000, 50000))).toBe("borderline");
    expect(affordability(rentToIncomeRatio(20000, 30000))).toBe("risky");
    expect(rentToIncomeRatio(20000, null)).toBeNull();
    expect(affordability(null)).toBe("unknown");
  });
});

describe("durum geçişleri", () => {
  it("onaylanan ve geri çekilen kapalıdır; reddedilen yeniden değerlendirilebilir", () => {
    expect(canTransitionApplication("new", "owner_review")).toBe(true);
    expect(canTransitionApplication("approved", "rejected")).toBe(false);
    expect(canTransitionApplication("withdrawn", "new")).toBe(false);
    expect(canTransitionApplication("rejected", "shortlisted")).toBe(true);
    expect(canTransitionApplication("owner_review", "new")).toBe(false);
  });
});

describe("karşılaştırma", () => {
  const app = (o: Partial<ComparableApplication>): ComparableApplication => ({
    id: "x", full_name: "A", occupation: null, employer: null, monthly_income: null, household_size: null, has_pets: false, smoker: false,
    move_in_date: null, guarantor_name: null, guarantor_income: null, file_count: 0, status: "new", created_at: "2026-10-01", ...o,
  });

  it("en iyi işareti yalnız ölçülebilir ve en az iki veride; eşitlikte işaret yok", () => {
    const rows = buildComparison([app({ id: "a", monthly_income: 60000, file_count: 2 }), app({ id: "b", monthly_income: 50000, file_count: 2 })], 20000);
    const income = rows.find((r) => r.label === "Aylık net gelir")!;
    expect(income.cells.map((c) => c.best)).toEqual([true, false]);
    const ratio = rows.find((r) => r.label === "Kira / gelir")!;
    expect(ratio.cells[0]).toMatchObject({ best: true, tone: "good" });
    expect(ratio.cells[1]!.tone).toBe("warn");
    expect(rows.find((r) => r.label === "Evrak")!.cells.every((c) => !c.best)).toBe(true);
    const single = buildComparison([app({ id: "a", monthly_income: 60000 }), app({ id: "b" })], 20000);
    expect(single.find((r) => r.label === "Aylık net gelir")!.cells.every((c) => !c.best)).toBe(true);
  });

  it("aday kendi ilan kirasını taşırsa oran ona göre hesaplanır", () => {
    const rows = buildComparison([app({ id: "a", monthly_income: 60000, monthly_rent: 30000 }), app({ id: "b", monthly_income: 60000, monthly_rent: 15000 })], null);
    const ratio = rows.find((r) => r.label === "Kira / gelir")!;
    expect(ratio.cells[0]!.text).toContain("%50");
    expect(ratio.cells[1]!.text).toContain("%25");
  });

  it("karşılaştırma kimlikleri: geçerli, tekil, en çok 4", () => {
    const u = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
    expect(parseCompareIds(`${u(1)},${u(1)},bad,${u(2)},${u(3)},${u(4)},${u(5)}`)).toEqual([u(1), u(2), u(3), u(4)]);
    expect(parseCompareIds(undefined)).toEqual([]);
  });
});
