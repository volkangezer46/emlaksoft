import { describe, expect, it } from "vitest";
import {
  CORE_WORKFLOW_BLOCKER_KEYS,
  CORE_WORKFLOW_PREFLIGHT_SQL,
  CORE_WORKFLOW_REPAIRABLE_KEYS,
  coreWorkflowBlockerTotal,
  formatCoreWorkflowCounts,
} from "./core-workflow-preflight";

describe("core workflow preflight", () => {
  it("treats ambiguous financial and duplicate ledgers as blockers", () => {
    expect(CORE_WORKFLOW_BLOCKER_KEYS).toContain("non_won_commission");
    expect(CORE_WORKFLOW_BLOCKER_KEYS).toContain("duplicate_projected_closure_groups");
    expect(CORE_WORKFLOW_BLOCKER_KEYS).toContain("duplicate_active_rental_groups");
    expect(CORE_WORKFLOW_BLOCKER_KEYS).toContain("project_unit_deal_mismatch");
    expect(CORE_WORKFLOW_BLOCKER_KEYS).toContain("countered_offer_missing_history");
    expect(coreWorkflowBlockerTotal({ non_won_commission: "1" })).toBe(1);
  });

  it("checks active offer canonical amounts, including countered and latest-round terms", () => {
    expect(CORE_WORKFLOW_PREFLIGHT_SQL).toContain("o.counter_amount < 0.01");
    expect(CORE_WORKFLOW_PREFLIGHT_SQL).toContain("o.counter_amount > 100000000000");
    expect(CORE_WORKFLOW_PREFLIGHT_SQL).toContain("round(o.counter_amount, 2) <> o.counter_amount");
    expect(CORE_WORKFLOW_PREFLIGHT_SQL).toContain("r.amount < 0.01");
    expect(CORE_WORKFLOW_PREFLIGHT_SQL).toContain("project_unit_deal_mismatch");
  });

  it("keeps only deterministic projections in the repairable class", () => {
    expect(CORE_WORKFLOW_REPAIRABLE_KEYS).toEqual([
      "offer_missing_initial_history",
      "active_renter_missing_tag",
    ]);
    expect(coreWorkflowBlockerTotal({ offer_missing_initial_history: "3" })).toBe(0);
  });

  it("formats aggregate counters without requiring entity identifiers", () => {
    expect(formatCoreWorkflowCounts({ won_missing_commission: "5" })).toBe(
      "won_missing_commission=5",
    );
  });
});
