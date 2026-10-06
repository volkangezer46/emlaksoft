import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Kanonik bileşen / tek kaynak sözleşmesi (2026-10 mükerrerlik turu). Silinen kopyalar geri gelmez, @deprecated
 * sarmalayıcılara yeni içe aktarım eklenmez:
 *  - Boş durum TEK `ui/empty-state`; iskelet TEK `ui/skeleton`; sayaç TEK `ui/count-up` (+ canlı değer `ui/animated-number`).
 *  - Para biçimi TEK `lib/format` (admin `moneyTRY` ve ana ekran `_home/format.ts` silindi).
 *  - Randevu türü etiketi TEK `lib/appointment-labels`.
 */
const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|mts)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(SRC);
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");

/** Paralel ajanın (A: projeler) dosyaları birleşene kadar eski yolu kullanabilir; sonra liste boşalır ve sarmalayıcı silinir. */
const DEPRECATED_IMPORT_ALLOW = new Set([
  "src/app/app/projeler/page.tsx",
  "src/app/app/projeler/[id]/loading.tsx",
  "src/app/app/projeler/[id]/units-board.tsx",
]);

describe("kanonik UI bileşenleri", () => {
  it("silinen kopyalar yok", () => {
    for (const f of [
      "src/components/ui/empty-state-v3.tsx",
      "src/components/admin/count-up.tsx",
      "src/app/app/odometer-number.tsx",
      "src/app/app/_home/format.ts",
      "src/app/app/ofis-merkezi/_tabs/settings-tab.tsx",
      "src/components/app/office-center/module-shortcuts.tsx",
    ]) {
      expect(existsSync(join(ROOT, f)), f).toBe(false);
    }
  });

  it("@deprecated sarmalayıcılara yeni içe aktarım yok (boş durum / iskelet)", () => {
    const offenders = files
      .filter((f) => /["']@\/components\/app\/(empty-state|skeleton)["']/.test(readFileSync(f, "utf8")))
      .map(rel)
      .filter((f) => !DEPRECATED_IMPORT_ALLOW.has(f));
    expect(offenders).toEqual([]);
  });

  it("para biçimi tek kaynak: moneyTRY yok", () => {
    const offenders = files.filter((f) => /\bmoneyTRY\b/.test(readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("randevu türü etiketleri tek kaynak (lib/appointment-labels)", () => {
    const offenders = files
      .filter((f) => /showing:\s*["']Yer gösterme["']/.test(readFileSync(f, "utf8")))
      .map(rel)
      .filter((f) => f !== "src/lib/appointment-labels.ts");
    expect(offenders).toEqual([]);
  });
});
