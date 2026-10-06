import { describe, expect, it } from "vitest";
import { wantsDigest } from "./digest-prefs";

describe("wantsDigest", () => {
  it("tercih yoksa ofis varsayılanı (kayıt yoksa açık)", () => {
    expect(wantsDigest(null)).toBe(true);
    expect(wantsDigest(null, false)).toBe(false);
    expect(wantsDigest({}, false)).toBe(false);
  });
  it("kullanıcının kayıtlı tercihi ofis varsayılanını ezer", () => {
    expect(wantsDigest({ digest: true }, false)).toBe(true);
    expect(wantsDigest({ digest: false }, true)).toBe(false);
  });
  it("bozuk değer ofis varsayılanına düşer", () => {
    expect(wantsDigest({ digest: "evet" }, false)).toBe(false);
  });
});
