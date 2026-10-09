import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTH_VERIFIED_HEADER, userFromClaims } from "./verified-request";

const src = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("proxy doğrulama işareti + yerel JWT (getClaims)", () => {
  it("claims → User yalnız tüketilen alanlar", () => {
    expect(userFromClaims({ sub: "u1", email: "a@b.co", app_metadata: { role: "owner" } })).toMatchObject({ id: "u1", email: "a@b.co", app_metadata: { role: "owner" } });
    expect(userFromClaims({ sub: "" })).toBeNull();
  });

  it("proxy işareti önce siler, yalnız kapılardan sonra koyar; auth-cache işaret yoksa getUser'a düşer", () => {
    const mw = src("src/lib/supabase/middleware.ts");
    const del = mw.indexOf("request.headers.delete(AUTH_VERIFIED_HEADER)");
    const firstNext = mw.indexOf("NextResponse.next({ request })");
    expect(del).toBeGreaterThan(-1);
    expect(del).toBeLessThan(firstNext);
    const set = mw.indexOf("request.headers.set(AUTH_VERIFIED_HEADER");
    expect(set).toBeGreaterThan(mw.indexOf("/giris/dogrulama"));
    expect(set).toBeGreaterThan(mw.indexOf("await supabase.auth.getClaims()"));
    const cache = src("src/lib/supabase/auth-cache.ts");
    expect(cache).toContain("supabase.auth.getClaims()");
    expect(cache).toContain("supabase.auth.getUser()");
    expect(cache).toContain("claims.sub === verifiedId");
    expect(AUTH_VERIFIED_HEADER).toMatch(/^x-/);
  });
});
