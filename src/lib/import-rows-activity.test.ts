import { describe, expect, it } from "vitest";
import { buildCustomerLookup } from "@/lib/import-rows";
import {
  appointmentKey,
  expenseKey,
  parseTrDateTime,
  planActivityRows,
  taskKey,
  validateAppointmentRow,
  validateExpenseRow,
  validateTaskRow,
} from "./import-rows-activity";

const lookup = buildCustomerLookup([
  { id: "c1", full_name: "Ayşe Yılmaz", phone: "05321234567", email: "ayse@example.com", customer_types: [], source: null, notes: null },
]);

describe("parseTrDateTime", () => {
  it("TR ve ISO biçimleri; saat TR (UTC+3)", () => {
    expect(parseTrDateTime("15.11.2026 10:00")).toEqual({ iso: "2026-11-15T07:00:00.000Z", day: "2026-11-15", hasTime: true });
    expect(parseTrDateTime("2026-11-15")).toMatchObject({ day: "2026-11-15", hasTime: false });
    expect(parseTrDateTime("31.02.2026")).toBeNull();
    expect(parseTrDateTime("yarın")).toBeNull();
  });
});

describe("görev satırı", () => {
  it("telefonla müşteriye bağlanır, tür/öncelik Türkçe etiketten çözülür", () => {
    const v = validateTaskRow({ row: 2, title: "Geri ara", due_at: "15.11.2026", kind: "Arama", priority: "Yüksek", customer_phone: "0532 123 45 67" }, lookup);
    expect(v.data).toMatchObject({ kind: "call", priority: "high", customer_id: "c1", due_at: "2026-11-15T06:00:00.000Z" });
  });
  it("eşleşmeyen müşteri uyarı verir, görev müşterisiz eklenir; başlıksız satır hatalı", () => {
    const v = validateTaskRow({ row: 3, title: "X", customer_phone: "0533 000 00 00" }, lookup);
    expect(v.data?.customer_id).toBeNull();
    expect(v.issues.some((i) => i.level === "warning")).toBe(true);
    expect(validateTaskRow({ row: 4 }, lookup).data).toBeUndefined();
  });
});

describe("randevu ve gider satırı", () => {
  it("saatsiz randevu 10:00 varsayılır; tür etiketi çözülür", () => {
    const v = validateAppointmentRow({ row: 2, scheduled_at: "15.11.2026", appointment_type: "Değerleme" }, lookup);
    expect(v.data).toMatchObject({ appointment_type: "valuation", scheduled_at: "2026-11-15T07:00:00.000Z" });
    expect(validateAppointmentRow({ row: 3 }, lookup).data).toBeUndefined();
  });
  it("gider: TR tutar ve kategori etiketi; tutarsız satır hatalı", () => {
    const v = validateExpenseRow({ row: 2, title: "İlan", amount: "2.450,50", category: "Reklam & Pazarlama", expense_date: "01.11.2026" }, "2026-11-20");
    expect(v.data).toMatchObject({ amount: 2450.5, category: "reklam", expense_date: "2026-11-01" });
    expect(validateExpenseRow({ row: 3, title: "X" }, "2026-11-20").data).toBeUndefined();
    expect(validateExpenseRow({ row: 4, title: "X", amount: "10" }, "2026-11-20").data?.expense_date).toBe("2026-11-20");
  });
});

describe("planActivityRows", () => {
  it("dosya içi ve mevcut mükerrer atlanır; 'yeni oluştur' politikası atlamaz", () => {
    const rows = [
      { row: 2, title: "A", amount: "10", expense_date: "01.11.2026" },
      { row: 3, title: "A", amount: "10", expense_date: "01.11.2026" },
      { row: 4, title: "B", amount: "20", expense_date: "01.11.2026" },
    ];
    const existing = new Set([expenseKey({ title: "B", amount: 20, expense_date: "2026-11-01" })]);
    const plan = planActivityRows(rows, (r) => validateExpenseRow(r, "2026-11-20"), expenseKey, existing, "skip");
    expect(plan.map((p) => p.status)).toEqual(["new", "skip", "skip"]);
    const forced = planActivityRows(rows, (r) => validateExpenseRow(r, "2026-11-20"), expenseKey, existing, "create");
    expect(forced.map((p) => p.status)).toEqual(["new", "new", "new"]);
  });
  it("anahtarlar kararlı", () => {
    expect(taskKey({ title: "Geri Ara", due_at: null, customer_id: null })).toBe(taskKey({ title: "geri ara", due_at: null, customer_id: null }));
    expect(appointmentKey({ scheduled_at: "x", appointment_type: "showing", customer_id: null })).toBe("x|showing|");
  });
});
