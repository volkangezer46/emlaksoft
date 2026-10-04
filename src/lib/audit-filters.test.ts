import { describe, expect, it } from "vitest";
import {
  actionCodesMatching,
  applyAuditFilters,
  auditFiltersToParams,
  hasAuditFilter,
  normalizeAuditFilters,
} from "./audit-filters";

function fakeQuery() {
  const calls: string[] = [];
  const q = {
    calls,
    gte: (c: string, v: string) => (calls.push(`gte:${c}:${v}`), q),
    lte: (c: string, v: string) => (calls.push(`lte:${c}:${v}`), q),
    eq: (c: string, v: string) => (calls.push(`eq:${c}:${v}`), q),
    in: (c: string, v: string[]) => (calls.push(`in:${c}:${v.length}`), q),
    or: (e: string) => (calls.push(`or:${e}`), q),
  };
  return q;
}

describe("denetim filtreleri", () => {
  it("geçersiz girdi boşa düşer", () => {
    const f = normalizeAuditFilters({ from: "x", to: "2026-13", aktor: "yok", risk: "kritik", tur: "a b;drop", ara: "" });
    expect(hasAuditFilter(f)).toBe(false);
  });

  it("geçerli girdi korunur, arama temizlenir", () => {
    const f = normalizeAuditFilters({
      from: "2026-01-02",
      to: "2026-02-03",
      aktor: "11111111-1111-4111-8111-111111111111",
      risk: "yuksek",
      tur: "customer.delete",
      ara: "müş),action.eq.x",
    });
    expect(f.from).toBe("2026-01-02");
    expect(f.tur).toBe("customer.delete");
    expect(f.ara).not.toMatch(/[(),]/);
  });

  it("sorguya uygulanır", () => {
    const q = fakeQuery();
    applyAuditFilters(q, normalizeAuditFilters({ from: "2026-01-02", risk: "orta", ara: "müşteri" }));
    expect(q.calls[0]).toBe("gte:created_at:2026-01-02");
    expect(q.calls.some((c) => c.startsWith("in:action:"))).toBe(true);
    const or = q.calls.find((c) => c.startsWith("or:")) ?? "";
    expect(or).toContain("action.in.(");
    expect(or).toContain("customer.");
  });

  it("etiketten aksiyon kodu bulur ve URL'e geri yazar", () => {
    expect(actionCodesMatching("müşteri silindi")).toContain("customer.delete");
    const f = normalizeAuditFilters({ risk: "yuksek", ara: "kvkk" });
    expect(auditFiltersToParams(f, 2).toString()).toBe("risk=yuksek&ara=kvkk&sayfa=2");
  });
});
