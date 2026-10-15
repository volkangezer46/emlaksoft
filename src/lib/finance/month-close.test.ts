import { describe, expect, it } from "vitest";
import { buildMonthCloseChecklist, monthNameTr, previousMonthKey, type MonthCloseInput } from "./month-close";

const links = { reconcile: "/r", review: "/v", receipts: "/f", noVat: "/k", vat: "/kv", lock: "/l" };
const base: MonthCloseInput = { monthKey: "2026-09", locked: false, unreconciledBank: 0, reviewCount: 0, receiptlessExpenses: 0, noVatEntries: 0, vatPayable: 1234.4 };

describe("previousMonthKey", () => {
  it("ay ve yıl geçişi", () => {
    expect(previousMonthKey("2026-10-15")).toBe("2026-09");
    expect(previousMonthKey("2027-01-02")).toBe("2026-12");
  });
  it("ay adı", () => expect(monthNameTr("2026-09")).toBe("Eylül 2026"));
});

describe("buildMonthCloseChecklist", () => {
  it("hepsi tamam ve kilitsiz → kilide hazır", () => {
    const r = buildMonthCloseChecklist(base, links);
    expect(r.steps.map((s) => s.key)).toEqual(["reconcile", "review", "receipts", "vat", "lock"]);
    expect(r.done).toBe(4);
    expect(r.total).toBe(5);
    expect(r.readyToLock).toBe(true);
    expect(r.closed).toBe(false);
    const vat = r.steps.find((s) => s.key === "vat")!;
    expect(vat.href).toBe("/kv");
    expect(vat.detail).toMatch(/^Hazır · ödenecek KDV/);
  });

  it("eksik adımlar 'todo', KDV eksikse eksik listesine gider", () => {
    const r = buildMonthCloseChecklist({ ...base, receiptlessExpenses: 3, noVatEntries: 2 }, links);
    expect(r.readyToLock).toBe(false);
    expect(r.steps.find((s) => s.key === "receipts")).toMatchObject({ status: "todo", count: 3, detail: "3 giderin belgesi eklenmedi", href: "/f" });
    expect(r.steps.find((s) => s.key === "vat")).toMatchObject({ status: "todo", href: "/k" });
  });

  it("banka hesabı yoksa mutabakat adımı yok; okunamayan sayı bilinmiyor sayılır", () => {
    const r = buildMonthCloseChecklist({ ...base, unreconciledBank: undefined, reviewCount: null }, links);
    expect(r.steps.some((s) => s.key === "reconcile")).toBe(false);
    expect(r.steps.find((s) => s.key === "review")!.status).toBe("unknown");
    expect(r.readyToLock).toBe(false);
  });

  it("kilitli ay kapanmış sayılır, devreden KDV yazılır", () => {
    const r = buildMonthCloseChecklist({ ...base, locked: true, vatPayable: -500 }, links);
    expect(r.closed).toBe(true);
    expect(r.readyToLock).toBe(false);
    expect(r.done).toBe(5);
    expect(r.steps.find((s) => s.key === "vat")!.detail).toMatch(/devreden KDV/);
  });
});
