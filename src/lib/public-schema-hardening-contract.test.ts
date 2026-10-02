import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260802000380_public_schema_security_boundary.sql",
  "utf8",
).toLowerCase();

describe("public schema security boundary", () => {
  it("prevents every request-facing database role from creating shadow objects", () => {
    expect(migration).toContain(
      "revoke create on schema public from public, anon, authenticated, service_role",
    );
  });
});
