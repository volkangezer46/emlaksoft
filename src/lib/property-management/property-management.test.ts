import { describe, expect, it } from "vitest";
import { computeOwnerLedger, exceedsBalance, balanceLabel } from "./ledger";
import {
  calcPaymentFee,
  chargeDueDate,
  computeLateFee,
  daysLate,
  deriveChargeStatus,
  formatReceiptNo,
  nextReceiptNo,
  remainingAmount,
} from "./payments";
import { isValidTrIban, maskIban, normalizeIban } from "./iban";
import { inPayoutWindow } from "./payments";

describe("durum türetme", () => {
  const base = { amount: 10_000, dueDate: "2026-10-05" };
  it("ödenen toplamdan: ödendi / kısmi / bekliyor / gecikti", () => {
    expect(deriveChargeStatus({ ...base, paid: 10_000, today: "2026-12-01" })).toBe("paid");
    expect(deriveChargeStatus({ ...base, paid: 4_000, today: "2026-10-06" })).toBe("partial");
    expect(deriveChargeStatus({ ...base, paid: 0, today: "2026-10-06" })).toBe("pending");
    expect(deriveChargeStatus({ ...base, paid: 0, today: "2026-10-12" })).toBe("pending"); // tam 7 gün
    expect(deriveChargeStatus({ ...base, paid: 0, today: "2026-10-13" })).toBe("overdue");
    expect(deriveChargeStatus({ ...base, paid: 4_000, today: "2026-10-20" })).toBe("overdue");
  });
  it("kuruş hassasiyeti: 3 x 3333,33 + 0,01 = 10.000", () => {
    expect(deriveChargeStatus({ ...base, paid: 9_999.99, today: "2026-10-06" })).toBe("partial");
    expect(deriveChargeStatus({ ...base, paid: 10_000, today: "2026-10-06" })).toBe("paid");
    expect(remainingAmount(10_000, 3_333.33)).toBe(6_666.67);
    expect(remainingAmount(100, 150)).toBe(0);
  });
  it("vade günü ve gecikme günü", () => {
    expect(chargeDueDate("2026-10-01", 5)).toBe("2026-10-05");
    expect(chargeDueDate("2026-02-01", 31)).toBe("2026-02-28");
    expect(daysLate({ ...base, paid: 0, today: "2026-10-15" })).toBe(10);
    expect(daysLate({ ...base, paid: 0, today: "2026-10-01" })).toBe(0);
    expect(daysLate({ ...base, paid: 10_000, today: "2026-10-15" })).toBe(0);
  });
});

describe("gecikme bedeli (ofis ayarı, varsayılan kapalı)", () => {
  const off = { enabled: false, monthlyPercent: 3, graceDays: 0 };
  const on = { enabled: true, monthlyPercent: 3, graceDays: 2 };
  it("kapalıyken 0", () => expect(computeLateFee({ outstanding: 10_000, daysLate: 30, settings: off })).toBe(0));
  it("açıkken kalan x aylık % x (gün - hoşgörü) / 30", () => {
    expect(computeLateFee({ outstanding: 10_000, daysLate: 32, settings: on })).toBe(300);
    expect(computeLateFee({ outstanding: 10_000, daysLate: 2, settings: on })).toBe(0);
    expect(computeLateFee({ outstanding: 3_333.33, daysLate: 10, settings: { ...on, graceDays: 0 } })).toBe(33.33);
  });
});

describe("makbuz sırası", () => {
  it("sıralı ve biçimli", () => {
    expect(nextReceiptNo(null)).toBe(1);
    expect(nextReceiptNo(41)).toBe(42);
    expect(formatReceiptNo(42)).toBe("MKB-000042");
  });
});

describe("yönetim ücreti", () => {
  it("yüzde: kuruşa yuvarlanır", () => {
    expect(calcPaymentFee({ feeType: "percent", feeValue: 8, amount: 12_345.67 })).toBe(987.65);
    expect(calcPaymentFee({ feeType: "percent", feeValue: 10, amount: 0.05 })).toBe(0.01);
  });
  it("sabit: tahakkuk başına bir kez, önceki ücret düşülür, tahsilatı aşmaz", () => {
    expect(calcPaymentFee({ feeType: "fixed", feeValue: 1_500, amount: 5_000 })).toBe(1_500);
    expect(calcPaymentFee({ feeType: "fixed", feeValue: 1_500, amount: 5_000, priorFeeOnCharge: 1_500 })).toBe(0);
    expect(calcPaymentFee({ feeType: "fixed", feeValue: 1_500, amount: 1_000 })).toBe(1_000);
    expect(calcPaymentFee({ feeType: "fixed", feeValue: 1_500, amount: 1_000, priorFeeOnCharge: 1_000 })).toBe(500);
  });
  it("sözleşme yoksa 0", () => expect(calcPaymentFee({ feeType: null, feeValue: null, amount: 5_000 })).toBe(0));
});

describe("hakediş defteri", () => {
  it("tahsilat − ücret − gider − aidat − ödeme = bakiye; ay ay devreden", () => {
    const l = computeOwnerLedger({
      payments: [
        { id: "p1", paidOn: "2026-09-05", amount: 20_000, managementFee: 1_600 },
        { id: "p2", paidOn: "2026-10-05", amount: 20_000, managementFee: 1_600 },
      ],
      charges: [
        { id: "e1", kind: "expense", date: "2026-09-20", amount: 2_500.5, label: "Tesisat" },
        { id: "d1", kind: "due", date: "2026-10-01", amount: 700, label: "Aidat" },
      ],
      payouts: [{ id: "o1", paidOn: "2026-09-28", amount: 15_000 }],
    });
    expect(l.months.map((m) => m.month)).toEqual(["2026-09", "2026-10"]);
    expect(l.months[0]).toMatchObject({ collected: 20_000, fee: 1_600, expenses: 2_500.5, entitlement: 15_899.5, paidOut: 15_000, closing: 899.5 });
    expect(l.months[1]).toMatchObject({ dues: 700, entitlement: 17_700, closing: 18_599.5 });
    expect(l.totals).toMatchObject({ collected: 40_000, fee: 3_200, entitlement: 33_599.5, paidOut: 15_000, balance: 18_599.5 });
    expect(l.payable).toBe(18_599.5);
  });
  it("kısmi ödeme kuruş toplamı kayma yapmaz", () => {
    const l = computeOwnerLedger({
      payments: [0.1, 0.2, 0.3].map((a, i) => ({ id: `p${i}`, paidOn: "2026-10-01", amount: a, managementFee: 0 })),
      charges: [],
      payouts: [],
    });
    expect(l.totals.collected).toBe(0.6);
  });
  it("fazla ödeme negatif bakiye (alacak); ödenecek 0", () => {
    const l = computeOwnerLedger({ payments: [{ id: "p", paidOn: "2026-10-01", amount: 1_000, managementFee: 100 }], charges: [], payouts: [{ id: "o", paidOn: "2026-10-02", amount: 1_200 }] });
    expect(l.totals.balance).toBe(-300);
    expect(l.payable).toBe(0);
    expect(balanceLabel(-300)).toMatch(/alacak/);
    expect(exceedsBalance(l.totals.balance, 10)).toBe(true);
    expect(exceedsBalance(900, 900)).toBe(false);
  });
  it("veri yoksa boş", () => {
    const l = computeOwnerLedger({ payments: [], charges: [], payouts: [] });
    expect(l.hasData).toBe(false);
    expect(l.totals.balance).toBe(0);
  });
});

describe("IBAN", () => {
  const valid = "TR330006100519786457841326";
  it("sağlama ve biçim", () => {
    expect(isValidTrIban(valid)).toBe(true);
    expect(isValidTrIban("tr33 0006 1005 1978 6457 8413 26")).toBe(true);
    expect(isValidTrIban("TR330006100519786457841327")).toBe(false);
    expect(isValidTrIban("DE89370400440532013000")).toBe(false);
  });
  it("maskeli gösterim ortayı gizler", () => {
    const m = maskIban(valid)!;
    expect(m).toContain("TR33");
    expect(m.endsWith("26")).toBe(true);
    expect(m).not.toContain("0006");
    expect(normalizeIban(" tr33-0006 ")).toBe("TR330006");
  });
});

describe("ödeme günü penceresi", () => {
  it("ödeme günü ve 3 gün tolerans", () => {
    expect(inPayoutWindow(5, 5)).toBe(true);
    expect(inPayoutWindow(8, 5)).toBe(true);
    expect(inPayoutWindow(9, 5)).toBe(false);
    expect(inPayoutWindow(4, 5)).toBe(false);
  });
});
