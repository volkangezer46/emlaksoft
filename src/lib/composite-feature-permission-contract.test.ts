import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("composite feature permission truthfulness", () => {
  it("keeps foreign-sale guidance visible while guarding its cross-module controls", () => {
    const page = read("src/app/app/yabanci-satis/page.tsx");
    const forms = read("src/app/app/yabanci-satis/foreign-sale-forms.tsx");

    expect(page).toContain('requireModulePage("properties"');
    expect(page).toContain('effectiveHasPermission(perms, "commissions", "edit")');
    expect(page).toContain('effectiveHasPermission(perms, "customers", "edit")');
    expect(page).toContain("canEdit={canApplyChecklist}");
    expect(page).toContain("canEdit={canMarkForeign}");
    expect(forms.match(/if \(!canEdit\)/g)).toHaveLength(2);
  });

  it("disables only property import when properties:create is unavailable", () => {
    const page = read("src/app/app/ice-aktarma/page.tsx");
    const wizard = read("src/app/app/ice-aktarma/import-wizard.tsx");

    expect(page).toContain('requireModulePage("customers")');
    expect(page).toContain('effectiveHasPermission(perms, "properties", "create")');
    expect(page).toContain("<ImportWizard canImportProperties={canImportProperties} />");
    expect(wizard).toContain('const allowed = t.key !== "properties" || canImportProperties');
    expect(wizard).toContain("disabled={!allowed}");
    expect(wizard).toContain('aria-describedby={!allowed ? "property-import-permission-note" : undefined}');
  });

  it("preflights every module touched by sample-data create and delete flows", () => {
    const action = read("src/app/actions/sample-data.ts");

    for (const mod of [
      "customers",
      "properties",
      "demands",
      "tasks",
      "appointments",
      "commissions",
    ]) {
      expect(action).toContain(`"${mod}",`);
    }
    expect(action).toContain("SAMPLE_DATA_MODULES.every");
    expect(action).toContain('canMutateEverySampleModule({ ...gate, action: "create" })');
    expect(action).toContain('canMutateEverySampleModule({ ...gate, action: "delete" })');
  });
});
