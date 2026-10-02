import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260802000146_security_and_support_lifecycle_hardening.sql",
  ),
  "utf8",
);

describe("security and support lifecycle migration", () => {
  it("reads application roles only from trusted app metadata", () => {
    expect(migration).toContain("auth.jwt() -> 'app_metadata' ->> 'role'");
    expect(migration).not.toContain("auth.jwt() ->> 'role'");
    expect(migration).toContain("from public.profiles p");
    expect(migration).toContain("and p.is_active = true");
    expect(migration).toContain("from public.platform_staff ps");
    expect(migration).toContain("then 'readonly'");
  });

  it("keeps security-definer counters service-only and bounded", () => {
    expect(migration).toContain("Service role required.");
    expect(migration).toContain("char_length(p_key) > 256");
    expect(migration).toContain("grant execute on function public.check_rate_limit");
    expect(migration).toContain("grant execute on function public.increment_visitor_count");
    expect(migration).toContain("trg_sync_open_house_visitor_count_v2");
  });

  it("makes client audit records immutable", () => {
    expect(migration).toContain("drop policy if exists audit_tenant_insert");
    expect(migration).toContain("grant select on table public.audit_logs to authenticated");
    expect(migration).not.toContain("grant insert on table public.audit_logs to authenticated");
    expect(migration).not.toContain("grant select on table public.platform_audit_logs to authenticated");
  });

  it("requires terminal resolution evidence and preserves breach history", () => {
    expect(migration).toContain("support_tickets_terminal_integrity_v3");
    expect(migration).toContain("Resolution summary is required.");
    expect(migration).toContain("old.resolution_breached_at");
    expect(migration).toContain("and resolution_due_at < now()");
    expect(migration).toContain("captured_on_terminal");
    expect(migration).toContain("Bulk terminal transitions require per-ticket resolution evidence.");
  });
});
