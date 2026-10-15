import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const action = read("src/app/actions/dues.ts");
const page = read("src/app/app/aidat/page.tsx");
const client = read("src/app/app/aidat/dues-client.tsx");

describe("due feature quality contract", () => {
  it("validates money, dates and tenant-owned property references before insert", () => {
    expect(action).toContain("parseDueInput(fd)");
    expect(action).toContain("validateTenantReferences(gate.tenantId, { propertyId })");
  });

  it("writes only through finance_due_* RPCs; never deletes (cancel with reason) and never writes legacy property_dues", () => {
    for (const rpc of ["finance_due_create", "finance_due_update", "finance_due_mark_paid", "finance_due_reopen", "finance_due_cancel"]) {
      expect(action).toContain(`rpc("${rpc}"`);
    }
    expect(action).not.toContain("property_dues");
    expect(action).not.toMatch(/\.delete\(\)/);
    expect(action).not.toContain("deleteDue");
    expect(action).toContain('requirePermission("expenses", "delete")');
    expect(action).toContain("İptal nedenini yazın");
  });

  it("fails the page instead of presenting database errors as empty financial data", () => {
    expect(page).toContain("listError, kpiRes.error, overdueStripError, propertiesError");
    expect(page).toContain('throw new Error("Aidat verileri güvenli şekilde yüklenemedi.")');
  });

  it("reports mutation results and exposes an accessible pending/error form", () => {
    expect(client).toContain("const result = await toggleDuePaid(id, toPaid,");
    expect(client).not.toContain("deleteDue");
    expect(client).toContain("<DueCancelDialog");
    expect(client).toContain('push(result.error, "err")');
    expect(client).toContain("aria-busy={pending}");
    expect(client).toContain('role="alert"');
  });
});
