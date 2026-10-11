import { describe, expect, it } from "vitest";
import { join, relative } from "node:path";
import { readCached, walkSource } from "./test-support/src-tree";

/**
 * Yerel tarayıcı onayı (`window.confirm` / çıplak `confirm(`) yasaktır: kanonik `ConfirmDialog`
 * (`src/components/ui/confirm-dialog.tsx`) kullanılır. Tek istisna `draft-table.tsx`:
 * sayfadan ayrılma koruması SENKRON yanıt ister (asenkron diyalog ayrılmayı durduramaz).
 */
const ALLOWED = new Set(["src/components/ui/draft-table.tsx"]);
const NATIVE_CONFIRM = /window\.confirm\(|(?<![\w.$])(?<!function )confirm\(/;

describe("yerel confirm sözleşmesi", () => {
  it("src altında window.confirm / confirm( yalnız draft-table.tsx içinde", () => {
    const root = join(process.cwd(), "src");
    const offenders: string[] = [];
    for (const file of walkSource(root)) {
      const rel = relative(process.cwd(), file).replace(/\\/g, "/");
      if (ALLOWED.has(rel)) continue;
      readCached(file)
        .split("\n")
        .forEach((line, i) => {
          const t = line.trim();
          if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
          if (NATIVE_CONFIRM.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
    }
    expect(offenders, "yerel confirm yerine ConfirmDialog kullan").toEqual([]);
  });

  it("istisna dosya gerçekten senkron korumayı kullanıyor (bayat istisna yok)", () => {
    const src = readCached(join(process.cwd(), "src/components/ui/draft-table.tsx"));
    expect(src).toContain("window.confirm(");
  });
});
