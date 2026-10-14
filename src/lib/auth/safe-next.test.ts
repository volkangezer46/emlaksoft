import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath (tek açık yönlendirme süzgeci)", () => {
  it("uygulama içi göreli yolları korur", () => {
    expect(safeNextPath("/app/musteriler?durum=yeni")).toBe("/app/musteriler?durum=yeni");
    expect(safeNextPath("/app/hesabim#google")).toBe("/app/hesabim#google");
    expect(safeNextPath("/admin")).toBe("/admin");
    expect(safeNextPath("/app/arama-sonuclari?q=%C3%A7ankaya")).toBe("/app/arama-sonuclari?q=%C3%A7ankaya");
  });

  it.each([
    "/\t/evil.com",
    "/\n/x",
    "/\r/evil.com",
    "/%09/evil.com",
    "/%0a/evil.com",
    "/%2F/evil.com",
    "/%5Cevil.com",
    "//evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "app",
    " /app",
    "/app\n/evil",
    "/a\\b",
    "/auth/callback?next=//evil.com",
    "/.//evil.com",
    "/x/..//evil.com",
    "/%2e//evil.com",
    "/%2e%2e//evil.com",
    "/a/%2e%2e//evil.com",
    "/./\\evil.com",
    "",
    null,
    undefined,
  ])("%j → varsayılan", (raw) => {
    expect(safeNextPath(raw as string | null | undefined)).toBe("/app");
  });

  it("aşırı uzun yol reddedilir, fallback değiştirilebilir", () => {
    expect(safeNextPath(`/${"a".repeat(600)}`)).toBe("/app");
    expect(safeNextPath("//evil.com", "/admin")).toBe("/admin");
  });
});

describe("next süzgeci tek kaynak", () => {
  const FILES = [
    "src/app/actions/auth.ts",
    "src/app/giris/page.tsx",
    "src/app/giris/login-form.tsx",
    "src/app/giris/dogrulama/page.tsx",
    "src/app/giris/dogrulama/actions.ts",
    "src/app/giris/iki-adim-kurulum/page.tsx",
    "src/app/giris/iki-adim-kurulum/actions.ts",
  ];

  it("giriş akışında elle yazılmış /^\\/(?![/\\\\])/ deseni kalmadı", () => {
    for (const file of FILES) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/\(\?!\[\/\\\\\]\)/);
    }
  });

  it("next okuyan sunucu dosyaları safeNextPath kullanır", () => {
    for (const file of FILES.filter((f) => !f.endsWith("login-form.tsx"))) {
      expect(readFileSync(file, "utf8"), file).toContain("safeNextPath(");
    }
  });
});
