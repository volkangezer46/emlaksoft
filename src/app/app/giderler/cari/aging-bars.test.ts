import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SK6/B108: yaşlandırma çubuğunda 0-30 ve 31-60 gün dilimleri `bg-warning-400/600` kullanıyordu; tokens.css'te
 * `--color-warning-400/600` yok (yalnız `--color-warn-*`), Tailwind sınıf üretmiyor ve dilim şeffaf kalıyordu.
 * Sözleşme: dosyadaki her `bg-<ad>` sınıfı tanımlı bir `--color-<ad>` token'ına çözülür.
 */
const ROOT = process.cwd();
const SRC = readFileSync(join(ROOT, "src/app/app/giderler/cari/aging-bars.tsx"), "utf8");
const TOKENS = ["src/app/tokens.css", "src/app/globals.css"].map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");

describe("aging-bars renk sınıfları (B108)", () => {
  it("her bg-* sınıfı tanımlı bir --color-* token'ına çözülür", () => {
    const classes = [...new Set([...SRC.matchAll(/\bbg-([a-z]+(?:-[a-z]+)*-\d{2,3}|text-muted)\b/g)].map((m) => m[1]))];
    expect(classes.length).toBeGreaterThan(4);
    const missing = classes.filter((c) => !new RegExp(`--color-${c}\\s*:`).test(TOKENS));
    expect(missing).toEqual([]);
  });

  it("eski tanımsız bg-warning-400/600 geri gelmez", () => {
    expect(SRC).not.toMatch(/bg-warning-\d/);
  });
});
