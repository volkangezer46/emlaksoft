import { describe, expect, it } from "vitest";
import { turkishValidityMessage, type ValidityFlags } from "./form-validity";

const ok: ValidityFlags = {
  valueMissing: false,
  typeMismatch: false,
  patternMismatch: false,
  tooShort: false,
  tooLong: false,
  rangeUnderflow: false,
  rangeOverflow: false,
  stepMismatch: false,
  badInput: false,
};
const f = (type: string, flags: Partial<ValidityFlags>, extra: Partial<Parameters<typeof turkishValidityMessage>[0]> = {}) =>
  turkishValidityMessage({ type, validity: { ...ok, ...flags }, value: "", ...extra });

describe("turkishValidityMessage — tarayıcı dilinden bağımsız Türkçe ileti", () => {
  it("zorunlu alan türüne göre", () => {
    expect(f("text", { valueMissing: true })).toBe("Bu alan zorunlu.");
    expect(f("textarea", { valueMissing: true })).toBe("Bu alan zorunlu.");
    expect(f("checkbox", { valueMissing: true })).toBe("Devam etmek için bu kutuyu işaretleyin.");
    expect(f("select-one", { valueMissing: true })).toBe("Lütfen bir seçim yapın.");
    expect(f("radio", { valueMissing: true })).toBe("Lütfen bir seçim yapın.");
  });
  it("biçim ve aralık", () => {
    expect(f("email", { typeMismatch: true })).toMatch(/^Geçerli bir e-posta/);
    expect(f("text", { patternMismatch: true }, { value: "   " })).toBe("Bu alan zorunlu.");
    expect(f("text", { patternMismatch: true }, { value: "ab", title: "Yalnız rakam" })).toBe("Yalnız rakam");
    expect(f("text", { tooShort: true }, { minLength: 3 })).toBe("En az 3 karakter girin.");
    expect(f("number", { rangeUnderflow: true }, { min: "1" })).toBe("Değer en az 1 olmalı.");
    expect(f("number", { rangeOverflow: true }, { max: "9" })).toBe("Değer en çok 9 olabilir.");
  });
  it("geçerli alanda null (tarayıcı iletisine dokunulmaz)", () => {
    expect(f("text", {})).toBeNull();
  });
});
