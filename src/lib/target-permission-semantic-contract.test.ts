import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const actionSource = read("src/app/actions/targets-openhouse-sources.ts");
const targetSection = actionSource.slice(0, actionSource.indexOf("// ============================================================"));

describe("target permission semantic contract", () => {
  it("keeps the page and every target action on the targets capability", () => {
    const pageSource = read("src/app/app/hedefler/page.tsx");

    expect(pageSource).toContain('requireModulePage("targets")');
    expect(targetSection).toContain('requirePermission("targets", "view")');
    expect(targetSection.match(/requirePermission\("targets", "create"\)/g)).toHaveLength(2);
    expect(targetSection).toContain('requirePermission("targets", "edit")');
    expect(targetSection).toContain('requirePermission("targets", "delete")');
    expect(targetSection).not.toContain('requirePermission("reports"');
  });

  it("tenant-validates every caller-selected target owner before mutation", () => {
    expect(
      targetSection.match(/validateTenantReferences\(gate\.tenantId, \{[\s\S]*?profileId[\s\S]*?\}\)/g),
    ).toHaveLength(3);
  });
});
