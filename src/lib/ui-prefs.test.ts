import { describe, expect, it } from "vitest";
import { DEFAULT_UI_PREFS, parseUiPrefs, serializeUiPrefs, uiPrefCookieName } from "./ui-prefs";

describe("ui-prefs", () => {
  it("yeni kullanıcıda sade görünüm açık", () => {
    expect(parseUiPrefs(undefined)).toEqual({ simple: true });
    expect(DEFAULT_UI_PREFS).toEqual({ simple: true });
  });

  it("seri hale getirme gidiş-dönüş yapar; bozuk değer varsayılana düşer; eski biçim okunur", () => {
    for (const simple of [true, false]) expect(parseUiPrefs(serializeUiPrefs({ simple }))).toEqual({ simple });
    expect(parseUiPrefs("x.y")).toEqual(DEFAULT_UI_PREFS);
    expect(parseUiPrefs("0.large")).toEqual({ simple: false });
  });

  it("çerez adı ofis+kullanıcı kapsamlıdır ve güvensiz kimliği reddeder", () => {
    const t = "11111111-2222-3333-4444-555555555555";
    const u = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect(uiPrefCookieName(t, u)).toBe(`es_ui_${t}_${u}`);
    expect(uiPrefCookieName(null, u)).toBeNull();
    expect(uiPrefCookieName(t, "a;b=c  ")).toBeNull();
  });
});
