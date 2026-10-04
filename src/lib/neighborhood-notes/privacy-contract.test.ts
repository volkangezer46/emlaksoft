import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SÖZLEŞME: mahalle notları (neighborhood_notes) YALNIZ ofis içidir. Public vitrin, token'lı portallar,
 * public API ve ilan metni/AI/portal yayın yollarında geçemez. Yalnız aşağıdaki ofis içi dosyalar okur/yazar.
 */

const ALLOWED = new Set([
  "src/app/actions/neighborhood-notes.ts",
  "src/lib/neighborhood-notes/load.ts",
  "src/lib/neighborhood-notes/notes.ts",
  "src/lib/neighborhood-notes/notes.test.ts",
  "src/lib/neighborhood-notes/privacy-contract.test.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("mahalle notu gizliliği", () => {
  it("neighborhood_notes yalnız izinli ofis içi dosyalarda geçer", () => {
    const root = process.cwd();
    const offenders: string[] = [];
    for (const file of walk(join(root, "src"))) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (ALLOWED.has(rel)) continue;
      if (readFileSync(file, "utf8").includes("neighborhood_notes")) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("not bileşeni ve sayfası yalnız /app altında kullanılır (public yüzeyde import yok)", () => {
    const root = process.cwd();
    const offenders: string[] = [];
    const publicRoots = ["src/app/vitrin", "src/app/musteri-portali", "src/app/malik-portali", "src/app/api/public"];
    for (const pr of publicRoots) {
      let files: string[] = [];
      try {
        files = walk(join(root, pr));
      } catch {
        continue;
      }
      for (const f of files) {
        const text = readFileSync(f, "utf8");
        if (/neighborhood-notes|NeighborhoodNotesPanel/.test(text)) offenders.push(relative(root, f).replace(/\\/g, "/"));
      }
    }
    expect(offenders).toEqual([]);
  });
});
