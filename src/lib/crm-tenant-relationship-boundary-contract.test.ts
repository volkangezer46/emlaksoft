import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "20260809000020_crm_tenant_relationship_boundaries.sql";
const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations", migrationName),
  "utf8",
);
const compact = migration.replace(/\s+/g, " ").toLowerCase();

const cascadeConstraints = [
  "customer_demands_customer_tenant_fkey",
  "portal_listings_property_tenant_fkey",
  "listing_closures_listing_tenant_fkey",
  "commissions_deal_tenant_fkey",
  "iys_consents_customer_tenant_fkey",
  "communications_customer_tenant_fkey",
  "targets_profile_tenant_fkey",
  "automation_logs_automation_tenant_fkey",
  "property_price_history_property_tenant_fkey",
  "property_status_history_property_tenant_fkey",
  "offer_rounds_offer_tenant_fkey",
  "deal_costs_deal_tenant_fkey",
  "deal_notes_deal_tenant_fkey",
  "deal_checklist_items_deal_tenant_fkey",
  "rentals_property_tenant_fkey",
  "rentals_renter_tenant_fkey",
  "rent_charges_rental_tenant_fkey",
  "maintenance_requests_rental_tenant_fkey",
  "project_units_project_tenant_fkey",
  "unit_payments_unit_tenant_fkey",
  "property_keys_property_tenant_fkey",
  "property_key_events_key_tenant_fkey",
  "agent_badges_staff_tenant_fkey",
  "agent_score_snapshots_staff_tenant_fkey",
  "approval_comments_request_tenant_fkey",
  "listing_views_property_tenant_fkey",
  "lost_sale_dismissals_customer_tenant_fkey",
  "playbook_steps_playbook_tenant_fkey",
  "playbook_runs_playbook_tenant_fkey",
  "saved_views_user_tenant_fkey",
  "staff_leaves_staff_tenant_fkey",
  "tenant_advisor_sessions_user_tenant_fkey",
  "vitrin_price_alerts_property_tenant_fkey",
] as const;

const noActionConstraints = [
  "customers_assignee_tenant_fkey",
  "customers_creator_tenant_fkey",
  "properties_assignee_tenant_fkey",
  "properties_source_agent_tenant_fkey",
  "properties_creator_tenant_fkey",
  "portal_listings_publisher_tenant_fkey",
  "listing_closures_creator_tenant_fkey",
  "deals_property_tenant_fkey",
  "deals_customer_tenant_fkey",
  "deals_assignee_tenant_fkey",
  "calls_customer_tenant_fkey",
  "calls_handler_tenant_fkey",
  "presentations_creator_tenant_fkey",
  "lost_sale_dismissals_creator_tenant_fkey",
  "tenant_role_permissions_updater_tenant_fkey",
] as const;

function constraintBlock(constraint: string) {
  const start = compact.indexOf(`add constraint ${constraint}`);
  expect(start, constraint).toBeGreaterThan(-1);
  const end = compact.indexOf("not valid;", start);
  expect(end, constraint).toBeGreaterThan(start);
  return compact.slice(start, end);
}

describe("CRM tenant relationship boundary contract", () => {
  it("declares and validates every static tenant relationship", () => {
    const added = [
      ...migration.matchAll(/add constraint ([a-z0-9_]+_tenant_fkey)/gi),
    ].map((match) => match[1].toLowerCase());
    const validated = [
      ...migration.matchAll(/validate constraint ([a-z0-9_]+_tenant_fkey)/gi),
    ].map((match) => match[1].toLowerCase());

    expect(added).toHaveLength(81);
    expect(new Set(added).size).toBe(81);
    expect(new Set(validated)).toEqual(new Set(added));
    expect(compact).not.toContain("execute format");
    expect(compact).not.toMatch(/\bfor\s+\w+\s+in\b/);

    for (const constraint of added) {
      const block = constraintBlock(constraint);
      expect(block, constraint).toMatch(
        /foreign key \([a-z0-9_]+, tenant_id\) references public\.[a-z0-9_]+\(id, tenant_id\)/,
      );
    }
  });

  it("creates an explicit composite unique key for every parent table", () => {
    for (const table of [
      "profiles",
      "customers",
      "properties",
      "deals",
      "portal_listings",
      "offers",
      "automations",
      "tasks",
      "rentals",
      "projects",
      "project_units",
      "property_keys",
      "approval_requests",
      "playbooks",
    ]) {
      expect(compact).toContain(`on public.${table}(id, tenant_id);`);
    }
  });

  it("preserves CASCADE, SET NULL and NO ACTION semantics", () => {
    for (const constraint of cascadeConstraints) {
      expect(constraintBlock(constraint), constraint).toContain("on delete cascade");
    }

    const setNullMatches = [
      ...compact.matchAll(
        /add constraint ([a-z0-9_]+_tenant_fkey) foreign key \(([a-z0-9_]+), tenant_id\) references public\.[a-z0-9_]+\(id, tenant_id\) on delete set null \(([a-z0-9_]+)\) not valid;/g,
      ),
    ];
    expect(setNullMatches).toHaveLength(33);
    for (const match of setNullMatches) {
      expect(match[3], match[1]).toBe(match[2]);
    }
    expect(compact).not.toContain("on delete set null (tenant_id)");

    for (const constraint of noActionConstraints) {
      expect(constraintBlock(constraint), constraint).not.toContain("on delete");
    }
  });

  it("runs after the focused core boundary and before billing reconciliation", () => {
    const files = readdirSync(resolve(process.cwd(), "supabase/migrations"))
      .filter((file) => file.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b, "en"));

    expect(files.indexOf(migrationName)).toBeGreaterThan(
      files.indexOf("20260809000010_core_tenant_relationship_boundaries.sql"),
    );
    expect(files.indexOf(migrationName)).toBeLessThan(
      files.indexOf("20260810000100_billing_checkout_reconciliation.sql"),
    );
  });
});
