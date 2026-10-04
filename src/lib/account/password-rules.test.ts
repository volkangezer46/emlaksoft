import { describe, expect, it } from "vitest";
import { validateNewPassword } from "./password-rules";

describe("validateNewPassword", () => {
  it("geçerli girdi null döner", () => {
    expect(validateNewPassword({ current: "eski-parola", next: "yeni-parola-1", confirm: "yeni-parola-1" })).toBeNull();
  });
  it("kısa, aynı, eşleşmeyen ve boş mevcut parolayı reddeder", () => {
    expect(validateNewPassword({ current: "", next: "yeni-parola-1", confirm: "yeni-parola-1" })).toMatch(/Mevcut/);
    expect(validateNewPassword({ current: "a", next: "kisa", confirm: "kisa" })).toMatch(/en az 8/);
    expect(validateNewPassword({ current: "aynı-parola1", next: "aynı-parola1", confirm: "aynı-parola1" })).toMatch(/farklı/);
    expect(validateNewPassword({ current: "a", next: "yeni-parola-1", confirm: "baska-parola" })).toMatch(/eşleşmiyor/);
  });
});
