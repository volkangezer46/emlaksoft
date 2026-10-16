import { describe, expect, it } from "vitest";
import { DEFAULT_UI_PREFS, isSmallOffice, parseUiPrefs, resolveUiPrefs, serializeUiPrefs, uiPrefCookieName } from "./ui-prefs";

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

describe("sade mod varsayılanı (resolveUiPrefs + küçük ofis kuralı)", () => {
  it("açık çerez her zaman geçer (Tüm özellikleri göster tek anahtar)", () => {
    expect(resolveUiPrefs("0", { management: false, smallOffice: true })).toEqual({ simple: false });
    expect(resolveUiPrefs("1", { management: true, smallOffice: false })).toEqual({ simple: true });
  });
  it("çerez yoksa: danışman ve küçük ofis sahibi sade, büyük ofis yönetimi tam", () => {
    expect(resolveUiPrefs(undefined, { management: false, smallOffice: false })).toEqual({ simple: true });
    expect(resolveUiPrefs(undefined, { management: true, smallOffice: true })).toEqual({ simple: true });
    expect(resolveUiPrefs(undefined, { management: true, smallOffice: false })).toEqual({ simple: false });
  });
  it("küçük ofis: en çok 5 kişi ve şube yok; bilinmiyorsa küçük", () => {
    expect(isSmallOffice({ seats: 5, branches: 0 })).toBe(true);
    expect(isSmallOffice({ seats: 6, branches: 0 })).toBe(false);
    expect(isSmallOffice({ seats: 2, branches: 1 })).toBe(false);
    expect(isSmallOffice(null)).toBe(true);
  });
});
