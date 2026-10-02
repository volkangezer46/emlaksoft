import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "scripts/apply-migrations.ts"),
  "utf8",
);

describe("migration runner safety contract", () => {
  it("keeps dry-run database inspection free of persistent writes", () => {
    expect(source).toContain("if (!DRY_RUN && (BASELINE || pending.length > 0))");
    expect(source).toContain("select to_regclass('public.schema_migrations')");

    const guardedStart = source.indexOf("if (!DRY_RUN && (BASELINE || pending.length > 0))");
    const createLedger = source.indexOf("create table if not exists public.schema_migrations");
    const grants = source.indexOf("revoke all on table public.schema_migrations");
    expect(guardedStart).toBeGreaterThan(-1);
    expect(createLedger).toBeGreaterThan(guardedStart);
    expect(grants).toBeGreaterThan(createLedger);
  });

  it("never executes pending SQL in dry-run mode", () => {
    expect(source).toContain('if (DRY_RUN) {');
    expect(source).toContain('console.log("\\n--dry-run: hiçbir şey uygulanmadı.")');
    expect(source.indexOf('if (DRY_RUN) {')).toBeLessThan(
      source.indexOf('await client.query("begin")'),
    );
  });

  it("does not let --only bypass a schema/ledger reconciliation stop", () => {
    expect(source).toContain(
      "const allPending = allFiles.filter((f) => !applied.has(f))",
    );
    expect(source).toMatch(
      /pendingMigrationsWithSchemaEvidence\(\s*client,\s*allPending,?\s*\)/,
    );

    const allPending = source.indexOf("const allPending = allFiles.filter");
    const evidenceCheck = source.indexOf("pendingMigrationsWithSchemaEvidence(", allPending);
    const migrationBegin = source.indexOf('await client.query("begin")');
    expect(allPending).toBeGreaterThan(-1);
    expect(evidenceCheck).toBeGreaterThan(allPending);
    expect(evidenceCheck).toBeLessThan(migrationBegin);
  });

  it("rejects checksum or reconciliation drift before ledger/ACL writes", () => {
    const checksumGate = source.indexOf("migrationFileMatchesChecksum");
    const evidenceGate = source.indexOf("if (!BASELINE && reconciliationRequired.length > 0)");
    const baselineEvidenceGate = source.indexOf("if (BASELINE && (!ONLY || !reconciliationRequired.includes(ONLY)))");
    const createLedger = source.indexOf("create table if not exists public.schema_migrations");
    const commentLedger = source.indexOf("comment on table public.schema_migrations");
    const grants = source.indexOf("revoke all on table public.schema_migrations");

    expect(checksumGate).toBeGreaterThan(-1);
    expect(evidenceGate).toBeGreaterThan(checksumGate);
    expect(baselineEvidenceGate).toBeGreaterThan(evidenceGate);
    expect(createLedger).toBeGreaterThan(baselineEvidenceGate);
    expect(commentLedger).toBeGreaterThan(createLedger);
    expect(grants).toBeGreaterThan(commentLedger);
  });

  it("requires an exact, explicitly attested baseline row", () => {
    expect(source).toContain("const CONFIRM_SCHEMA_PRESENT");
    expect(source).toContain("BASELINE && (!ONLY || !CONFIRM_SCHEMA_PRESENT)");
    expect(source).toContain("!reconciliationRequired.includes(ONLY)");
    expect(source).not.toContain("mevcut TÜM dosyaları");
  });

  it("applies prerequisites through the workflow scaffold and stops before enforcement", () => {
    expect(source).toContain("let pending = files.filter");
    expect(source).toContain("file <= CORE_WORKFLOW_SCAFFOLD_MIGRATION");
    expect(source).toContain("stoppedAtCoreWorkflowScaffold = true");
    expect(source).toContain("ONLY === CORE_WORKFLOW_INVARIANT_MIGRATION");
    expect(source).toContain("earlierPending.length > 0");

    const phaseGate = source.indexOf("if (allPending.includes(CORE_WORKFLOW_INVARIANT_MIGRATION))");
    const migrationBegin = source.indexOf('await client.query("begin")');
    expect(phaseGate).toBeGreaterThan(-1);
    expect(phaseGate).toBeLessThan(migrationBegin);
  });

  it("accepts scaffold evidence only for all columns and exact validated tenant FKs", () => {
    for (const evidence of [
      "('deals', 'prev_property_status')",
      "('deals', 'project_unit_id')",
      "('deals', 'closure_active')",
      "('rentals', 'deal_id')",
      "select count(*) = 4",
      "c.convalidated",
      "c.conrelid = 'public.deals'::regclass",
      "c.confrelid = 'public.project_units'::regclass",
      "c.conrelid = 'public.rentals'::regclass",
      "c.confrelid = 'public.deals'::regclass",
      "deals_project_unit_tenant_fkey",
      "rentals_deal_tenant_fkey",
      "FOREIGN KEY (project_unit_id, tenant_id) REFERENCES project_units(id, tenant_id) ON DELETE RESTRICT",
      "FOREIGN KEY (deal_id, tenant_id) REFERENCES deals(id, tenant_id) ON DELETE RESTRICT",
    ]) {
      expect(source).toContain(evidence);
    }
    expect(source.match(/pg_get_constraintdef\(c\.oid\)/g)).toHaveLength(2);
  });
});
