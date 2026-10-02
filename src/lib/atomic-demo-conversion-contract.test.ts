import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const action = read("src/app/actions/platform-sales.ts");
const migration = read(
  "supabase/migrations/20260802000400_atomic_demo_conversion.sql",
);
const identityMigration = read(
  "supabase/migrations/20260802000300_identity_session_authorization_hardening.sql",
);
const demoCard = read("src/app/admin/satis/demo-card.tsx");
const conversionStart = action.indexOf("export async function convertDemoToTenant");
const conversionAction = action.slice(conversionStart);

describe("atomic demo conversion contract", () => {
  it("creates the pending Auth identity before one atomic provisioning RPC", () => {
    expect(conversionStart).toBeGreaterThan(-1);
    expect(conversionAction).toContain('requirePlatformModule("sales")');
    expect(conversionAction).toContain("admin.auth.admin.createUser");
    expect(conversionAction).toContain('app_metadata: { role: "owner", account_active: true }');
    expect(conversionAction).toMatch(
      /admin\.rpc\(\s*["']convert_demo_request_to_tenant["']/,
    );
    expect(conversionAction).toContain("p_owner_user_id: ownerUserId");
    expect(conversionAction).toContain("p_actor_id: staff.id");
    expect(conversionAction.indexOf("admin.auth.admin.createUser")).toBeLessThan(
      conversionAction.indexOf('"convert_demo_request_to_tenant"'),
    );
    expect(conversionAction).toContain("admin.auth.admin.deleteUser(ownerUserId)");
    expect(conversionAction).toContain('recovery.state === "committed"');
    expect(conversionAction).toContain('recovery.state === "not_committed"');
    expect(conversionAction).not.toContain('.from("tenants").insert');
    expect(conversionAction).not.toContain('.from("profiles").insert');
    expect(conversionAction).not.toContain('.from("subscriptions").insert');
    expect(conversionAction).not.toContain('.from("demo_requests").update');
    expect(conversionAction).not.toContain('.from("audit_logs").insert');
  });

  it("keeps the bootstrap credential strong and never exposes it to platform staff", () => {
    expect(action).toContain('import { randomInt } from "node:crypto"');
    expect(action).toContain("groups.map((group) => group[randomInt(group.length)]!)");
    expect(action).toContain("while (chars.length < 18)");
    expect(action).not.toContain("Math.random");
    expect(conversionAction).toContain("sendOwnerAccessLink(admin, conversion.email)");
    expect(conversionAction).toContain("accessLinkSent");
    const publicResultStart = conversionAction.indexOf("const accessLinkSent");
    const publicResultEnd = conversionAction.indexOf(
      "export async function resendConvertedOwnerAccessLink",
      publicResultStart,
    );
    expect(publicResultStart).toBeGreaterThan(-1);
    expect(conversionAction.slice(publicResultStart, publicResultEnd)).not.toContain("tempPassword,");
    expect(demoCard).not.toContain("tempPassword");
  });

  it("locks the demo and authorizes only active sales-capable platform staff", () => {
    expect(migration).toContain("public.convert_demo_request_to_tenant(");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("auth.role() is distinct from 'service_role'");
    expect(migration).toContain("ps.is_active = true");
    expect(migration).toContain("ps.role in ('super_admin', 'ops', 'support')");
    expect(migration).toContain("from public.demo_requests d");
    expect(migration).toContain("for update;");
    expect(migration).toContain("if v_demo.converted_tenant_id is not null then");
    expect(migration.indexOf("for update;")).toBeLessThan(
      migration.indexOf("if v_demo.converted_tenant_id is not null then"),
    );
  });

  it("writes every business record and both audits in the RPC transaction", () => {
    expect(migration).toContain("insert into public.tenants (");
    expect(migration).toContain("insert into public.profiles (");
    expect(migration).toContain("insert into public.subscriptions (");
    expect(migration).toContain("update public.demo_requests");
    expect(migration).toContain("and converted_tenant_id is null");
    expect(migration).toContain("insert into public.audit_logs (");
    expect(migration).toContain("insert into public.platform_audit_logs (");
    expect(migration).toContain("if v_profile_id is null");
    expect(migration).toContain("or v_subscription_id is null");
    expect(migration).toContain("or v_tenant_audit_id is null");
    expect(migration).toContain("or v_platform_audit_id is null");
  });

  it("uses canonical monthly prices and verifies synchronized owner claims", () => {
    expect(migration).toContain("when 'advisor' then 990");
    expect(migration).toContain("when 'office' then 2490");
    expect(migration).toContain("when 'professional' then 5990");
    expect(migration).toContain("when 'enterprise' then 12900");
    expect(migration).toContain("'monthly'");
    expect(migration).toContain("'TRY'");
    expect(migration).toContain("v_auth_email is distinct from v_email");
    expect(migration).toContain("Pending Auth owner identity mismatch.");
    expect(migration).toContain("Owner Auth identity synchronization failed.");
    expect(migration).toContain("v_auth_app_meta ->> 'tenant_id'");
    expect(identityMigration).toContain("trg_profiles_sync_auth_identity_insert");
    expect(identityMigration).toContain("sync_inserted_profile_auth_identity");
  });

  it("exposes the function only to service_role", () => {
    expect(migration).toContain(
      "revoke all privileges on function public.convert_demo_request_to_tenant(uuid, uuid, uuid, text)",
    );
    expect(migration).toContain("from public, anon, authenticated, service_role;");
    expect(migration).toContain(
      "grant execute on function public.convert_demo_request_to_tenant(uuid, uuid, uuid, text)",
    );
    expect(migration).toContain("to service_role;");
  });
});
