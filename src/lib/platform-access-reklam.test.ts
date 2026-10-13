import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { platformCanAccess, platformModuleMode } from "./platform-access";

/** `reklam` modülü: super_admin yazar, ops yalnız görüntüler (readonly), billing ve support göremez. */
describe("platform rolü × reklam modülü", () => {
  it("super_admin yazar", () => {
    expect(platformModuleMode("super_admin", "reklam")).toBe("write");
  });

  it("ops salt okur", () => {
    expect(platformCanAccess("ops", "reklam")).toBe(true);
    expect(platformModuleMode("ops", "reklam")).toBe("readonly");
  });

  it("billing ve support erişemez", () => {
    expect(platformCanAccess("billing", "reklam")).toBe(false);
    expect(platformCanAccess("support", "reklam")).toBe(false);
    expect(platformModuleMode("billing", "reklam")).toBe("none");
    expect(platformModuleMode("support", "reklam")).toBe("none");
  });

  it("diğer modüllerde ops kipi değişmez (yalnız reklam salt okunur)", () => {
    expect(platformModuleMode("ops", "seo")).toBe("write");
  });

  it("ekranlar ve eylemler doğru kapıyı kullanır", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    expect(read("src/app/admin/site/baglantilar/page.tsx")).toContain('requirePlatformModule("reklam")');
    expect(read("src/app/admin/site/reklam/google/page.tsx")).toContain('requirePlatformModule("reklam")');
    expect(read("src/app/admin/seo/performans/page.tsx")).toContain('requirePlatformModule("seo")');
    const actions = read("src/app/actions/google-connect.ts");
    expect(actions).toContain('module: "reklam", roles: ["super_admin"]');
    // Her dışa açık eylem super_admin kapısıyla başlar.
    const exported = [...actions.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n\s+const g = await superGuard\(\);/g)].map((m) => m[1]);
    const all = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(exported.sort()).toEqual(all.sort());
  });
});
