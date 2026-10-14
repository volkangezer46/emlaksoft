import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

function walk(dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(rel) : [rel];
  });
}

/**
 * DG1: Next route handler'ları (GET dahil) istek deposunu `phase: "action"` ile açar; `requirePlatformModule(mod)`
 * orada örtük olarak "yaz" ister (`gateAction`). Belgelenen davranışla kod ayrışmasın diye route.ts içindeki her
 * personel modül kapısı eylemi AÇIKÇA verir ("view" | "write" | "approve").
 */
describe("route handler personel kapısı eylemi açıkça verir", () => {
  it("route.ts içinde tek argümanlı requirePlatformModule yok", () => {
    const offenders: string[] = [];
    for (const rel of walk("src/app").filter((f) => /\/route\.tsx?$/.test(f))) {
      const src = readFileSync(path.join(root, rel), "utf8");
      for (const m of src.matchAll(/requirePlatformModule\(\s*("[^"]+"|'[^']+'|[\w.]+)\s*(,\s*[^)]*)?\)/g)) {
        if (!m[2] || !/"(view|write|approve)"|'(view|write|approve)'/.test(m[2])) offenders.push(`${rel}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("gateAction belgesi route handler evresini anlatır", () => {
    const phase = readFileSync(path.join(root, "src/lib/platform-action-phase.ts"), "utf8");
    expect(phase).toContain("createRequestStoreForAPI");
  });
});
