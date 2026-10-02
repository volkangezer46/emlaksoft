import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("observability privacy hardening contract", () => {
  it("allows a resolved fingerprint to recur as a new unresolved lifecycle", () => {
    const migration = read(
      "supabase/migrations/20260802000360_observability_privacy_hardening.sql",
    );
    expect(migration).toContain("drop index if exists public.uq_error_logs_fingerprint");
    expect(migration).toContain("where resolved_at is null");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("on conflict (");
    expect(migration).toContain("occurrences = public.error_logs.occurrences + 1");
    expect(migration).toContain("to service_role");

    const logger = read("src/lib/error-log.ts");
    expect(logger).toContain('admin.rpc("record_error_occurrence"');
    expect(logger).not.toContain('.from("error_logs")');
  });

  it("bounds public input and fails closed if the rate-limit service degrades", () => {
    const action = read("src/app/actions/report-error.ts");
    expect(action).toContain("parseClientErrorReport(input)");
    expect(action).toContain('failurePolicy: "deny"');
    expect(action).toContain("if (!rate.allowed) return");
    expect(action).not.toContain("tenantId: input");
  });
});
