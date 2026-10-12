import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * TAŞMA SÖZLEŞMESİ: tek sütunlu `grid` (grid-cols yok) içinde `truncate` eden metin + sağda `shrink-0` tutar/rozet
 * bulunan kapsayıcılarda, grid'in auto sütunu nowrap metinle büyür ve tutar kartın dışına taşar.
 * Çözüm: kapsayıcıya `grid-cols-[minmax(0,1fr)]` (ya da `min-w-0` / `overflow-hidden`) ekle.
 */
const DIRS = ["src/app/app", "src/app/admin", "src/components/app", "src/components/admin"];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.tsx$/.test(n) && !/\.test\./.test(n)) out.push(f);
  }
  return out;
}

describe("grid içinde truncate + shrink-0 taşma sınıfı", () => {
  it("tek sütunlu grid kapsayıcıları minmax(0,1fr) ya da min-w-0 taşır", () => {
    const bad: string[] = [];
    for (const f of DIRS.flatMap((d) => walk(join(process.cwd(), d)))) {
      const L = readFileSync(f, "utf8").split(/\r?\n/);
      L.forEach((l, i) => {
        const m = l.match(/<(?:ul|ol|div)\b[^>]*className="([^"]*)"/);
        if (!m) return;
        const c = m[1];
        if (l.includes("gridTemplateColumns")) return;
        if (!/(^|\s)grid(\s|$)/.test(c) || /grid-cols|grid-flow|min-w-0|overflow-hidden|overflow-x/.test(c)) return;
        const ind = l.search(/\S/);
        const blk: string[] = [];
        for (let j = i + 1; j < L.length && j < i + 40; j++) {
          if (L[j].trim() && L[j].search(/\S/) <= ind) break;
          blk.push(L[j]);
        }
        const t = blk.join("\n");
        if (/\btruncate\b/.test(t) && /shrink-0/.test(t)) bad.push(`${f.replace(process.cwd(), "")}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
