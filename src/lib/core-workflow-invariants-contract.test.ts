import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260813000000_core_workflow_invariants.sql");
const scaffold = read("supabase/migrations/20260812000000_core_workflow_scaffold.sql");
const preflight = read("src/lib/core-workflow-preflight.ts");
const migrationRunner = read("scripts/apply-migrations.ts");
const workflowRunbook = read("docs/runbooks/CORE_WORKFLOW_RECONCILIATION.md");
const offers = read("src/app/actions/offers.ts");
const deals = read("src/app/actions/deals.ts");
const rentals = read("src/app/actions/rentals.ts");
const projects = read("src/app/actions/projects.ts");
const contracts = read("src/app/actions/contracts.ts");
const contractPage = read("src/app/app/sozlesmeler/[id]/page.tsx");
const portalListings = read("src/app/actions/portal-listings.ts");
const paymentLinks = read("src/app/actions/payment-links.ts");
const properties = read("src/app/actions/properties.ts");
const bulkProperties = read("src/app/actions/bulk-property.ts");
const propertyManagement = read("src/app/actions/property-management.ts");
const automationEngine = read("src/lib/automation-engine.ts");

describe("core workflow invariant contract", () => {
  it("drains concurrent ledger writers before any cut-over work", () => {
    const lock = migration.indexOf("lock table\n  public.commissions");
    expect(lock).toBeGreaterThan(-1);
    for (const table of [
      "public.commissions",
      "public.customers",
      "public.deals",
      "public.offer_rounds",
      "public.offers",
      "public.project_units",
      "public.properties",
      "public.rentals",
    ]) expect(migration.slice(lock, migration.indexOf("in share row exclusive mode;", lock))).toContain(table);
    expect(migration).toContain("in share row exclusive mode;");
    for (const later of [
      "create unique index if not exists uq_rentals_tenant_deal",
      "create or replace function public.send_contract_for_signing_atomic",
      "insert into public.offer_rounds",
      "create or replace function public.guard_commission_atomic_ledger",
    ]) expect(lock).toBeLessThan(migration.indexOf(later));
  });

  it("keeps every multi-row workflow service-only, locked and tenant scoped", () => {
    for (const fn of [
      "send_contract_for_signing_atomic",
      "sign_contract_atomic",
      "cancel_contract_atomic",
      "update_contract_draft_atomic",
      "store_contract_signer_otp_atomic",
      "create_offer_atomic",
      "transition_offer_atomic",
      "add_offer_round_atomic",
      "update_offer_terms_atomic",
      "convert_offer_to_deal_atomic",
      "transition_deal_stage_atomic",
      "create_rental_atomic",
      "end_rental_atomic",
      "sell_project_unit_atomic",
      "close_portal_listing_atomic",
      "convert_open_house_visitor_atomic",
      "transition_property_status_atomic",
    ]) {
      expect(migration).toContain(`create or replace function public.${fn}(`);
    }
    expect(migration.match(/Service role required\./g)?.length).toBeGreaterThanOrEqual(17);
    expect(migration).toContain("set search_path = public, pg_temp");
    expect(migration).toContain("for update;");
    expect(migration).toContain("p_expected_stage");
  });

  it("makes offer rounds precise, immutable and the canonical accepted value", () => {
    expect(migration).toContain("p_amount < 0.01");
    expect(migration).toContain("round(p_amount, 2) <> p_amount");
    expect(migration).toContain("when v_target = 'accepted' and v_offer.status::text = 'countered'");
    expect(migration).toContain("then v_offer.counter_amount");
    expect(migration).toContain("'offer.round'");
    expect(migration).toContain("revoke insert, update, delete on public.offer_rounds from authenticated");
    expect(offers).toContain('admin.rpc("update_offer_terms_atomic"');
    expect(offers).toContain('requirePermission("offers", "edit")');
    expect(offers).toContain('requirePermission("commissions", "create")');
  });

  it("ties won deals, commissions, leases and project stock to atomic ledgers", () => {
    expect(scaffold).toContain("closure_active boolean not null default false");
    expect(scaffold).toContain("rentals_deal_tenant_fkey");
    expect(scaffold).not.toContain("create trigger");
    expect(migration).toContain("uq_deals_tenant_property_won");
    expect(migration).toContain("uq_rentals_tenant_property_active");
    expect(scaffold).toContain("rentals_deal_tenant_fkey");
    expect(migration).toContain("project_unit_id");
    expect(migration).toContain("project_units_guard_sale_state");
    expect(migration).toContain("Won deal business fields are immutable outside the atomic workflow.");
    expect(migration).toContain("before insert or update of status, sold_at, tenant_id, project_id, customer_id, list_price");
    expect(migration).toContain("billing_payment_captures");
    expect(migration).toContain("'payment_in_progress'");
    expect(deals).toContain('requirePermission("commissions", "create")');
    expect(deals).toContain('requirePermission("commissions", "delete")');
    expect(deals).toContain('outcome === "payment_in_progress"');
    expect(deals).toContain('outcome === "rental_lifecycle_required"');
    expect(rentals).toContain('requirePermission("commissions", "create")');
    expect(rentals.match(/const admin = createAdminClient\(\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(projects).toContain('admin.rpc("sell_project_unit_atomic"');
    expect(projects).not.toContain("recordProjectSaleDeal");
  });

  it("stages the production cut-over behind an aggregate-only reconciliation gate", () => {
    expect(preflight).toContain("duplicate_projected_closure_groups");
    expect(preflight).toContain("duplicate_active_rental_groups");
    expect(preflight).toContain("offer_round_projection_mismatch");
    expect(preflight).toContain("countered_offer_missing_history");
    expect(preflight).toContain("project_unit_deal_mismatch");
    expect(preflight).toContain("o.counter_amount < 0.01");
    expect(preflight).toContain("r.amount > 100000000000");
    expect(preflight).toContain('"non_won_commission"');
    expect(preflight).not.toMatch(/select\s+(?:d|r|o|u)\.id\s+from/i);
    expect(migration).toContain("Core workflow reconciliation required:");
    expect(migration).toContain("countered_offer_history=%s");
    expect(migration).toContain("project_unit_deal=%s");
    expect(migration).toContain("o.counter_amount < 0.01");
    expect(migration).toContain("coalesce(o.submitted_at, o.created_at)");
    expect(migrationRunner).toContain("stoppedAtCoreWorkflowScaffold = true");
    expect(migrationRunner).toContain("CORE_WORKFLOW_PREFLIGHT_SQL");
    expect(workflowRunbook).toContain("non_won_commission");
    expect(workflowRunbook).toContain("project_unit_deal_mismatch");
    expect(workflowRunbook).toContain("countered_offer_missing_history");
    expect(workflowRunbook).toContain("blocker toplamı: `26`");
    expect(workflowRunbook).toContain("Müşteri, tutar, komisyon oranı");
  });

  it("blocks direct terminal and secret-bearing table mutations", () => {
    for (const sql of [
      "revoke all privileges on public.contract_signers from authenticated",
      "revoke insert, update, delete on public.payment_links from authenticated",
      "revoke insert, update, delete on public.listing_closures from authenticated",
      "revoke insert, update, delete on public.contract_versions from authenticated",
      "revoke insert, update, delete on public.property_status_history from authenticated",
      "revoke insert, update, delete on public.portal_listings from authenticated",
      "revoke update on public.rentals from authenticated",
      "revoke insert, delete on public.commissions from authenticated",
    ]) expect(migration).toContain(sql);
    expect(migration).toContain("properties_guard_terminal_status");
    expect(migration).toContain("contracts_guard_atomic_lifecycle");
    expect(migration).toContain("offers_guard_atomic_state");
    expect(migration).toContain("open_house_visitors_guard_customer");
    expect(migration).toContain("commissions_guard_atomic_ledger");
    expect(migration).toContain("Commission identity and financial totals are immutable outside the atomic workflow.");
    expect(migration).toContain("new.created_customer_id is not null");
    expect(paymentLinks).toContain('admin.from("payment_links").insert');
    expect(portalListings).toContain('admin.from("portal_listings").insert');
    expect(rentals).toContain('.eq("monthly_rent", rental.monthly_rent)');
  });

  it("keeps signer bearer tokens behind an edit-authorized server projection", () => {
    expect(contractPage).toContain("const canEdit = perms.contracts?.includes(\"edit\")");
    expect(contractPage).toContain("const admin = createAdminClient()");
    expect(contractPage).toContain("const signerQuery = canEdit");
    expect(contractPage).toContain("canEdit && s.status === \"pending\"");
    expect(contractPage).not.toContain("signers:contract_signers");
    expect(contracts).toContain('admin.rpc("store_contract_signer_otp_atomic"');
    // %rowtype değişkenler çok öğeli INTO listesinde kullanılamaz: sözleşme satırı ve tenant durumu ayrı okunur.
    expect(migration).toContain("select c.* into v_contract");
    expect(migration).toContain("select t.status::text into v_tenant_status from public.tenants t where t.id = v_contract.tenant_id;");
    expect(migration).not.toMatch(/into v_contract,\s*v_tenant_status/);
    expect(migration).toContain("^hmac-sha256-v1:[0-9a-f]{64}$");
    expect(migration).not.toMatch(/grant select[\s\S]{0,300}on public\.contract_signers to authenticated/);
  });

  it("records property status history in the database and rejects manual terminal reopen", () => {
    expect(migration).toContain("properties_record_status_history");
    expect(migration).toContain("terminal_requires_workflow");
    expect(migration).toContain("commission_rate_required");
    expect(properties).toContain('admin.rpc("transition_property_status_atomic"');
    expect(bulkProperties).toContain('admin.rpc("transition_property_status_atomic"');
    expect(propertyManagement).toContain('admin.rpc("transition_property_status_atomic"');
    expect(bulkProperties).not.toContain('from("property_status_history").insert');
  });

  it("never lets an automation make a terminal financial decision", () => {
    expect(automationEngine).toContain('detail: "deal_stage_requires_human"');
    const changeStatus = automationEngine.slice(
      automationEngine.indexOf('case "change_status"'),
      automationEngine.indexOf("default:", automationEngine.indexOf('case "change_status"')),
    );
    expect(changeStatus).not.toContain('.from("deals")');
  });
});
