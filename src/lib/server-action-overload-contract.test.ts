import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "use server" dosyasında overload bildirimi (`export function x(...): T;`) Turbopack üretim derlemesini kırar
 * ("Server Actions must be async functions"); tsc bunu yakalamaz. Form kullanımı `asFormAction` ile tiplenir.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("sunucu eylemi dosyalarında overload yok", () => {
  it("'use server' dosyalarında gövdesiz export function bildirimi bulunmaz", () => {
    const offenders: string[] = [];
    for (const file of walk(join(process.cwd(), "src"))) {
      const src = readFileSync(file, "utf8");
      if (!/^\s*["']use server["'];?/m.test(src.slice(0, 400))) continue;
      const m = src.match(/^export (?:async )?function \w+\([^)]*\)\s*:\s*[^{\n]+;\s*$/gm);
      if (m) offenders.push(`${file}: ${m.join(" | ")}`);
    }
    expect(offenders).toEqual([]);
  });
});
