import { describe, expect, it } from "vitest";
import { countMatchingProperties } from "./match-count";
import type { MatchDemand, MatchProperty } from "@/lib/matching";

const demand = (over: Partial<MatchDemand> = {}): MatchDemand => ({
  id: "d1",
  transaction_type: "Satılık",
  property_type: "Daire",
  province_id: "il-1",
  district_id: null,
  budget_min: null,
  budget_max: 5_000_000,
  rooms: "3+1",
  min_sqm: null,
  urgency: null,
  status: "active",
  ...over,
});
const prop = (id: string, over: Partial<MatchProperty> = {}): MatchProperty => ({
  id,
  property_code: id,
  title: id,
  transaction_type: "Satılık",
  property_type: "Daire",
  status: "live",
  list_price: 4_500_000,
  province_id: "il-1",
  district_id: null,
  features: { rooms: "3+1", sqm: 120 },
  ...over,
});

describe("countMatchingProperties (CRM-G2: gerçek eşleşme sayısı)", () => {
  it("uyan portföyleri sayar, uymayanı saymaz; çok talebe uyan portföy bir kez sayılır", () => {
    const props = [prop("p1"), prop("p2"), prop("p3", { transaction_type: "Kiralık", property_type: "Dükkan", list_price: 90_000_000, province_id: "il-9", features: { rooms: "1+0" } })];
    expect(countMatchingProperties([demand()], props)).toBe(2);
    expect(countMatchingProperties([demand(), demand({ id: "d2" })], props)).toBe(2);
    expect(countMatchingProperties([], props)).toBe(0);
  });
});
