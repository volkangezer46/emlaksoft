import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAdvisorScope, gated } from "./advisor-scope";

describe("buildAdvisorScope (B3)", () => {
  it("izinsiz rol: müşteri/komisyon kümeleri kapalı", () => {
    const s = buildAdvisorScope({ dashboard: ["view"] }, "advisor", "u1");
    expect(s.customers).toBe(false);
    expect(s.commissions).toBe(false);
    expect(s.commissionTotal).toBe(false);
    expect(s.officeWide).toBe(false);
  });
  it("commissions:view var ama earnings_all yok: komisyon toplamı yok", () => {
    const s = buildAdvisorScope({ commissions: ["view"], customers: ["view"] }, "branch_manager", "u1");
    expect(s.commissions).toBe(true);
    expect(s.commissionTotal).toBe(false);
    expect(s.officeWide).toBe(true);
  });
  it("earnings_all ile toplam görünür", () => {
    const s = buildAdvisorScope({ commissions: ["view"], earnings_all: ["view"] }, "owner", "u1");
    expect(s.commissionTotal).toBe(true);
  });
  it("gated kapalıyken sorguyu çalıştırmaz", async () => {
    let ran = false;
    await gated(false, () => {
      ran = true;
      return Promise.resolve(1);
    });
    expect(ran).toBe(false);
  });
});

describe("ai-tenant-advisor sözleşmesi (B3)", () => {
  const src = readFileSync("src/app/actions/ai-tenant-advisor.ts", "utf8");
  it("bağlam izin kapsamıyla kurulur", () => {
    expect(src).toContain("buildAdvisorScope(");
    expect(src).toContain("scope.commissionTotal");
    expect(src).not.toMatch(/buildTenantContext\(gate\.tenantId\)/);
  });
});
