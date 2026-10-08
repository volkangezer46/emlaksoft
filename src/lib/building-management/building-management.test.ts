import { describe, expect, it } from "vitest";
import { compareUnits, distributeAmount, unitLabel, type DistributionUnit } from "./distribution";
import { buildingDueDate, buildingFeeDescription, deriveBuildingChargeStatus, summarizeCharges } from "./charges";
import { computeUnitCari } from "./unit-ledger";
import { parseBuildingInput, parseDecimal, parseUnitInput, parseUnitRange } from "./input";
import { addMonths, isMonthKey } from "./period";
import { planBuildingDueReminders, weekIndex } from "./reminders";
import { calcPaymentFee, computeLateFee, daysLate } from "@/lib/property-management/payments";

const units = (n: number, extra: Partial<DistributionUnit> = {}): DistributionUnit[] =>
  Array.from({ length: n }, (_, i) => ({ id: `u${i + 1}`, label: `Daire ${i + 1}`, ...extra }));
const sumK = (shares: { amount: number }[]) => shares.reduce((s, x) => s + Math.round(x.amount * 100), 0);

describe("dağıtım: eşit", () => {
  it("tam bölünür", () => {
    const r = distributeAmount({ method: "equal", total: 1200, units: units(12) });
    expect(r.ok && r.shares.every((s) => s.amount === 100)).toBe(true);
    expect(r.ok && r.roundingAdjustment).toBe(0);
  });
  it("kuruş farkı SON daireye eklenir ve toplam birebir tutardır", () => {
    const r = distributeAmount({ method: "equal", total: 100, units: units(3) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shares.map((s) => s.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(sumK(r.shares)).toBe(10000);
    expect(r.roundingAdjustment).toBe(0.01);
  });
  it("tek daire tüm tutarı alır", () => {
    const r = distributeAmount({ method: "equal", total: 99.99, units: units(1) });
    expect(r.ok && r.shares[0]!.amount).toBe(99.99);
  });
  it("tutar dairelere bölünemeyecek kadar küçükse hata", () => {
    const r = distributeAmount({ method: "equal", total: 0.02, units: units(5) });
    expect(r.ok).toBe(false);
  });
  it("boş daire listesi, tekrarlı daire ve sıfır tutar reddedilir", () => {
    expect(distributeAmount({ method: "equal", total: 10, units: [] }).ok).toBe(false);
    expect(distributeAmount({ method: "equal", total: 10, units: [{ id: "a" }, { id: "a" }] }).ok).toBe(false);
    expect(distributeAmount({ method: "equal", total: 0, units: units(2) }).ok).toBe(false);
  });
});

describe("dağıtım: arsa payı ve m²", () => {
  it("arsa payı oranlı dağıtır; toplam birebir", () => {
    const us: DistributionUnit[] = [
      { id: "a", landShare: 10 },
      { id: "b", landShare: 20 },
      { id: "c", landShare: 30 },
    ];
    const r = distributeAmount({ method: "land_share", total: 1000, units: us });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shares.map((s) => s.amount)).toEqual([166.67, 333.33, 500]);
    expect(sumK(r.shares)).toBe(100000);
    expect(r.roundingAdjustment).toBe(0);
  });
  it("yuvarlama farkı son daireye gider (1000 / 3 eşit arsa payı)", () => {
    const us: DistributionUnit[] = [
      { id: "a", landShare: 1 },
      { id: "b", landShare: 1 },
      { id: "c", landShare: 1 },
    ];
    const r = distributeAmount({ method: "land_share", total: 1000, units: us });
    expect(r.ok && r.shares.map((s) => s.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(r.ok && r.roundingAdjustment).toBe(0.01);
  });
  it("m² oranlı", () => {
    const us: DistributionUnit[] = [
      { id: "a", areaM2: 80 },
      { id: "b", areaM2: 120 },
    ];
    const r = distributeAmount({ method: "area", total: 500, units: us });
    expect(r.ok && r.shares.map((s) => s.amount)).toEqual([200, 300]);
  });
  it("ağırlığı eksik daireler adıyla raporlanır", () => {
    const r = distributeAmount({ method: "land_share", total: 100, units: [{ id: "a", label: "A · 1", landShare: 5 }, { id: "b", label: "A · 2", landShare: null }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("A · 2");
    const r2 = distributeAmount({ method: "area", total: 100, units: [{ id: "a", areaM2: 0 }] });
    expect(r2.ok).toBe(false);
  });
});

describe("dağıtım: sabit tutar", () => {
  it("toplam = sabit tutarların toplamı; girilen toplam eşleşmeli", () => {
    const us: DistributionUnit[] = [{ id: "a", fixedAmount: 250 }, { id: "b", fixedAmount: 300.5 }];
    const r = distributeAmount({ method: "fixed", units: us });
    expect(r.ok && r.total).toBe(550.5);
    expect(distributeAmount({ method: "fixed", total: 550.5, units: us }).ok).toBe(true);
    expect(distributeAmount({ method: "fixed", total: 600, units: us }).ok).toBe(false);
  });
  it("sabit tutarı olmayan daire reddedilir", () => {
    expect(distributeAmount({ method: "fixed", units: [{ id: "a", fixedAmount: 100 }, { id: "b" }] }).ok).toBe(false);
  });
});

describe("daire sırası", () => {
  it("blok, kat, doğal numara sırası kararlı", () => {
    const list = [
      { id: "3", block: "B", floor: 1, unitNo: "10" },
      { id: "2", block: "A", floor: 2, unitNo: "9" },
      { id: "1", block: "A", floor: 2, unitNo: "10" },
      { id: "4", block: null, floor: null, unitNo: "1" },
    ].sort(compareUnits);
    expect(list.map((u) => u.id)).toEqual(["4", "2", "1", "3"]);
    expect(unitLabel({ block: "A Blok", unitNo: "3" })).toBe("A Blok · 3");
    expect(unitLabel({ block: null, unitNo: "3" })).toBe("Daire 3");
  });
});

describe("durum türetme", () => {
  const base = { amount: 1000, dueDate: "2026-10-05" };
  it("vade günü dahil gecikme sayılmaz; ertesi gün gecikir", () => {
    expect(deriveBuildingChargeStatus({ ...base, paid: 0, today: "2026-10-05" })).toBe("pending");
    expect(deriveBuildingChargeStatus({ ...base, paid: 0, today: "2026-10-06" })).toBe("overdue");
  });
  it("kısmi ve ödendi", () => {
    expect(deriveBuildingChargeStatus({ ...base, paid: 400, today: "2026-10-01" })).toBe("partial");
    expect(deriveBuildingChargeStatus({ ...base, paid: 400, today: "2026-11-01" })).toBe("overdue");
    expect(deriveBuildingChargeStatus({ ...base, paid: 1000, today: "2026-11-01" })).toBe("paid");
  });
  it("vade günü hesabı (1-28 sınırı)", () => {
    expect(buildingDueDate("2026-10-01", 5)).toBe("2026-10-05");
    expect(buildingDueDate("2026-02-01", 31)).toBe("2026-02-28");
    expect(buildingDueDate("2026-02-01", 0)).toBe("2026-02-01");
  });
  it("özet: geciken yalnız ödenmemiş kalan üzerinden", () => {
    const s = summarizeCharges(
      [
        { amount: 100, paid: 100, dueDate: "2026-09-05" },
        { amount: 100, paid: 40, dueDate: "2026-09-05" },
        { amount: 100, paid: 0, dueDate: "2026-12-05" },
      ],
      "2026-10-08",
    );
    expect(s).toMatchObject({ charged: 300, paid: 140, outstanding: 160, overdueCount: 1, overdueAmount: 60 });
    expect(s.collectionRate).toBeCloseTo(46.67, 2);
  });
  it("yönetim ücreti metni", () => {
    expect(buildingFeeDescription("percent", 8)).toBe("%8");
    expect(buildingFeeDescription("fixed", 150)).toContain("Daire başına");
    expect(buildingFeeDescription(null, null)).toBe("Ücret yok");
  });
});

describe("yönetim ücreti ve gecikme bedeli (kira ile ortak kurallar)", () => {
  it("yüzde ücret kuruşa yuvarlanır; sabit ücret tahakkuk başına tavanlıdır", () => {
    expect(calcPaymentFee({ feeType: "percent", feeValue: 8, amount: 333.33 })).toBe(26.67);
    expect(calcPaymentFee({ feeType: "fixed", feeValue: 150, amount: 100 })).toBe(100);
    expect(calcPaymentFee({ feeType: "fixed", feeValue: 150, amount: 100, priorFeeOnCharge: 100 })).toBe(50);
  });
  it("gecikme bedeli ofis ayarı KAPALIYKEN sıfırdır", () => {
    const late = daysLate({ amount: 500, paid: 0, dueDate: "2026-09-05", today: "2026-10-05" });
    expect(late).toBe(30);
    expect(computeLateFee({ outstanding: 500, daysLate: late, settings: { enabled: false, monthlyPercent: 5, graceDays: 0 } })).toBe(0);
    expect(computeLateFee({ outstanding: 500, daysLate: late, settings: { enabled: true, monthlyPercent: 5, graceDays: 0 } })).toBe(25);
  });
});

describe("daire cari", () => {
  it("borç artırır, alacak azaltır; aynı gün önce tahakkuk; kuruş toplamı kayan nokta taşımaz", () => {
    const c = computeUnitCari({
      charges: [
        { id: "c2", date: "2026-11-01", amount: 100.1, label: "Kasım aidatı" },
        { id: "c1", date: "2026-10-01", amount: 100.2, label: "Ekim aidatı" },
      ],
      payments: [{ id: "p1", date: "2026-10-01", amount: 100.2, label: "Tahsilat", receiptNo: 7 }],
    });
    expect(c.entries.map((e) => e.id)).toEqual(["charge:c1", "payment:p1", "charge:c2"]);
    expect(c.entries.map((e) => e.balance)).toEqual([100.2, 0, 100.1]);
    expect(c.totals).toEqual({ charged: 200.3, paid: 100.2, balance: 100.1 });
    expect(c.entries[1]!.label).toContain("makbuz 7");
  });
  it("fazla ödeme negatif bakiye; boş cari hasData=false", () => {
    const c = computeUnitCari({ charges: [{ id: "a", date: "2026-10-01", amount: 50, label: "x" }], payments: [{ id: "b", date: "2026-10-02", amount: 80, label: "Tahsilat" }] });
    expect(c.totals.balance).toBe(-30);
    expect(computeUnitCari({ charges: [], payments: [] }).hasData).toBe(false);
  });
});

describe("girdi doğrulama", () => {
  it("ondalık ayrıştırıcı", () => {
    expect(parseDecimal("85,5", { maxDecimals: 2, max: 1000 })).toEqual({ ok: true, value: 85.5 });
    expect(parseDecimal("", { maxDecimals: 2, max: 1000 })).toEqual({ ok: true, value: null });
    expect(parseDecimal("-5", { maxDecimals: 2, max: 1000 }).ok).toBe(false);
    expect(parseDecimal("1,234", { maxDecimals: 2, max: 1000 }).ok).toBe(false);
  });
  it("bina: ofis yönetmiyorsa ücret yok; yüzde 0-100", () => {
    const ok = parseBuildingInput({ name: "Güneş Apt.", managedByOffice: true, feeType: "percent", feeValue: "8", dueDay: 5, defaultDistribution: "area" });
    expect(ok.ok && ok.value).toMatchObject({ feeType: "percent", feeValue: 8, defaultDistribution: "area" });
    const free = parseBuildingInput({ name: "X", managedByOffice: false, feeType: "percent", feeValue: "8" });
    expect(free.ok && free.value.feeType).toBe(null);
    expect(parseBuildingInput({ name: "X", managedByOffice: true, feeType: "percent", feeValue: "101" }).ok).toBe(false);
    expect(parseBuildingInput({ name: "", managedByOffice: true }).ok).toBe(false);
    expect(parseBuildingInput({ name: "X", dueDay: 29 }).ok).toBe(false);
  });
  it("bina: il/ilçe yalnız kimlik olarak gelir (GeoSelect); ilçe ilsiz olamaz, geçersiz uuid reddedilir", () => {
    const pid = "22222222-2222-4222-8222-222222222222";
    const did = "33333333-3333-4333-8333-333333333333";
    const ok = parseBuildingInput({ name: "X", province_id: pid, district_id: did });
    expect(ok.ok && ok.value).toMatchObject({ provinceId: pid, districtId: did });
    expect(parseBuildingInput({ name: "X", district_id: did }).ok).toBe(false);
    expect(parseBuildingInput({ name: "X", province_id: "istanbul" }).ok).toBe(false);
    const none = parseBuildingInput({ name: "X" });
    expect(none.ok && none.value).toMatchObject({ provinceId: null, districtId: null });
  });
  it("daire: kiracı öder ise kiracı müşteri zorunlu; geçersiz uuid reddedilir", () => {
    expect(parseUnitInput({ unitNo: "3", payer: "tenant" }).ok).toBe(false);
    const id = "11111111-1111-4111-8111-111111111111";
    const ok = parseUnitInput({ unitNo: "3", payer: "tenant", tenantCustomerId: id, areaM2: "85,5", landShare: "12,5", fixedAmount: "400" });
    expect(ok.ok && ok.value).toMatchObject({ areaM2: 85.5, landShare: 12.5, fixedAmount: 400, tenantCustomerId: id });
    expect(parseUnitInput({ unitNo: "3", ownerCustomerId: "x" }).ok).toBe(false);
    expect(parseUnitInput({ unitNo: "" }).ok).toBe(false);
  });
  it("toplu daire aralığı", () => {
    const r = parseUnitRange({ from: 1, to: 12, block: "A" });
    expect(r.ok && r.numbers.length).toBe(12);
    expect(parseUnitRange({ from: 5, to: 1 }).ok).toBe(false);
    expect(parseUnitRange({ from: 1, to: 400 }).ok).toBe(false);
  });
  it("dönem yardımcıları", () => {
    expect(isMonthKey("2026-10")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});

describe("aidat vade hatırlatma planı", () => {
  const row = (over: Partial<Parameters<typeof planBuildingDueReminders>[0][number]>) => ({
    tenantId: "T1", buildingId: "B1", buildingName: "Güneş Apt.", amount: 100, paid: 0, dueDate: "2026-10-10", ...over,
  });
  it("3 gün içinde vadesi gelen ve geçmiş olanlar bina başına özetlenir; ödenmiş/uzak olanlar atlanır", () => {
    const plan = planBuildingDueReminders(
      [row({ dueDate: "2026-10-10" }), row({ dueDate: "2026-10-11", amount: 50 }), row({ dueDate: "2026-10-01" }), row({ dueDate: "2026-10-20" }), row({ paid: 100, dueDate: "2026-10-09" })],
      "2026-10-08",
    );
    expect(plan.map((p) => [p.kind, p.count, p.amount])).toEqual([["upcoming", 2, 150], ["overdue", 1, 100]]);
    expect(plan[0]!.dedupeKey).toBe("bldg-due-up:B1:2026-10");
  });
  it("ofisler birbirine karışmaz; geciken anahtarı haftalıktır", () => {
    const plan = planBuildingDueReminders([row({ dueDate: "2026-10-01" }), row({ tenantId: "T2", buildingId: "B2", dueDate: "2026-10-01" })], "2026-10-08");
    expect(plan.map((p) => p.tenantId).sort()).toEqual(["T1", "T2"]);
    expect(weekIndex("2026-10-08")).toBe(weekIndex("2026-10-05"));
    expect(weekIndex("2026-10-12")).toBe(weekIndex("2026-10-08") + 1);
  });
});
