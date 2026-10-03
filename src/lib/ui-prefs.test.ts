import { describe, expect, it } from "vitest";
import { DEFAULT_UI_PREFS, parseUiPrefs, serializeUiPrefs, uiPrefCookieName, uiPrefsCss } from "./ui-prefs";

describe("ui-prefs", () => {
  it("yeni kullanıcıda sade görünüm açık ve yazı Büyük", () => {
    expect(parseUiPrefs(undefined)).toEqual({ simple: true, font: "large" });
    expect(DEFAULT_UI_PREFS).toEqual({ simple: true, font: "large" });
  });

  it("seri hale getirme gidiş-dönüş yapar; bozuk değer varsayılana düşer", () => {
    for (const simple of [true, false]) for (const font of ["normal", "large", "xlarge"] as const) {
      expect(parseUiPrefs(serializeUiPrefs({ simple, font }))).toEqual({ simple, font });
    }
    expect(parseUiPrefs("x.y")).toEqual(DEFAULT_UI_PREFS);
    expect(parseUiPrefs("0.zzz")).toEqual({ simple: false, font: "large" });
  });

  it("çerez adı ofis+kullanıcı kapsamlıdır ve güvensiz kimliği reddeder", () => {
    const t = "11111111-2222-3333-4444-555555555555";
    const u = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect(uiPrefCookieName(t, u)).toBe(`es_ui_${t}_${u}`);
    expect(uiPrefCookieName(null, u)).toBeNull();
    expect(uiPrefCookieName(t, "a;b=c  ")).toBeNull();
  });

  it("yazı ölçeği CSS'i: normalde boş, büyükte %112,5, çok büyükte %125 ve 44px hedef", () => {
    expect(uiPrefsCss("normal")).toBe("");
    expect(uiPrefsCss("large")).toContain("html{font-size:112.5%}");
    expect(uiPrefsCss("xlarge")).toContain("html{font-size:125%}");
    expect(uiPrefsCss("large")).toContain("min-height:44px");
  });
});
