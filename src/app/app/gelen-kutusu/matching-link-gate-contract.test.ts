import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M3 sözleşmesi: /app/talepler?sekme=eslesme bağlantıları yalnız talep + eşleşme modülü açıkken verilir (aksi halde
 * sekme talep listesine düşer ve bağlantı yanlış yere gider).
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("eşleşme bağlantısı izin kapısı", () => {
  it("çağrı konsolu: 'Eşleşen portföy' bağlantısı canOpenMatching ile kapılı; sayfa izni hesaplar", () => {
    const view = read("src/app/app/gelen-kutusu/calls-view.tsx");
    expect(view).toMatch(/effectiveCanAccessModule\(perms, "demands"\) && effectiveCanAccessModule\(perms, "matching"\)/);
    expect(view).toContain("canOpenMatching={canOpenMatching}");
    const consoleSrc = read("src/app/app/gelen-kutusu/call-console.tsx");
    const at = consoleSrc.indexOf("sekme=eslesme");
    expect(consoleSrc.lastIndexOf("canOpenMatching ?", at)).toBeGreaterThan(consoleSrc.indexOf("Müşteri bağlamı"));
  });

  it("müşteri kartı: Eşleştir düğmesi, eşleşme KPI'ı ve öneri canMatch ile kapılı", () => {
    const page = read("src/app/app/musteriler/[id]/page.tsx");
    expect(page).toMatch(/const canMatch = effectiveCanAccessModule\(perms, "demands"\) && effectiveCanAccessModule\(perms, "matching"\)/);
    // KPI ve birincil Eşleştir düğmesi canMatch'e bağlı; NBA'nın gerçek eşleşme sayısı yalnız canMatch iken hesaplanır.
    expect(page).toContain("const showMatchKpi = activeDemands.length > 0 && canMatch");
    expect(page).toContain("const showMatchPrimary = canMatch && activeDemands.length > 0");
    expect(page).toContain("demands: openDemandsFull, canMatch })");
    let from = 0;
    let seen = 0;
    for (;;) {
      const btn = page.indexOf("<Target className=\"h-4 w-4\" /> Eşleştir", from);
      if (btn < 0) break;
      const guard = Math.max(page.lastIndexOf("{showMatchPrimary ? (", btn), page.lastIndexOf("{canMatch && !showMatchPrimary ? (", btn));
      expect(guard).toBeGreaterThan(btn - 400);
      seen += 1;
      from = btn + 1;
    }
    expect(seen).toBe(2);
    const nba = read("src/app/app/musteriler/[id]/next-best-action.ts");
    expect(nba).toContain("if (input.canMatch && input.openDemands.length > 0");
  });
});
