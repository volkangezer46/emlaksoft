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

  it("never reports a missing update or delete as successful", () => {
    expect(action.match(/\.select\("id"\)\s*\.maybeSingle\(\)/g)).toHaveLength(3);
    expect(action.match(/if \(!data\) return \{ error: "Aidat kaydı bulunamadı\." \};/g)).toHaveLength(3);
    expect(action).toContain('return { error: "Aidat silinemedi." };');
  });

  it("fails the page instead of presenting database errors as empty financial data", () => {
    expect(page).toContain("listError, kpiRes.error, overdueStripError, propertiesError");
    expect(page).toContain('throw new Error("Aidat verileri güvenli şekilde yüklenemedi.")');
  });

  it("reports mutation results and exposes an accessible pending/error form", () => {
    expect(client).toContain("const result = await toggleDuePaid(id, toPaid)");
    expect(client).toContain("const result = await deleteDue(id)");
    expect(client).toContain('push(result.error, "err")');
    expect(client).toContain("aria-busy={pending}");
    expect(client).toContain('role="alert"');
  });
});
