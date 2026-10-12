import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCached, walkSource } from "./test-support/src-tree";

/** Destek e-postası TEK kaynak: kaynakta sabit 'destek@emlaksoft' dizesi yalnız contact-info.ts'te geçer. */
describe("destek e-postası tek kaynak", () => {
  it("destek@emlaksoft yalnız contact-info.ts içinde", () => {
    const offenders: string[] = [];
    for (const file of walkSource(path.join(process.cwd(), "src")).filter((f) => /\.(ts|tsx)$/.test(f))) {
      const norm = file.replace(/\\/g, "/");
      if (norm.endsWith("/lib/contact-info.ts") || /\.test\.tsx?$/.test(norm)) continue;
      if (readCached(file).includes("destek@emlaksoft")) offenders.push(norm);
    }
    expect(offenders).toEqual([]);
  });
});
