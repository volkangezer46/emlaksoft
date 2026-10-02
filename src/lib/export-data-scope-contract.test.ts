import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const source = read("src/app/actions/export.ts");

function exportFunction(name: string): string {
  const marker = `export async function ${name}`;
  const start = source.indexOf(marker);
  expect(start, `${name} export action should exist`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("\nexport async function ", start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

describe("CSV export tenant and actor scope contract", () => {
  it("puts an explicit tenant boundary on every Supabase table query", () => {
    const queryChains = [...source.matchAll(/\.from\("([^"]+)"\)([\s\S]*?);/g)];

    expect(queryChains).toHaveLength(19);
    for (const chain of queryChains) {
      expect(chain[0], `${chain[1]} query is missing an explicit tenant boundary`).toContain(
        '.eq("tenant_id", gate.tenantId)',
      );
    }
  });

  it.each([
    ["exportCustomersCsv", '.eq("assigned_to", gate.userId)'],
    ["exportCommissionsCsv", '.eq("deal.assigned_to", gate.userId)'],
    ["exportAuditCsv", '.eq("actor_id", gate.userId)'],
    ["exportPropertiesCsv", '.eq("assigned_to", gate.userId)'],
    ["exportExpensesCsv", '.eq("created_by", gate.userId)'],
    ["exportOffersCsv", '.eq("created_by", gate.userId)'],
    ["exportPortalListingsCsv", '.eq("property.assigned_to", gate.userId)'],
    ["exportDemandsCsv", '.eq("customer.assigned_to", gate.userId)'],
    ["exportAppointmentsCsv", '.eq("assigned_to", gate.userId)'],
    ["exportDealsCsv", '.eq("assigned_to", gate.userId)'],
    ["exportProjectsCsv", '.eq("created_by", gate.userId)'],
    ["exportRentalsCsv", '.eq("created_by", gate.userId)'],
    ["exportDuesCsv", '.eq("created_by", gate.userId)'],
    ["exportContractsCsv", '.eq("created_by", gate.userId)'],
    ["exportReferralsCsv", '.eq("handled_by", gate.userId)'],
  ])("keeps %s office-wide only unless the row belongs to the actor", (name, actorFilter) => {
    const action = exportFunction(name);
    expect(action).toContain("hasOfficeWideDataScope(gate.role)");
    expect(action).toContain(actorFilter);
  });

  it("uses inner parent joins when ownership only exists on the parent row", () => {
    const commissions = exportFunction("exportCommissionsCsv");
    expect(commissions).toMatch(/deal:deals(?:![a-z_]+)?!inner/);
    expect(commissions).toContain('.eq("deal.tenant_id", gate.tenantId)');

    const portals = exportFunction("exportPortalListingsCsv");
    expect(portals).toMatch(/property:properties(?:![a-z_]+)?!inner/);
    expect(portals).toContain('.eq("property.tenant_id", gate.tenantId)');

    const demands = exportFunction("exportDemandsCsv");
    expect(demands).toMatch(/customer:customers(?:![a-z_]+)?!inner/);
    expect(demands).toContain('.eq("customer.tenant_id", gate.tenantId)');

    const rentals = exportFunction("exportRentalsCsv");
    expect(rentals.match(/rental:rentals(?:![a-z_]+)?!inner/g)).toHaveLength(2);
    expect(rentals.match(/\.eq\("rental\.tenant_id", gate\.tenantId\)/g)).toHaveLength(2);
    expect(rentals).toContain('.eq("rental.created_by", gate.userId)');
  });

  it("uses only ownership columns declared by the migrations", () => {
    const init = read("supabase/migrations/20260721000000_init.sql");
    const appointments = read("supabase/migrations/20260721000004_appointments.sql");
    const features = read("supabase/migrations/20260723000031_features_6to10.sql");
    const contracts = read("supabase/migrations/20260723000029_contracts.sql");
    const dues = read("supabase/migrations/20260724000039_property_dues.sql");
    const rentals = read("supabase/migrations/20260726000074_rentals_module.sql");
    const projects = read("supabase/migrations/20260726000075_projects_module.sql");
    const referrals = read("supabase/migrations/20260727000111_referrals.sql");

    expect(init).toMatch(/create table if not exists public\.customers[\s\S]*?assigned_to uuid/);
    expect(init).toMatch(/create table if not exists public\.properties[\s\S]*?assigned_to uuid/);
    expect(init).toMatch(/create table if not exists public\.deals[\s\S]*?assigned_to uuid/);
    expect(init).toMatch(/create table if not exists public\.audit_logs[\s\S]*?actor_id uuid/);
    expect(appointments).toMatch(/create table if not exists public\.appointments[\s\S]*?assigned_to uuid/);
    expect(features).toMatch(/create table if not exists public\.expenses[\s\S]*?created_by\s+uuid/);
    expect(features).toMatch(/create table if not exists public\.offers[\s\S]*?created_by\s+uuid/);
    expect(contracts).toMatch(/create table if not exists public\.contracts[\s\S]*?created_by\s+uuid/);
    expect(dues).toMatch(/create table if not exists public\.property_dues[\s\S]*?created_by\s+uuid/);
    expect(rentals).toMatch(/create table if not exists public\.rentals[\s\S]*?created_by\s+uuid/);
    expect(projects).toMatch(/create table if not exists public\.projects[\s\S]*?created_by\s+uuid/);
    expect(referrals).toMatch(/create table if not exists public\.referrals[\s\S]*?handled_by\s+uuid/);
  });
});
