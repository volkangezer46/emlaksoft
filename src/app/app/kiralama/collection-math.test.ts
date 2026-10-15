import { describe, expect, it } from "vitest";
import { periodCollection } from "./collection-math";

describe("kiralama bu ayın tahsilatı (B107)", () => {
  it("322.000 tahakkuk / 137.300 tahsil → %43; gecikmiş kalan ayrı dilim", () => {
    const r = periodCollection({ paid: 137_300, pending: 38_000, overdue: 146_700, total: 322_000 });
    expect(r.rate).toBe(43);
    expect(r.overdue).toBe(146_700);
    expect(r.paid + r.pending + r.overdue).toBe(r.total);
  });

  it("toplam bilinmiyorsa dilimlerden kurulur; eski formül (tahsil / (tahsil + bekleyen)) kullanılmaz", () => {
    const r = periodCollection({ paid: 137_300, pending: 38_000, overdue: 146_700 });
    expect(r.total).toBe(322_000);
    expect(r.rate).toBe(43);
    expect(Math.round((137_300 / (137_300 + 38_000)) * 100)).toBe(78); // eski yanlış oran
  });

  it("tahakkuk yoksa oran yok", () => {
    expect(periodCollection({ paid: 0, pending: 0, overdue: 0 }).rate).toBeNull();
  });
});
