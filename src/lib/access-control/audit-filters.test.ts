import { describe, expect, it } from "vitest";
import { accessAuditFiltersToParams, applyAccessAuditFilters, hasAccessAuditFilter, normalizeAccessAuditFilters } from "./audit-filters";

const UUID = "11111111-2222-4333-8444-555555555555";

class Q {
  calls: string[] = [];
  eq(c: string, v: string) { this.calls.push(`eq:${c}=${v}`); return this; }
  gte(c: string, v: string) { this.calls.push(`gte:${c}=${v}`); return this; }
  lt(c: string, v: string) { this.calls.push(`lt:${c}=${v}`); return this; }
}

describe("access audit filtre kontratı", () => {
  it("yalnız bilinen değerler geçer", () => {
    const f = normalizeAccessAuditFilters({ kullanici: UUID, yapan: "x", tur: "scope_updated", from: "2026-10-01", to: "bozuk" });
    expect(f).toEqual({ kullanici: UUID, yapan: "", tur: "scope_updated", from: "2026-10-01", to: "" });
    expect(normalizeAccessAuditFilters({ tur: "bilinmeyen" }).tur).toBe("");
    expect(hasAccessAuditFilter(normalizeAccessAuditFilters(undefined))).toBe(false);
    expect(hasAccessAuditFilter(f)).toBe(true);
  });

  it("sorguya aynı sırayla uygulanır; `to` günü dahil", () => {
    const q = applyAccessAuditFilters(new Q(), { kullanici: UUID, yapan: "", tur: "override_created", from: "2026-10-01", to: "2026-10-05" });
    expect(q.calls).toEqual([
      `eq:user_id=${UUID}`,
      "eq:change_type=override_created",
      "gte:created_at=2026-10-01T00:00:00.000Z",
      "lt:created_at=2026-10-06T00:00:00.000Z",
    ]);
  });

  it("URL parametreleri: sekme sabit, boşlar düşer, sayfa 1 yazılmaz", () => {
    expect(accessAuditFiltersToParams({ kullanici: "", yapan: "", tur: "", from: "", to: "" }).toString()).toBe("sekme=gunluk");
    expect(accessAuditFiltersToParams({ kullanici: UUID, yapan: "", tur: "", from: "", to: "" }, 3).toString()).toBe(`sekme=gunluk&kullanici=${UUID}&sayfa=3`);
  });
});
