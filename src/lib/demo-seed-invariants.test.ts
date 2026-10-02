import { describe, expect, it } from "vitest";
import {
  buildDemoCommissionRow,
  buildMissingWonCommissionRows,
  findDemoProjectUnitInvariantViolations,
  findDemoWonInvariantViolations,
  type DemoSeedDeal,
  type DemoSeedProperty,
} from "./demo-seed-invariants";

const saleProperty: DemoSeedProperty = {
  id: "property-sale",
  status: "sold",
  list_price: 6_500_000,
  commission_rate: 2,
};

const rentProperty: DemoSeedProperty = {
  id: "property-rent",
  status: "rented",
  list_price: 55_000,
  commission_rate: 10,
};

const wonSale: DemoSeedDeal = {
  id: "deal-sale",
  stage: "won",
  deal_value: 6_400_000,
  deal_type: "sale",
  property_id: saleProperty.id,
  created_at: "2026-01-01T10:00:00.000Z",
  updated_at: "2026-01-20T10:00:00.000Z",
};

const wonRent: DemoSeedDeal = {
  id: "deal-rent",
  stage: "won",
  deal_value: 55_000,
  deal_type: "rent",
  property_id: rentProperty.id,
  created_at: "2026-02-01T10:00:00.000Z",
  updated_at: "2026-02-03T10:00:00.000Z",
};

describe("demo seed won invariants", () => {
  it("uses canonical commission math and canonical split keys", () => {
    const row = buildDemoCommissionRow({
      tenantId: "tenant",
      deal: wonSale,
      property: saleProperty,
      status: "paid",
    });

    expect(row.gross_amount).toBe(128_000);
    expect(row.vat_amount).toBe(25_600);
    expect(row.splits).toEqual([
      { label: "Danışman", rate: 50, amount: 64_000 },
      { label: "Ofis", rate: 50, amount: 64_000 },
    ]);
  });

  it("creates one historical commission for every missing won deal", () => {
    const rows = buildMissingWonCommissionRows({
      tenantId: "tenant",
      deals: [wonSale, wonRent],
      properties: [saleProperty, rentProperty],
      existingCommissionDealIds: new Set([wonRent.id]),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deal_id: wonSale.id,
      status: "paid",
      created_at: wonSale.updated_at,
    });
  });

  it("fails closed when a won deal has no readable property", () => {
    expect(() =>
      buildMissingWonCommissionRows({
        tenantId: "tenant",
        deals: [{ ...wonSale, property_id: "missing" }],
        properties: [saleProperty],
      }),
    ).toThrow("portföyü okunamadı");
  });

  it("reports missing commissions and sale/rent status mismatches", () => {
    const violations = findDemoWonInvariantViolations({
      deals: [wonSale, wonRent],
      properties: [saleProperty, { ...rentProperty, status: "sold" }],
      commissionDealIds: new Set([wonSale.id]),
    });

    expect(violations.missingCommissionDealIds).toEqual([wonRent.id]);
    expect(violations.missingAssetDealIds).toEqual([]);
    expect(violations.propertyStatusMismatches).toEqual([
      {
        dealId: wonRent.id,
        propertyId: rentProperty.id,
        expected: "rented",
        actual: "sold",
      },
    ]);
  });

  it("accepts a complete sale and rent seed", () => {
    expect(
      findDemoWonInvariantViolations({
        deals: [wonSale, wonRent],
        properties: [saleProperty, rentProperty],
        commissionDealIds: new Set([wonSale.id, wonRent.id]),
      }),
    ).toEqual({
      missingCommissionDealIds: [],
      missingAssetDealIds: [],
      propertyStatusMismatches: [],
    });
  });

  it("keeps project-unit won deals out of property status checks", () => {
    const unitDeal: DemoSeedDeal = {
      id: "deal-unit",
      stage: "won",
      deal_value: "5200000.29",
      deal_type: "sale",
      property_id: null,
      project_unit_id: "unit-1",
      customer_id: "customer-1",
    };

    expect(findDemoWonInvariantViolations({
      deals: [unitDeal],
      properties: [],
      commissionDealIds: new Set([unitDeal.id]),
    })).toEqual({
      missingCommissionDealIds: [],
      missingAssetDealIds: [],
      propertyStatusMismatches: [],
    });
  });

  it("validates project-unit deals in both directions with exact customer and money terms", () => {
    const deal: DemoSeedDeal = {
      id: "deal-unit",
      stage: "won",
      deal_value: "5200000.29",
      deal_type: "sale",
      property_id: null,
      project_unit_id: "unit-1",
      customer_id: "customer-1",
    };
    const complete = findDemoProjectUnitInvariantViolations({
      units: [{ id: "unit-1", status: "sold", customer_id: "customer-1", list_price: "5200000.29" }],
      deals: [deal],
      commissionDealIds: new Set([deal.id]),
    });
    expect(complete).toEqual({
      unitDealCountMismatches: [],
      customerMismatches: [],
      financialMismatches: [],
      dealUnitMismatches: [],
      missingCommissionDealIds: [],
    });

    const mismatched = findDemoProjectUnitInvariantViolations({
      units: [{ id: "unit-1", status: "sold", customer_id: "customer-2", list_price: "5200000.30" }],
      deals: [deal, { ...deal, id: "orphan-deal", project_unit_id: "missing-unit" }],
      commissionDealIds: new Set(),
    });
    expect(mismatched.customerMismatches).toEqual([{ unitId: "unit-1", dealId: deal.id }]);
    expect(mismatched.financialMismatches).toEqual([{ unitId: "unit-1", dealId: deal.id }]);
    expect(mismatched.dealUnitMismatches).toEqual([
      { dealId: deal.id, unitId: "unit-1" },
      { dealId: "orphan-deal", unitId: "missing-unit" },
    ]);
    expect(mismatched.missingCommissionDealIds).toEqual([deal.id, "orphan-deal"]);
  });
});
