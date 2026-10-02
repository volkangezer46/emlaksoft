import { describe, expect, it } from "vitest";
import { parseDueInput } from "./due-input";

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

describe("due input", () => {
  it("normalizes a bounded professional record", () => {
    expect(parseDueInput(form({
      title: "  Ağustos aidatı  ",
      amount: "1.250,50 ₺",
      period: "2026-08-01",
      due_date: "2026-08-15",
      notes: "  Kapıcı gideri dahil  ",
    }))).toEqual({
      ok: true,
      value: {
        title: "Ağustos aidatı",
        amount: 1_250.5,
        period: "2026-08-01",
        dueDate: "2026-08-15",
        propertyId: null,
        notes: "Kapıcı gideri dahil",
      },
    });
  });

  it.each([
    [{ title: "", amount: "10", period: "2026-08-01" }, "Başlık zorunludur."],
    [{ title: "Aidat", amount: "-10", period: "2026-08-01" }, "Geçerli bir tutar girin."],
    [{ title: "Aidat", amount: "10abc", period: "2026-08-01" }, "Geçerli bir tutar girin."],
    [{ title: "Aidat", amount: "10", period: "2026-02-30" }, "İlgili ay tarihi geçersiz."],
    [{ title: "Aidat", amount: "10", period: "2026-08-01", due_date: "2026-13-01" }, "Son ödeme tarihi geçersiz."],
  ])("rejects invalid input %#", (values, error) => {
    expect(parseDueInput(form(values))).toEqual({ ok: false, error });
  });
});
