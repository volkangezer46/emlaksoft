import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCESS_TUR, accessToAuditRow, applyAccessFilters, isAccessCode, type AccessRow } from "./audit";

class Q {
  calls: string[] = [];
  eq(c: string, v: string) { this.calls.push(`eq:${c}=${v}`); return this; }
  gte(c: string, v: string) { this.calls.push(`gte:${c}=${v}`); return this; }
  lte(c: string, v: string) { this.calls.push(`lte:${c}=${v}`); return this; }
  in(c: string, v: string[]) { this.calls.push(`in:${c}=${v.join(",")}`); return this; }
}

const row: AccessRow = {
  id: "a1", user_id: "u1", change_type: "scope_updated", created_by: "boss", created_at: "2026-10-05T10:00:00Z",
  reason: " Ekip değişti ", details: { before: { scope: "own" }, after: { scope: "team" } },
};

describe("denetim akışı: yetki satırı birleşimi", () => {
  it("yetki satırı denetim satırına çevrilir (kod, kayıt, neden)", () => {
    const r = accessToAuditRow(row);
    expect(r).toMatchObject({ id: "yetki-a1", action: "yetki.scope_updated", entity_type: "team_member", entity_id: "u1", actor_id: "boss" });
    expect(r.old_value).toEqual({ scope: "own" });
    expect(r.new_value).toEqual({ scope: "team", neden: "Ekip değişti" });
    expect(isAccessCode(r.action)).toBe(true);
    expect(isAccessCode("customer.create")).toBe(false);
  });

  it("süzgeçler yetki sorgusuna uygulanır; tek tür seçilirse change_type daralır", () => {
    const q = applyAccessFilters(new Q(), { from: "2026-10-01", to: "2026-10-05", aktor: "boss", tur: "yetki.scope_updated" }, null);
    expect(q.calls).toEqual(["gte:created_at=2026-10-01", "lte:created_at=2026-10-05T23:59:59.999", "eq:created_by=boss", "eq:change_type=scope_updated"]);
    const all = applyAccessFilters(new Q(), { from: "", to: "", aktor: "", tur: ACCESS_TUR }, ["scope_created"]);
    expect(all.calls).toEqual(["in:change_type=scope_created"]);
  });

  it("denetim sayfası: yetki kaynağı yalnız owner/gm için sorgulanır (RLS sessiz 0 yok)", () => {
    const src = readFileSync("src/app/app/ofis-kontrol/kayit/page.tsx", "utf8");
    expect(src).toMatch(/canReadAccess\s*=\s*role === "owner" \|\| role === "gm"/);
    expect(src).toMatch(/includeAccess =\s*canReadAccess &&/);
  });
});
