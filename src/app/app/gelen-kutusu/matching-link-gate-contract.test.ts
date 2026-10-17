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
    // Birincil "İlan gönder" (hero ve mobil çubuk) showMatchPrimary'ye, "Eşleştir / Tüm uygun ilanlar" canMatch'e bağlı.
    const checks: Array<[string, string[]]> = [
      // DetailHero eylemleri dizi öğesidir (`cond ? (<…/>) : null,`): koşul süslü parantezsiz de yazılır.
      ['<Send className="h-4 w-4" /> İlan gönder', ["showMatchPrimary ? ("]],
      ["<Send className={RECORD_BAR_ICON} aria-hidden /> İlan gönder", ["{simple && showMatchPrimary ? ("]],
      ['<Target className="h-4 w-4" />', ["canMatch ? ("]],
    ];
    for (const [needle, guards] of checks) {
      const btn = page.indexOf(needle);
      expect(btn, needle).toBeGreaterThan(0);
      const guard = Math.max(...guards.map((g) => page.lastIndexOf(g, btn)));
      expect(guard, needle).toBeGreaterThan(btn - 400);
    }
    const nba = read("src/app/app/musteriler/[id]/next-best-action.ts");
    expect(nba).toContain("if (input.canMatch && input.openDemands.length > 0");
  });
});
