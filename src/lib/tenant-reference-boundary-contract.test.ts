import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const migrationName = "20260809000010_core_tenant_relationship_boundaries.sql";
const migration = read(`supabase/migrations/${migrationName}`);

describe("core tenant relationship boundary contract", () => {
  it.each([
    "src/app/actions/appointments.ts",
    "src/app/actions/offers.ts",
    "src/app/actions/tasks.ts",
    "src/app/actions/contracts.ts",
  ])("validates caller-selected parents in %s", (file) => {
    const source = read(file);
    expect(source).toContain('from "@/lib/tenant-references"');
    expect(source).toContain("await validateTenantReferences(gate.tenantId");
  });

  it("installs and validates composite tenant foreign keys", () => {
    for (const table of ["appointments", "offers", "tasks", "contracts"]) {
      expect(migration).toContain(`alter table public.${table}`);
      expect(migration).toMatch(
        new RegExp(`alter table public\\.${table} validate constraint`),
      );
    }
    expect(migration).toContain("foreign key (customer_id, tenant_id)");
    expect(migration).toContain("foreign key (property_id, tenant_id)");
    expect(migration).toContain("foreign key (assigned_to, tenant_id)");
    expect(migration).toContain("foreign key (created_by, tenant_id)");
    expect(migration).toContain("foreign key (deal_id, tenant_id)");
    expect(migration).toContain("not valid;");
  });

  it("preserves parent delete semantics without nulling tenant_id", () => {
    const compact = migration.replace(/\s+/g, " ").toLowerCase();
    const expected = [
      ["appointments_customer_tenant_fkey", "on delete set null (customer_id)"],
      ["appointments_property_tenant_fkey", "on delete set null (property_id)"],
      ["offers_property_tenant_fkey", "on delete cascade"],
      ["offers_customer_tenant_fkey", "on delete set null (customer_id)"],
      ["offers_creator_tenant_fkey", "on delete set null (created_by)"],
      ["offers_deal_tenant_fkey", "on delete set null (deal_id)"],
      ["tasks_customer_tenant_fkey", "on delete set null (customer_id)"],
      ["tasks_property_tenant_fkey", "on delete set null (property_id)"],
      ["tasks_deal_tenant_fkey", "on delete set null (deal_id)"],
      ["contracts_creator_tenant_fkey", "on delete set null (created_by)"],
      ["contracts_property_tenant_fkey", "on delete set null (property_id)"],
      ["contracts_customer_tenant_fkey", "on delete set null (customer_id)"],
    ] as const;

    for (const [constraint, action] of expected) {
      const start = compact.indexOf(`add constraint ${constraint}`);
      expect(start, constraint).toBeGreaterThan(-1);
      const end = compact.indexOf("not valid;", start);
      expect(compact.slice(start, end), constraint).toContain(action);
    }
    expect(compact).not.toContain("on delete set null (tenant_id)");

    // Deliberate NO ACTION relationships retain their previous blocking
    // semantics: assignments/creators are not silently detached.
    for (const constraint of [
      "appointments_assignee_tenant_fkey",
      "appointments_creator_tenant_fkey",
      "tasks_assignee_tenant_fkey",
      "tasks_creator_tenant_fkey",
    ]) {
      const start = compact.indexOf(`add constraint ${constraint}`);
      const end = compact.indexOf("not valid;", start);
      expect(compact.slice(start, end), constraint).not.toContain("on delete");
    }
  });

  it("runs after billing fulfillment hardening and before reconciliation", () => {
    const files = readdirSync(resolve(process.cwd(), "supabase/migrations"))
      .filter((file) => file.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b, "en"));
    expect(files.indexOf(migrationName)).toBeGreaterThan(
      files.indexOf("20260809000000_billing_fulfillment_hardening.sql"),
    );
    expect(files.indexOf(migrationName)).toBeLessThan(
      files.indexOf("20260810000100_billing_checkout_reconciliation.sql"),
    );
  });
});
