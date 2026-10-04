import { describe, expect, it } from "vitest";
import {
  PLANS,
  normalizeBillingCycle,
  normalizePlanId,
  planAmountTry,
  planLabel,
  planLimit,
} from "./plans";

describe("billing plan catalog", () => {
  it("keeps plan identifiers unique", () => {
    expect(new Set(PLANS.map((plan) => plan.id)).size).toBe(PLANS.length);
  });

  it("normalizes untrusted registration query values", () => {
    expect(normalizePlanId("professional")).toBe("professional");
    expect(normalizePlanId("forged")).toBe("office");
    expect(normalizeBillingCycle("yearly")).toBe("yearly");
    expect(normalizeBillingCycle("weekly")).toBe("monthly");
  });

  it("charges ten months for a yearly plan", () => {
    expect(planAmountTry("advisor", "yearly")).toBe(749 * 10);
  });

  it("exposes enforceable advisor usage limits", () => {
    expect(planLimit("advisor", "seats")).toBe(1);
    expect(planLimit("advisor", "customers")).toBe(1_000);
    expect(planLimit("advisor", "activeProperties")).toBe(150);
  });

  it("does not disguise an unknown persisted plan as a valid package", () => {
    expect(planLabel("legacy-plan")).toBe("legacy-plan");
  });
});
