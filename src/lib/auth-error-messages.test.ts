import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { authErrorMessage } from "@/lib/action-errors";

const ENGLISH = /\b(invalid|expired|failed|error|please|not found|the|session missing|credentials|confirmed)\b/i;

describe("authErrorMessage (giriş / 2FA hata metinleri)", () => {
  const cases: Array<[string, unknown]> = [
    ["invalid_credentials kodu", { code: "invalid_credentials", message: "Invalid login credentials" }],
    ["e-posta doğrulanmamış", { code: "email_not_confirmed", message: "Email not confirmed" }],
    ["TOTP hatalı", { code: "mfa_verification_failed", message: "Invalid TOTP code entered" }],
    ["MFA challenge süresi", { message: "MFA challenge has expired" }],
    ["faktör yok", { message: "MFA factor not found" }],
    ["aynı şifre", { code: "same_password", message: "New password should be different from the old password." }],
    ["oturum yok", { message: "Auth session missing!" }],
    ["ağ", new TypeError("Failed to fetch")],
    ["bilinmeyen İngilizce", new Error("Something odd happened in gotrue")],
    ["null", null],
  ];

  for (const [name, err] of cases) {
    it(`${name}: Türkçe ve ham metin sızmaz`, () => {
      const out = authErrorMessage(err, "Kod doğrulanamadı");
      expect(out.length).toBeGreaterThan(10);
      expect(out).not.toMatch(ENGLISH);
      const raw = (err as { message?: string } | null)?.message;
      if (raw) expect(out).not.toContain(raw);
    });
  }

  it("bilinen hatalar özel Türkçe cümleye çevrilir", () => {
    expect(authErrorMessage({ message: "Invalid login credentials" })).toContain("E-posta veya şifre hatalı");
    expect(authErrorMessage({ message: "Invalid TOTP code" })).toContain("Doğrulama kodu hatalı");
  });

  it("2FA formu ham error.message göstermez", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/giris/mfa/totp-core.tsx"), "utf8");
    expect(src).not.toMatch(/cause instanceof Error \? cause\.message/);
    expect(src).toContain("authErrorMessage(");
  });
});
