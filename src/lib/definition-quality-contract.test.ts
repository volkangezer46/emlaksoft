import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const action = read("src/app/actions/definitions.ts");
const page = read("src/app/app/ayarlar/tanimlar/page.tsx");
const manager = read("src/app/app/ayarlar/tanimlar/definitions-manager.tsx");

describe("definition management quality contract", () => {
  it("bounds user-controlled identifiers and text", () => {
    expect(action).toContain("UUID_RE.test(id)");
    expect(action).toContain("label.length > 120 || value.length > 120");
    expect(manager).toContain("maxLength={120}");
  });

  it("checks every update and delete actually affected an office-owned row", () => {
    expect(action.match(/\.select\("id"\)\s*\.maybeSingle\(\)/g)).toHaveLength(4); // toggle, rename, color, delete
    expect(action).toContain("Tanım bulunamadı veya sistem tanımı değiştirilemez.");
    expect(action).toContain("Tanım bulunamadı veya sistem tanımı silinemez.");
  });

  it("does not render a database failure as an empty definition list", () => {
    expect(page).toContain('throw new Error("Tanımlar güvenli şekilde yüklenemedi.")');
  });

  it("surfaces each mutation result and has an accessible form state", () => {
    expect(manager).toContain("const result = await toggleDefinition(id, next)");
    expect(manager).toContain("const res = await deleteDefinition(id)");
    expect(manager).toContain("const res = await renameDefinition(id, next)");
    expect(manager).toContain("aria-busy={pending}");
    expect(manager).toContain('role="alert"');
    expect(manager).toContain('role="tablist"');
    expect(manager).toContain('role="tabpanel"');
    expect(manager).toContain('event.key === "ArrowRight"');
  });
});
