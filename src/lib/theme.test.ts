import { describe, expect, it } from "vitest";
import {
  ACCENT_VALUES,
  THEME_STORAGE_KEY,
  isAccentPref,
  isThemePref,
  isThemedPath,
  resolveTheme,
} from "./theme";
import { ACCENTS, THEME_BOOT_SCRIPT } from "./theme-catalog";

describe("theme", () => {
  it("sistem tercihini işletim sistemine göre çözer", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("açık/koyu tercih sistemi yok sayar", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("yalnız /app ve /admin temalanır; public sayfalar açık kalır", () => {
    expect(isThemedPath("/app")).toBe(true);
    expect(isThemedPath("/app/musteriler")).toBe(true);
    expect(isThemedPath("/admin/tickets")).toBe(true);
    expect(isThemedPath("/")).toBe(false);
    expect(isThemedPath("/vitrin/demo")).toBe(false);
    expect(isThemedPath("/application")).toBe(false);
    expect(isThemedPath("/musteri-portali/abc")).toBe(false);
  });

  it("geçersiz tercih değerlerini reddeder", () => {
    expect(isThemePref("dark")).toBe(true);
    expect(isThemePref("blue")).toBe(false);
    expect(isThemePref(null)).toBe(false);
  });

  it("vurgu değer listesi katalogla aynıdır (istemci kabuğu yalnız değerleri taşır)", () => {
    expect(ACCENTS.map((a) => a.value)).toEqual([...ACCENT_VALUES]);
    for (const v of ACCENT_VALUES) expect(isAccentPref(v)).toBe(true);
    expect(isAccentPref("blue")).toBe(false);
  });

  it("açılış script'i aynı depolama anahtarını ve yol kuralını kullanır", () => {
    expect(THEME_BOOT_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_BOOT_SCRIPT).toContain("(app|admin)");
    expect(() => new Function(THEME_BOOT_SCRIPT)).not.toThrow();
  });
});
