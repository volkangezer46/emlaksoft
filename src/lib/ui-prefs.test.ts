import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_UI_PREFS, isSmallOffice } from "./ui-prefs";

describe("tek görünüm (sahip kararı 2026-10-16)", () => {
  it("görünüm tercihi sabittir: çerez, anahtar ve 'Tüm özellikleri göster' yok", () => {
    expect(DEFAULT_UI_PREFS).toEqual({ simple: true });
    const src = readFileSync("src/lib/ui-prefs.ts", "utf8") + readFileSync("src/lib/ui-prefs-server.ts", "utf8");
    for (const gone of ["uiPrefCookieName", "resolveUiPrefs", "writeUiPrefsCookie", "readUiPrefsCookie", "cookies()"]) expect(src).not.toContain(gone);
    const layout = readFileSync("src/app/app/layout.tsx", "utf8");
    expect(layout).not.toContain("SimpleModeProvider");
    expect(layout).not.toContain("viewPrefs");
    expect(readFileSync("src/components/ui/console/user-menu-panel.tsx", "utf8")).not.toContain("ViewPrefs");
    expect(readFileSync("src/lib/palette-core.ts", "utf8")).not.toContain("Sade görünüm");
  });

  it("küçük ofis: en çok 5 kişi ve şube yok; bilinmiyorsa küçük", () => {
    expect(isSmallOffice({ seats: 5, branches: 0 })).toBe(true);
    expect(isSmallOffice({ seats: 6, branches: 0 })).toBe(false);
    expect(isSmallOffice({ seats: 2, branches: 1 })).toBe(false);
    expect(isSmallOffice(null)).toBe(true);
  });
});
