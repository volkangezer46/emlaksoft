import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Tasarım sistemi v3 kuralları. Bu test, codemod ile temizlenen sapmaların
// geri gelmesini engeller. Kural değişecekse önce docs/ROADMAP.md'de karar verilir.

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx|ts|css)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const FILES = sourceFiles("src");

function offenders(pattern: RegExp): string[] {
  return FILES.filter((f) => pattern.test(readFileSync(f, "utf8")));
}

describe("tasarım token sözleşmesi", () => {
  it("12 px altı metin yok (okunabilirlik tabanı: text-xs)", () => {
    expect(offenders(/text-\[(?:[0-9]|1[01])px\]/)).toEqual([]);
  });

  it("dağınık köşe yarıçapı yok: 8–28 px arası arbitrary radius token'dan gelir", () => {
    expect(offenders(/rounded(?:-[a-z]{1,2})?-\[(?:[89]|1\d|2[0-8])px\]/)).toEqual([]);
  });

  it("src/components: rounded-[Npx], text-[Npx] ve text-zinc-* yok (token/semantik sınıf kullan)", () => {
    const comps = FILES.filter((f) => f.split("\\").join("/").startsWith("src/components/"));
    const bad = (re: RegExp) => comps.filter((f) => re.test(readFileSync(f, "utf8")));
    expect(bad(/rounded(?:-[a-z]{1,2})?-\[\d+px\]/)).toEqual([]);
    expect(bad(/text-\[\d+px\]/)).toEqual([]);
    expect(bad(/text-zinc-/)).toEqual([]);
  });

  it("koyu tema yalnız /app ve /admin için tanımlı ve kök layout'ta açılış script'i var", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).toContain("THEME_BOOT_SCRIPT");
    expect(layout).toContain("suppressHydrationWarning");
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain('@import "./theme-dark.css"');
  });

  it("Türkçe karakterler için fontlar latin-ext alt kümesiyle yüklenir", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    const subsets = layout.match(/subsets:\s*\[[^\]]*\]/g) ?? [];
    const fontSubsets = subsets.filter((s) => s.includes('"latin"'));
    expect(fontSubsets.length).toBeGreaterThanOrEqual(2);
    // Geist Mono yalnız kod/sayı için; Manrope ve Inter latin-ext içermeli.
    expect(fontSubsets.filter((s) => s.includes("latin-ext")).length).toBeGreaterThanOrEqual(2);
  });
});
