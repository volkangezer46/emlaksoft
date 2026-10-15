import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCached, walkSource } from "../test-support/src-tree";

/**
 * Herkese açık yüzeylerde dokunma hedefi (PUB-6): vitrin trafiğinin çoğu mobilden gelir. Kart üstü kalp / karşılaştır
 * düğmeleri ve kapat düğmeleri görsel boyutunu korur, dokunmatikte (`touch:` varyantı, src/app/a11y.css) 44 px olur.
 */
const REQUIRED: [file: string, needles: string[]][] = [
  ["src/components/public/fav-button.tsx", ["grid h-9 w-9 touch:h-11 touch:w-11", "text-xs font-bold touch:min-h-11"]],
  ["src/components/public/compare-select.tsx", ["relative z-10 grid h-9 w-9 touch:h-11 touch:w-11", "grid h-8 w-8 touch:h-11 touch:w-11"]],
  ["src/components/public/compare-table.tsx", ["grid h-9 w-9 touch:h-11 touch:w-11"]],
  ["src/components/public/portal-request-form.tsx", ["grid h-9 w-9 touch:h-11 touch:w-11"]],
  ["src/components/public/share-button.tsx", ["touch:min-h-11"]],
  ["src/components/public/vitrin-fav.tsx", ["inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 py-2"]],
  ["src/app/vitrin/[slug]/fav-nav-badge.tsx", ["inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 py-2"]],
];

describe("herkese açık dokunma hedefi sözleşmesi (PUB-6)", () => {
  for (const [file, needles] of REQUIRED) {
    it(file, () => {
      const src = readFileSync(path.join(process.cwd(), file), "utf8");
      for (const n of needles) expect(src, `${file} → ${n}`).toContain(n);
    });
  }

  it("public/vitrin ikon düğmeleri (press grid h-7..h-10) touch: hedefi taşır", () => {
    const offenders: string[] = [];
    const roots = ["src/components/public", "src/app/vitrin"].map((r) => path.join(process.cwd(), r));
    for (const root of roots) {
      for (const file of walkSource(root).filter((f) => f.endsWith(".tsx"))) {
        readCached(file)
          .split("\n")
          .forEach((line, i) => {
            if (/\bpress\b[^"`]*\bgrid h-(7|8|9|10) w-(7|8|9|10)\b/.test(line) && !line.includes("touch:")) {
              offenders.push(`${path.relative(process.cwd(), file)}:${i + 1}`);
            }
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
