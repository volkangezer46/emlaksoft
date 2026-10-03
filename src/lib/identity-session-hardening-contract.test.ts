import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read(
  "supabase/migrations/20260802000300_identity_session_authorization_hardening.sql",
);
const twoFactor = read("src/lib/two-factor.ts");
const team = read("src/app/actions/team.ts");
const platform = read("src/app/actions/platform.ts");
const auth = read("src/app/actions/auth.ts");
const verification = read("src/app/giris/dogrulama/actions.ts");
const permissionGate = read("src/lib/require-permission.ts");
const registrationForm = read("src/app/kayit/register-form.tsx");
const platformIdentity = read("src/lib/platform.ts");
const effectivePermissions = read("src/lib/permissions-effective.ts");
const tenantGuard = read("src/lib/tenant-guard.ts");
const modulePageGate = read("src/lib/require-module-page.ts");
const appLayout = read("src/app/app/layout.tsx");
const authMiddleware = read("src/lib/supabase/middleware.ts");
const platformMfaPage = read("src/app/giris/mfa/page.tsx");
const platformMfaForm = read("src/app/giris/mfa/platform-mfa-form.tsx");

describe("identity and session hardening contract", () => {
  it("uses a dedicated, time/session/version-bound 2FA proof", () => {
    expect(twoFactor).toContain("TWO_FACTOR_COOKIE_SECRET");
    expect(twoFactor).toContain("sessionId");
    expect(twoFactor).toContain("profileVersion");
    expect(twoFactor).toContain("payload.exp > current");
    expect(twoFactor).not.toContain("SUPABASE_SERVICE_ROLE_KEY ??");
    expect(twoFactor).not.toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY ??");
    expect(verification).toContain('from("two_factor_verified_sessions").upsert');
    expect(auth).toContain('from("two_factor_verified_sessions")');
    expect(migration).toContain("public.current_session_two_factor_satisfied()");
    expect(migration).toContain("v.session_id = nullif(btrim(auth.jwt() ->> 'session_id'), '')");
    expect(migration).toContain("v.profile_version = p.two_factor_version");
  });

  it("banishes inactive members and revokes their database sessions", () => {
    expect(team).toContain('ban_duration: nextActive ? ("none" as const) : "876000h"');
    expect(team).toContain('admin.rpc("revoke_team_member_sessions"');
    expect(migration).toContain("delete from auth.sessions where user_id = p_user_id");
    expect(migration).toContain("Service role required.");
    expect(read("src/lib/team/assignable-roles.ts")).toContain("ROLES_BY_MANAGER");
    expect(team).toContain("canManageRole(actorRole, target.role as Role)");
    expect(team).toContain("ensureBranchBelongsToTenant");
  });

  it("never reactivates an existing platform staff identity from the env allowlist", () => {
    expect(platformIdentity).toContain("if (existing) return existing.is_active");
    expect(platformIdentity).toMatch(/\.from\("platform_staff"\)\s*\.insert\(/);
    expect(platformIdentity).not.toContain(".upsert(");
    expect(platformIdentity).toContain("user.app_metadata?.impersonating === true");
    expect(platformIdentity).toContain("getPlatformStaffIdentity");
  });

  it("requires a Supabase AAL2 authenticator session for every platform identity", () => {
    expect(platformIdentity).toContain("getPlatformMfaCandidate");
    expect(platformIdentity).toContain("getAuthenticatorAssuranceLevel");
    expect(platformIdentity).toContain('data.currentLevel !== "aal2"');
    expect(auth).toContain("/giris/mfa?next=");
    expect(authMiddleware).toContain('claimsData?.claims?.aal !== "aal2"');
    expect(platformMfaPage).toContain('assurance.currentLevel === "aal2"');
    expect(platformMfaForm).toContain("supabase.auth.mfa.enroll");
    expect(platformMfaForm).toContain("supabase.auth.mfa.challenge");
    expect(platformMfaForm).toContain("supabase.auth.mfa.verify");
  });

  it("restores impersonation from a session-bound server snapshot", () => {
    expect(platform).toContain('from("platform_impersonation_sessions")');
    expect(platform).toContain('new Set(["super_admin", "ops", "support"])');
    expect(platform).toContain("if (!IMPERSONATION_ROLES.has(staff.role)) return");
    expect(platform).toContain("snapshot.auth_session_id !== sessionId");
    expect(platform).toContain("restoreImpersonationMetadata");
    expect(migration).toContain("original_app_metadata jsonb not null");
    expect(migration).toContain("pis.auth_session_id = nullif(btrim(auth.jwt() ->> 'session_id'), '')");
    expect(migration).toContain("pis.target_tenant_id = t.id");
    expect(migration).toContain("revoke all privileges on table public.platform_impersonation_sessions");
    expect(platform).not.toContain("cookieTenantId");
    expect(platform).toContain('tenantId = typeof meta.tenant_id === "string"');

    const stopStart = platform.indexOf("export async function stopImpersonation");
    const trustedTarget = platform.indexOf("tenantId = snapshot.target_tenant_id", stopStart);
    const refreshed = platform.indexOf("await supabase.auth.refreshSession()", stopStart);
    const stopAudit = platform.indexOf('action: "ops.impersonate.stop"', stopStart);
    expect(trustedTarget).toBeGreaterThan(stopStart);
    expect(refreshed).toBeGreaterThan(trustedTarget);
    expect(stopAudit).toBeGreaterThan(refreshed);
  });

  it("enforces canonical active tenants and action permissions in RLS", () => {
    expect(migration).toContain("public.current_active_tenant_id()");
    expect(migration).toContain("t.status not in ('suspended', 'cancelled')");
    expect(migration).toContain("public.has_effective_permission(%L, ''delete'')");
    expect(migration).toContain("Identity fields require the trusted server workflow.");
    expect(migration).toContain("new.branch_id is distinct from old.branch_id");
    expect(migration).toContain("select public.current_active_tenant_id();");
    expect(migration).toContain("from public.platform_staff ps");
    expect(migration).toContain("revoke all privileges on function public.is_platform_staff()");
    expect(migration).toContain("to anon, authenticated, service_role;");
    expect(migration).toContain("auth.jwt() -> 'app_metadata' ->> 'impersonating'");
    expect(migration).toContain("Tenant lifecycle fields require the trusted server workflow.");
    expect(migration).toContain("new.plan is distinct from old.plan");
    expect(migration).toContain("p.is_active = true");
    expect(migration).toContain("grant select on table public.permission_defaults");
    expect(migration).toContain("block_readonly_identity_writes");
    expect(migration).toContain("c.relkind in ('r', 'p')");
    expect(migration).toContain("pg_catalog.pg_extension");
    expect(migration).toContain("d.deptype = 'e'");
    expect(migration).toContain("or public.current_profile_role() = 'readonly'");
    expect(migration).toContain("or auth.jwt() -> 'app_metadata' ->> 'role' = 'readonly'");
    expect(migration).toContain("and p.role = 'readonly'");
    expect(migration).toContain("Readonly identities cannot mutate application data.");
    expect(migration).toContain("profiles_branch_tenant_fkey");
    expect(migration).toContain("appointments_branch_tenant_fkey");
    expect(migration).toContain("foreign key (branch_id, tenant_id)");
    expect(migration).toContain("user_permission_overrides_user_tenant_fkey");
    expect(migration).toContain("foreign key (user_id, tenant_id)");
    expect(permissionGate).toContain("getEffectivePermissions(gate.tenantId, role, gate.userId)");
    expect(permissionGate).toContain("gate.impersonating");
    expect(permissionGate).toContain("immutableReadonlyPermissions()");
    expect(tenantGuard).toContain("impersonating: boolean");
    expect(modulePageGate).toContain("immutableReadonlyPermissions()");
    expect(appLayout).toContain("immutableReadonlyPermissions()");
    expect(effectivePermissions).toContain('if (r === "readonly") return immutableReadonlyPermissions()');
    expect(permissionGate).not.toContain("getPlatformStaff");
    expect(effectivePermissions).toContain("roleOverrideResult.error || userOverrideResult.error");
    expect(effectivePermissions).toContain('"getEffectivePermissions query"');

    const readonlyCeilingStart = migration.indexOf(
      "when public.current_profile_role() = 'readonly'",
    );
    const readonlyCeilingEnd = migration.indexOf("else coalesce(", readonlyCeilingStart);
    const readonlyCeiling = migration.slice(readonlyCeilingStart, readonlyCeilingEnd);
    expect(readonlyCeilingStart).toBeGreaterThan(-1);
    expect(readonlyCeilingEnd).toBeGreaterThan(readonlyCeilingStart);
    expect(readonlyCeiling).toContain("p_action = 'view'");
    expect(readonlyCeiling).toContain("where pd.role = 'readonly'");
    expect(readonlyCeiling).not.toContain("user_permission_overrides");
    expect(readonlyCeiling).not.toContain("tenant_role_permissions");
  });

  it("updates platform billing, subscription, audit and public caches as one contract", () => {
    expect(platform).toContain('requirePlatformModule("billing")');
    expect(platform).toContain('admin.rpc("update_tenant_plan_subscription"');
    expect(platform).toContain("p_actor_id: staff.id");
    expect(platform).not.toContain('.from("tenants").update(patch)');
    expect(migration).toContain("public.update_tenant_plan_subscription(");
    expect(migration).toContain("ps.role in ('super_admin', 'billing')");
    expect(migration).toContain("insert into public.audit_logs");
    expect(migration).toContain("'monthly_amount_try', v_amount_try");
    expect(migration).toContain("to service_role;");
    expect(platform).toContain('revalidatePath("/vitrin/[slug]", "page")');
    expect(platform).toContain('revalidatePath("/danisman/[slug]", "page")');
    expect(platform).toContain('revalidatePath("/sitemap.xml")');
  });

  it("preserves allowlisted pricing choices during registration", () => {
    expect(auth).toContain("registrationPlanForTeamSize(requestedPlan, teamSize)");
    expect(auth).toContain("normalizeBillingCycle(requestedCycle)");
    expect(auth).toContain('"provision_registration"');
    expect(auth).toContain("p_billing_cycle: billingCycle");
    expect(auth).toContain("p_terms_version: REGISTRATION_TERMS_VERSION");
    expect(auth).toContain("admin.auth.admin.deleteUser(created.user.id)");
    expect(auth).not.toContain('.from("subscriptions").insert');
    expect(migration).toContain("sync_inserted_profile_auth_identity");
    expect(registrationForm).toContain('name="legal_consent"');
    expect(auth).toContain("bootstrapPlatformStaffIfAllowed");
    expect(auth).toMatch(/checkRateLimit\([\s\S]*?`signin:[\s\S]*?failurePolicy: "deny"/);
    expect(auth).toMatch(/checkRateLimit\(`2fa-send:[\s\S]*?failurePolicy: "deny"/);
    expect(auth).toMatch(/checkRateLimit\(`signup:[\s\S]*?failurePolicy: "deny"/);
    expect(verification).toMatch(/checkRateLimit\(`2fa-verify:[\s\S]*?failurePolicy: "deny"/);
    expect(verification).toMatch(/checkRateLimit\(`2fa-send:[\s\S]*?failurePolicy: "deny"/);
  });
});
