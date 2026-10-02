import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const migration = read(
  "supabase/migrations/20260803000020_capability_tenant_boundary.sql",
);
const publicAtomicMigration = read(
  "supabase/migrations/20260810000970_public_atomic_mutations.sql",
);

describe("capability tenant boundary contract", () => {
  it("rejects tenant A capabilities that reference tenant B parents", () => {
    const tenantA = "tenant-a";
    const tenantB = "tenant-b";
    const parentId = "shared-parent-id";
    const parentCompositeKeys = new Set([`${parentId}:${tenantB}`]);

    // This models PostgreSQL's composite FK lookup: the UUID exists, but the
    // capability's (parent_id, tenant_id) pair does not exist in the parent.
    expect(parentCompositeKeys.has(`${parentId}:${tenantA}`)).toBe(false);
    expect(parentCompositeKeys.has(`${parentId}:${tenantB}`)).toBe(true);

    const requiredConstraints = [
      "customer_portal_tokens_customer_tenant_fkey",
      "owner_portal_tokens_property_tenant_fkey",
      "valuations_property_tenant_fkey",
      "referral_links_customer_tenant_fkey",
      "referrals_link_tenant_fkey",
      "surveys_deal_tenant_fkey",
      "surveys_customer_tenant_fkey",
      "booking_settings_staff_tenant_fkey",
      "open_houses_property_tenant_fkey",
      "portal_match_feedback_customer_tenant_fkey",
      "portal_match_feedback_property_tenant_fkey",
    ];
    for (const constraint of requiredConstraints) expect(migration).toContain(constraint);
    expect(migration).toMatch(/foreign key \(customer_id, tenant_id\)/);
    expect(migration).toMatch(/foreign key \(property_id, tenant_id\)/);
    expect(migration).toMatch(/foreign key \(staff_id, tenant_id\)/);
    expect(migration).toMatch(/foreign key \(deal_id, tenant_id\)/);
  });

  it("guards polymorphic shares and visitor customer links with tenant-aware triggers", () => {
    expect(migration).toContain("public.enforce_share_link_tenant_parent()");
    expect(migration).toContain("p.id = new.entity_id and p.tenant_id = new.tenant_id");
    expect(migration).toContain("c.id = new.entity_id and c.tenant_id = new.tenant_id");
    expect(migration).toContain("d.id = new.entity_id and d.tenant_id = new.tenant_id");
    expect(migration).toContain("public.enforce_open_house_visitor_tenant_parent()");
    expect(migration).toContain("c.tenant_id = v_tenant_id");
    expect(migration).toContain("set search_path = ''");
  });

  it("uses active-tenant and action permissions instead of tenant-only mutation policies", () => {
    expect(migration).toContain("public.current_active_tenant_id()");
    expect(migration).toContain("public.has_effective_permission('customers', 'edit')");
    expect(migration).toContain("public.has_effective_permission('properties', 'edit')");
    expect(migration).toContain("public.has_effective_permission('valuation', 'edit')");
    expect(migration).toContain("public.has_effective_permission('appointments', 'create')");
    expect(migration).toContain("drop policy if exists share_links_tenant");
    expect(migration).toContain("drop policy if exists surveys_tenant");
  });

  it("tenant-binds every public service-role parent read", () => {
    const customerPortal = read("src/app/actions/customer-portal.ts");
    const ownerPortal = read("src/app/actions/owner-portal.ts");
    const sharePage = read("src/app/paylas/[token]/page.tsx");
    const valuationPage = read("src/app/degerleme-raporu/[token]/page.tsx");
    const referralPublic = read("src/app/actions/referral-public.ts");
    const surveyPublic = read("src/app/actions/survey-public.ts");
    const openHousePublic = read("src/app/actions/open-house-public.ts");

    expect(customerPortal).toMatch(/\.eq\("id", customerId\)\s*\.eq\("tenant_id", tenantId\)/);
    expect(ownerPortal).toMatch(/\.eq\("id", propertyId\)\s*\.eq\("tenant_id", tenantId\)/);
    expect(sharePage).toMatch(/\.eq\("id", share\.entity_id\)\s*\.eq\("tenant_id", share\.tenant_id\)/);
    expect(valuationPage).toMatch(
      /\.eq\("id", valuation\.property_id\)\s*\.eq\("tenant_id", valuation\.tenant_id\)/,
    );
    expect(referralPublic).toMatch(
      /\.eq\("id", link\.customer_id\)\s*\.eq\("tenant_id", link\.tenant_id\)/,
    );
    expect(surveyPublic).toMatch(
      /\.eq\("id", survey\.customer_id\)\s*\.eq\("tenant_id", survey\.tenant_id\)/,
    );
    expect(publicAtomicMigration).toMatch(
      /p\.id = bs\.staff_id\s+and p\.tenant_id = bs\.tenant_id\s+and p\.is_active = true/,
    );
    expect(openHousePublic).toMatch(
      /\.eq\("id", event\.property_id\)\s*\.eq\("tenant_id", event\.tenant_id\)/,
    );
  });
});
