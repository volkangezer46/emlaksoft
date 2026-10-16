import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sözleşme: TabbedFormShell `notice` + FormError'ı her düzende TEK KEZ çizer. Tek sayfa (`layout="single"`) düzeninde
 * ikisi hem sütun içinde hem formun altında basılıyordu: çift kayıt uyarısı, hata bandı ve gizli `allow_duplicate`
 * alanı ekranda iki kez görünüyordu (canlı denetim, yeni müşteri formu).
 */
const src = readFileSync(path.join(import.meta.dirname, "tabbed-form-shell.tsx"), "utf8");

describe("TabbedFormShell notice tekliği", () => {
  it("notice iki yerde, birbirini dışlayan koşullarla çizilir", () => {
    const at = [...src.matchAll(/\{notice\}/g)].map((m) => m.index ?? 0);
    expect(at).toHaveLength(2);
    const before = (i: number) => src.slice(Math.max(0, at[i]! - 400), at[i]);
    expect(before(0)).toMatch(/\{tabbed \? \(/);
    expect(before(1)).toMatch(/\{!tabbed \? \(/);
  });
});
