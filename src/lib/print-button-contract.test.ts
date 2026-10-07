import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Yazdır düğmesi TEK KAYNAK: `src/components/ui/print-button.tsx` (tone/size/label).
 * Eskiden 9 ayrı `*\/print-button.tsx` kopyası vardı; yeni ekran kopya yazmaz.
 * (QR açılır penceresindeki `onload=window.print()` HTML metni kapsam dışıdır.)
 */

const CANONICAL = "src/components/ui/print-button.tsx";

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("yazdır düğmesi tek kaynak", () => {
  const files = walk(path.join(process.cwd(), "src")).map((abs) => ({
    rel: path.relative(process.cwd(), abs).replace(/\\/g, "/"),
    abs,
  }));

  it("kanonik bileşen dışında print-button dosyası yok", () => {
    const copies = files.filter((f) => /print(-report)?-button\.tsx$/.test(f.rel) && f.rel !== CANONICAL).map((f) => f.rel);
    expect(copies).toEqual([]);
  });

  it("window.print() düğmesi yalnız kanonik bileşende", () => {
    const bad = files
      .filter((f) => f.rel !== CANONICAL)
      .filter((f) => /onClick=\{\s*\(\)\s*=>\s*window\.print\(\)\s*\}/.test(readFileSync(f.abs, "utf8")))
      .map((f) => f.rel);
    expect(bad, `PrintButton kullanın:\n${bad.join("\n")}`).toEqual([]);
  });
});
