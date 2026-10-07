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
    expect(page).toContain("canImportProperties={canImportProperties}");
    expect(page).toContain('effectiveHasPermission(perms, "demands", "create")');
    // Hedef başına yetki: portföy/talep ve faaliyet türleri (görev/randevu/gider) kendi "create" iznine bağlı.
    expect(wizard).toMatch(/t\.key === "properties"\s*\?\s*canImportProperties\s*:\s*t\.key === "demands"\s*\?\s*canImportDemands/);
    expect(wizard).toContain("canImportActivity[t.key]");
    for (const mod of ["tasks", "appointments", "expenses"]) {
      expect(page).toContain(`effectiveHasPermission(perms, "${mod}", "create")`);
    }
    expect(wizard).toContain("disabled={!allowed}");
    expect(wizard).toContain("aria-describedby={!allowed ? `${t.key}-import-permission-note` : undefined}");
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
