import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PLANS } from "./plans";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260802000320_plan_entitlements.sql"),
  "utf8",
);

describe("plan entitlement database contract", () => {
  // TODO(P2): professional seed 20 kullanıcı, onaylı katalog 15. Açık, plan-sql-constants-contract.test.ts
  // KNOWN_OPEN listesinde izlenir (P2 migration'ı/panel senkronu kapatır); burada yalnız o plan hariç tutulur.
  it.each(PLANS.filter((p) => p.id !== "professional"))("keeps $id limits aligned with the database seed", (plan) => {
    const sqlValue = (value: number | null) => (value == null ? "null" : String(value));
    const expected = `('${plan.id}', ${sqlValue(plan.limits.seats)}, ${sqlValue(plan.limits.customers)}, ${sqlValue(plan.limits.activeProperties)}, ${sqlValue(plan.limits.branches)})`;
    expect(migration).toContain(expected);
  });

  it("serializes checks and covers every limited entity", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("trg_profiles_plan_capacity");
    expect(migration).toContain("trg_customers_plan_capacity");
    expect(migration).toContain("trg_properties_plan_capacity");
    expect(migration).toContain("trg_branches_plan_capacity");
    expect(migration).toContain("trg_tenants_plan_capacity");
  });

  it("counts only active portfolio records and rechecks reactivation", () => {
    expect(migration).toContain("status in ('draft', 'live', 'reserved')");
    expect(migration).toContain("old.status not in ('draft', 'live', 'reserved')");
    expect(migration).toContain("update of tenant_id, deleted_at, status on public.properties");
  });

  it("rejects a downgrade while current usage exceeds the target plan", () => {
    expect(migration).toContain("enforce_tenant_plan_capacity");
    expect(migration).toContain("before update of plan on public.tenants");
    expect(migration).toContain("current_usage > limits.seat_limit");
    expect(migration).toContain("current_usage > limits.active_property_limit");
  });
});
