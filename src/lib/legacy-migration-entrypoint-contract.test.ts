import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const legacy = readFileSync("scripts/apply-migrations.js", "utf8");
const applyOne = readFileSync("scripts/apply-one.ts", "utf8");
const apply008 = readFileSync("scripts/apply-migration-008.ts", "utf8");
const oldBundle = readFileSync("supabase/apply_premium_plus.sql", "utf8");
const oldSprint = readFileSync("docs/SPRINT_FINAL.md", "utf8");
const smoke = readFileSync("scripts/smoke-test.js", "utf8");

describe("legacy migration entrypoint", () => {
  it("fails closed and cannot bypass the ledger runner through exec_sql", () => {
    expect(legacy).toContain("process.exitCode = 1");
    expect(legacy).toContain("npm run db:migrate -- --dry-run");
    expect(legacy).not.toContain("/rest/v1/rpc/exec_sql");
    expect(legacy).not.toContain("SUPABASE_SECRET_KEY");
    expect(legacy).not.toContain("apply_premium_plus.sql");
  });

  it("retires direct single-file executors and makes the obsolete SQL bundle abort", () => {
    for (const source of [applyOne, apply008]) {
      expect(source).toContain("throw new Error");
      expect(source).not.toContain("new Client");
      expect(source).not.toContain("client.query");
      expect(source).not.toContain("readFileSync");
    }
    expect(oldBundle).toContain("raise exception");
    expect(oldBundle).not.toContain("create table");
    expect(oldBundle).not.toContain("create policy");
  });

  it("does not instruct operators to execute the retired SQL bundle", () => {
    expect(oldSprint).not.toMatch(/\[ \] `apply_premium_plus\.sql` çalıştır/);
    expect(smoke).not.toContain("supabase/apply_premium_plus.sql çalıştır");
    expect(oldSprint).toContain("npm run db:migrate -- --dry-run");
    expect(smoke).toContain("npm run db:migrate -- --dry-run");
  });
});
