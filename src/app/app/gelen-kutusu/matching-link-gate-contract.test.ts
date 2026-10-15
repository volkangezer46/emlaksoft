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
    expect(page).toContain("activeDemands.length > 0 && canMatch");
    expect(page).toContain("candidatePropertyCount: canMatch ? matchCandidateCount : 0");
    const btn = page.indexOf("<Target className=\"h-4 w-4\" /> Eşleştir");
    expect(page.lastIndexOf("{canMatch ? (", btn)).toBeGreaterThan(btn - 400);
  });
});
