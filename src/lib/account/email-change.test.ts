import { describe, expect, it } from "vitest";
import { maskEmail } from "@/lib/account/email-change";

describe("maskEmail", () => {
  it("yerel kısmı gizler, alanı korur", () => {
    expect(maskEmail("ayse@ofis.com.tr")).toBe("a***@ofis.com.tr");
  });
  it("geçersiz girdide tamamen gizler", () => {
    expect(maskEmail("yok")).toBe("***");
  });
});
