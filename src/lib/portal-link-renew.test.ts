import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PORTAL_TOKEN_RE } from "./portal-link-renew";

/** PUB-7: süresi dolmuş portal bağlantısı çıkmaz sokak değil; bilinmeyen token yine gerçek 404. */
describe("süresi dolmuş portal bağlantısı", () => {
  it("token biçimi 64 hex (gen_random_bytes(32) hex)", () => {
    expect(PORTAL_TOKEN_RE.test("a".repeat(64))).toBe(true);
    expect(PORTAL_TOKEN_RE.test("a".repeat(63))).toBe(false);
    expect(PORTAL_TOKEN_RE.test("../" + "a".repeat(61))).toBe(false);
  });

  for (const [file, kind] of [
    ["src/app/musteri-portali/[token]/page.tsx", "customer"],
    ["src/app/malik-portali/[token]/page.tsx", "owner"],
  ] as const) {
    it(`${file}: süresi dolmuşta yenileme ekranı, bilinmeyende notFound()`, () => {
      const src = readFileSync(file, "utf8");
      expect(src).toContain(`loadExpiredPortalLink("${kind}", token`);
      expect(src).toContain("<ExpiredPortalLinkScreen");
      expect(src).toMatch(/if \(expired\) return <ExpiredPortalLinkScreen[^\n]*\n\s*notFound\(\);/);
    });
  }

  it("eylem: hız sınırı kapalı başarısız, yanıt token geçerliliğini ele vermez, danışmana görev + bildirim", () => {
    const src = readFileSync("src/app/actions/portal-link-renew.ts", "utf8");
    expect(src).toContain('`portal-renew:ip:${ip}`');
    expect(src).toContain("`portal-renew:token:${kind}:${t}`");
    expect(src.match(/failurePolicy: "deny"/g)?.length).toBe(2);
    expect(src).toContain('from("tasks")');
    expect(src).toContain("notifyTenant(");
    expect(src).toContain("dedupeKey");
    // Geçersiz token da aynı yanıtı alır.
    expect(src).toMatch(/if \(!PORTAL_TOKEN_RE\.test\(t\)\) return SENT;/);
    expect(src).toMatch(/if \(!link \|\| !link\.advisorId\) return SENT;/);
  });

  it("ekran kişisel veri basmaz (yalnız ofis kimliği)", () => {
    const src = readFileSync("src/components/public/expired-portal-link.tsx", "utf8");
    expect(src).not.toMatch(/customerId|propertyId|advisorId|full_name|owner_name/);
  });
});
