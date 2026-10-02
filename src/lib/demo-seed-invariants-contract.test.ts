import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const seed = fs.readFileSync(path.join(process.cwd(), "scripts/seed-demo.ts"), "utf8");

describe("demo seed invariant integration", () => {
  it("binds historical won deals to dedicated closed reference properties", () => {
    for (const code of ["DEMO-016", "DEMO-017", "DEMO-018", "DEMO-019"]) {
      expect(seed).toMatch(new RegExp(`code: "${code}"[^\\n]+status: "sold"`));
      expect(seed).toContain(`prop: "${code}"`);
    }
    expect(seed).not.toContain('await section("Portföyler"');
    expect(seed).toContain("Trend anlaşma yeniden bağlama");
  });

  it("does not use active or rental listings as historical sale markers", () => {
    const trendBlock = seed.slice(
      seed.indexOf("const extra = [", seed.indexOf("Aylık kazanılan ciro trendi")),
      seed.indexOf("const { data: dealsData }"),
    );
    for (const oldCode of ["DEMO-002", "DEMO-009", "DEMO-010", "DEMO-011"]) {
      expect(trendBlock).not.toContain(`prop: "${oldCode}"`);
    }
  });

  it("generates all missing won commissions and verifies both postconditions", () => {
    expect(seed).toContain("buildMissingWonCommissionRows({");
    expect(seed).toContain("findDemoWonInvariantViolations({");
    expect(seed).toContain("violations.missingCommissionDealIds.length");
    expect(seed).toContain("violations.missingAssetDealIds.length");
    expect(seed).toContain("violations.propertyStatusMismatches.length");
    expect(seed).toContain("findDemoProjectUnitInvariantViolations({");
    expect(seed).toContain("unitViolations.financialMismatches.length");
    expect(seed).toContain("unitViolations.dealUnitMismatches.length");
    expect(seed).not.toContain("const wonSale = deals.find");
  });

  it("re-reads enriched properties and final ledgers so reruns validate fresh state", () => {
    const enrichment = seed.indexOf("const terminalDemoCodes");
    const refreshed = seed.indexOf("const { data: refreshedPropsData");
    const dealSnapshot = seed.indexOf("const { data: dealsData }");
    expect(enrichment).toBeGreaterThan(-1);
    expect(refreshed).toBeGreaterThan(enrichment);
    expect(dealSnapshot).toBeGreaterThan(refreshed);
    expect(seed).toContain("const propsData = refreshedPropsData");
    expect(seed).toContain("project_unit_id, customer_id");
    expect(seed).toContain("const { data: finalDeals");
    expect(seed).toContain("const { data: finalCommissions");
    expect(seed).toContain("const { data: finalProperties");
    expect(seed).toContain("properties: finalProperties ?? []");
    expect(seed.indexOf("const { data: finalProperties")).toBeGreaterThan(
      seed.indexOf('.update({ status: "rented" })'),
    );
  });

  it("lets a partial project-unit sale rerun reach the unit commission repair", () => {
    const earlyCommissionCheck = seed.slice(
      seed.indexOf("const propertyStageDeals"),
      seed.indexOf("// ---------------- Görevler"),
    );
    expect(earlyCommissionCheck).toContain("deals.filter((deal) => !deal.project_unit_id)");
    expect(earlyCommissionCheck).toContain("deals: propertyStageDeals");
    expect(seed.indexOf("const propertyStageDeals")).toBeLessThan(
      seed.indexOf("const { data: soldUnits"),
    );
    expect(seed).toContain("if (!commission) {");
  });

  it("defers an interrupted rent-deal/property write to the active-rental repair", () => {
    const currentWon = seed.indexOf("const { data: currentWon");
    const interruptedLookup = seed.indexOf("const { data: repairableRental", currentWon);
    const mismatchThrow = seed.indexOf("Demo won portföy durumu uzlaştırılmamış", currentWon);
    const activeRentalRepair = seed.indexOf("const { data: activeRentals", currentWon);
    expect(interruptedLookup).toBeGreaterThan(currentWon);
    expect(interruptedLookup).toBeLessThan(mismatchThrow);
    expect(activeRentalRepair).toBeGreaterThan(mismatchThrow);
    expect(seed.slice(interruptedLookup, activeRentalRepair)).toContain('.eq("renter_customer_id", deal.customer_id)');
    expect(seed.slice(interruptedLookup, activeRentalRepair)).toContain("if (repairableRental) continue");
  });
});
