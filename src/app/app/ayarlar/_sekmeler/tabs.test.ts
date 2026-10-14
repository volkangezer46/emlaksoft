import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS_TABS, parseSettingsTab, settingsTabHref } from "./tabs";

describe("/app/ayarlar sekmeleri", () => {
  it("gövde yalnız 'Marka ve kimlik' ve 'Eşleştirme'dir", () => {
    expect(SETTINGS_TABS.map((t) => t.label)).toEqual(["Marka ve kimlik", "Eşleştirme"]);
  });

  it("bilinmeyen/boş/kaldırılmış sekme varsayılan kimlik; bağlantı kontratı", () => {
    expect(parseSettingsTab(undefined)).toBe("kimlik");
    expect(parseSettingsTab("yok")).toBe("kimlik");
    for (const removed of ["tum", "bildirim", "entegrasyon"]) expect(parseSettingsTab(removed)).toBe("kimlik");
    expect(parseSettingsTab("eslestirme")).toBe("eslestirme");
    expect(settingsTabHref("kimlik")).toBe("/app/ayarlar");
    expect(settingsTabHref("kimlik", "yetki-belgesi")).toBe("/app/ayarlar#yetki-belgesi");
    expect(settingsTabHref("eslestirme", "eslestirme-agirliklari")).toBe("/app/ayarlar?sekme=eslestirme#eslestirme-agirliklari");
  });

  it("her sekmenin çapası kendi sekme dosyasında; eski çapa çevirici yok", () => {
    const read = (f: string) => readFileSync(resolve(process.cwd(), "src/app/app/ayarlar", f), "utf8");
    expect(read("_sekmeler/kimlik-tab.tsx")).toContain('id="marka-kimlik"');
    expect(read("_sekmeler/eslestirme-tab.tsx")).toContain('id="eslestirme-agirliklari"');
    expect(read("page.tsx")).not.toContain("HashTabRedirect");
  });
});
