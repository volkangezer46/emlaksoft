import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGACY_HASH_TAB, SETTINGS_TABS, parseSettingsTab, settingsTabHref } from "./tabs";

describe("/app/ayarlar sekmeleri", () => {
  it("bilinmeyen/boş sekme varsayılan kimlik; bağlantı kontratı", () => {
    expect(parseSettingsTab(undefined)).toBe("kimlik");
    expect(parseSettingsTab("yok")).toBe("kimlik");
    expect(parseSettingsTab("eslestirme")).toBe("eslestirme");
    expect(settingsTabHref("kimlik")).toBe("/app/ayarlar");
    expect(settingsTabHref("eslestirme", "eslestirme-agirliklari")).toBe("/app/ayarlar?sekme=eslestirme#eslestirme-agirliklari");
  });

  it("eski çapalar sekmeye bağlı; her çapa kendi sekme dosyasında var", () => {
    const files: Record<string, string> = {
      kimlik: "kimlik-tab.tsx",
      eslestirme: "eslestirme-tab.tsx",
      entegrasyon: "entegrasyon-tab.tsx",
      bildirim: "bildirim-tab.tsx",
    };
    for (const [hash, tab] of Object.entries(LEGACY_HASH_TAB)) {
      expect(SETTINGS_TABS.some((t) => t.id === tab)).toBe(true);
      const src = readFileSync(resolve(process.cwd(), "src/app/app/ayarlar/_sekmeler", files[tab]!), "utf8");
      expect(src, hash).toContain(`id="${hash}"`);
    }
  });
});
