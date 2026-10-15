import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_VERIFIED_HEADER,
  FALLBACK_CACHE_MAX_MS,
  expectedJwtIssuers,
  peekVerifiedUserId,
  readVerifiedIdentity,
  readVerifiedRequest,
  resetVerifiedTokenCache,
  signVerifiedIdentity,
  supabaseJwtSecret,
  userFromClaims,
  verifyAccessToken,
  verifyHs256Jwt,
  type AuthVerifier,
} from "./verified-request";
import { TEST_JWT_SECRET, signTestAccessToken } from "./test-support";

const src = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const NOW = 1_800_000_000_000;
const nowSec = Math.floor(NOW / 1000);
const ISS = { list: ["https://db.example.test/auth/v1"], allowMissing: true };

function fakeAuth(userId: string | null = "u1"): AuthVerifier & { getUser: ReturnType<typeof vi.fn>; getClaims: ReturnType<typeof vi.fn> } {
  return {
    getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null }, error: userId ? null : { message: "invalid" } })),
    getClaims: vi.fn(async (jwt?: string) => ({ data: { claims: JSON.parse(atob((jwt ?? "").split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) }, error: null })),
  };
}

describe("claims → User", () => {
  it("yalnız tüketilen alanlar; sub yoksa null", () => {
    expect(userFromClaims({ sub: "u1", email: "a@b.co", app_metadata: { role: "owner" } })).toMatchObject({ id: "u1", email: "a@b.co", app_metadata: { role: "owner" } });
    expect(userFromClaims({ sub: "" })).toBeNull();
  });
});

describe("HS256 yerel doğrulama (SK1/B019)", () => {
  it("geçerli belirteç: imza + exp + aud + role + sub + iss", async () => {
    const t = await signTestAccessToken({ sub: "u1", session_id: "s1", iss: ISS.list[0] }, { nowSec });
    const r = await verifyHs256Jwt(t, TEST_JWT_SECRET, { nowMs: NOW, issuers: ISS });
    expect(r).toMatchObject({ ok: true, claims: { sub: "u1", session_id: "s1" } });
  });

  it("iss taşımayan belirteç (self-hosted GoTrue) yalnız açık iss listesi yoksa geçer", async () => {
    const t = await signTestAccessToken({ sub: "u1" }, { nowSec });
    expect((await verifyHs256Jwt(t, TEST_JWT_SECRET, { nowMs: NOW, issuers: ISS })).ok).toBe(true);
    expect(await verifyHs256Jwt(t, TEST_JWT_SECRET, { nowMs: NOW, issuers: { list: ["x"], allowMissing: false } })).toEqual({ ok: false, reason: "issuer" });
  });

  it("ret nedenleri: imza, süre, aud, role, sub, alg, biçim, iss", async () => {
    const ok = { sub: "u1" };
    const cases: Array<[string, Promise<string>, string]> = [
      ["signature", signTestAccessToken(ok, { nowSec, secret: "baska-sir-0123456789abcdef" }), "signature"],
      ["expired", signTestAccessToken({ ...ok, exp: nowSec - 1 }, { nowSec }), "expired"],
      ["audience", signTestAccessToken({ ...ok, aud: "service" }, { nowSec }), "audience"],
      ["role anon", signTestAccessToken({ ...ok, role: "anon" }, { nowSec }), "role"],
      ["role service", signTestAccessToken({ ...ok, role: "service_role" }, { nowSec }), "role"],
      ["sub", signTestAccessToken({ sub: "" }, { nowSec }), "subject"],
      ["alg", signTestAccessToken(ok, { nowSec, header: { alg: "HS512", typ: "JWT" } }), "alg"],
      ["iss", signTestAccessToken({ ...ok, iss: "https://evil.test" }, { nowSec }), "issuer"],
    ];
    for (const [name, tokenP, reason] of cases) {
      expect(await verifyHs256Jwt(await tokenP, TEST_JWT_SECRET, { nowMs: NOW, issuers: ISS }), name).toEqual({ ok: false, reason });
    }
    expect(await verifyHs256Jwt("a.b", TEST_JWT_SECRET, { nowMs: NOW, issuers: ISS })).toEqual({ ok: false, reason: "malformed" });
    // alg=none / imzasız belirteç
    const [h, p] = (await signTestAccessToken(ok, { nowSec })).split(".");
    expect((await verifyHs256Jwt(`${h}.${p}.`, TEST_JWT_SECRET, { nowMs: NOW, issuers: ISS })).ok).toBe(false);
  });

  it("beklenen iss: açık liste ya da Supabase kökü + /auth/v1", () => {
    expect(expectedJwtIssuers({ SUPABASE_JWT_ISSUER: "a, b" })).toEqual({ list: ["a", "b"], allowMissing: false });
    expect(expectedJwtIssuers({ NEXT_PUBLIC_SUPABASE_URL: "https://db.x.test/" })).toEqual({
      list: ["https://db.x.test", "https://db.x.test/auth/v1"],
      allowMissing: true,
    });
  });

  it("sır yalnız sunucu ortamından ve en az 16 karakter", () => {
    expect(supabaseJwtSecret({ SUPABASE_JWT_SECRET: "kisa" })).toBeNull();
    expect(supabaseJwtSecret({ SUPABASE_JWT_SECRET: ` ${TEST_JWT_SECRET} ` })).toBe(TEST_JWT_SECRET);
    expect(supabaseJwtSecret({ NEXT_PUBLIC_SUPABASE_JWT_SECRET: TEST_JWT_SECRET })).toBeNull();
  });
});

describe("verifyAccessToken: yerel → JWKS → önbellekli ağ yedeği", () => {
  beforeEach(() => {
    resetVerifiedTokenCache();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.test");
  });

  it("HS256 + sır: ağ turu YOK", async () => {
    const auth = fakeAuth();
    const t = await signTestAccessToken({ sub: "u1" }, { nowSec });
    expect(await verifyAccessToken(auth, t, { nowMs: NOW, secret: TEST_JWT_SECRET })).toMatchObject({ via: "local", claims: { sub: "u1" } });
    expect(auth.getUser).not.toHaveBeenCalled();
    expect(auth.getClaims).not.toHaveBeenCalled();
  });

  it("yerel imza/süre hatası ağ yoluna DÜŞMEZ", async () => {
    const auth = fakeAuth();
    const bad = await signTestAccessToken({ sub: "u1" }, { nowSec, secret: "baska-sir-0123456789abcdef" });
    expect(await verifyAccessToken(auth, bad, { nowMs: NOW, secret: TEST_JWT_SECRET })).toBeNull();
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("beklenmeyen iss: kesinti yerine ağ doğrulamasına düşer", async () => {
    const auth = fakeAuth();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const t = await signTestAccessToken({ sub: "u1", iss: "https://baska-kok.test/auth/v1" }, { nowSec });
    expect(await verifyAccessToken(auth, t, { nowMs: NOW, secret: TEST_JWT_SECRET })).toMatchObject({ via: "network" });
    expect(auth.getUser).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("asimetrik (ES256): getClaims(token) ile JWKS yerel doğrulaması", async () => {
    const auth = fakeAuth();
    const t = await signTestAccessToken({ sub: "u1" }, { nowSec, header: { alg: "ES256", kid: "k1" } });
    expect(await verifyAccessToken(auth, t, { nowMs: NOW, secret: TEST_JWT_SECRET })).toMatchObject({ via: "jwks" });
    expect(auth.getClaims).toHaveBeenCalledWith(t);
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("sır yok: getUser sonucu belirteç özetiyle min(exp, 60 sn) önbellekte", async () => {
    const auth = fakeAuth();
    const t = await signTestAccessToken({ sub: "u1" }, { nowSec });
    expect(await verifyAccessToken(auth, t, { nowMs: NOW, secret: null })).toMatchObject({ via: "network" });
    expect(await verifyAccessToken(auth, t, { nowMs: NOW + 59_000, secret: null })).toMatchObject({ via: "cache" });
    expect(auth.getUser).toHaveBeenCalledTimes(1);
    // 60 sn sonra yeniden ağ: iptal edilen oturum en geç bu kadar sonra reddedilir.
    auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "session_not_found" } });
    expect(await verifyAccessToken(auth, t, { nowMs: NOW + FALLBACK_CACHE_MAX_MS + 1, secret: null })).toBeNull();
    expect(auth.getUser).toHaveBeenCalledTimes(2);
  });

  it("önbellek süresi belirtecin exp'ini aşmaz; süresi dolmuş belirteç ağa hiç gitmez", async () => {
    const auth = fakeAuth();
    const t = await signTestAccessToken({ sub: "u1", exp: nowSec + 10 }, { nowSec });
    await verifyAccessToken(auth, t, { nowMs: NOW, secret: null });
    expect(await verifyAccessToken(auth, t, { nowMs: NOW + 11_000, secret: null })).toBeNull();
    expect(auth.getUser).toHaveBeenCalledTimes(1);
  });

  it("mode=network (proxy dışı yollar) yerel doğrulamayı atlar; ağ kullanıcısı sub ile eşleşmezse ret", async () => {
    const t = await signTestAccessToken({ sub: "u1" }, { nowSec });
    const auth = fakeAuth("u2");
    expect(await verifyAccessToken(auth, t, { nowMs: NOW, secret: TEST_JWT_SECRET, mode: "network" })).toBeNull();
    expect(auth.getUser).toHaveBeenCalledTimes(1);
  });
});

describe("imzalı iç başlık", () => {
  const env = { SUPABASE_JWT_SECRET: TEST_JWT_SECRET };
  const claims = { sub: "u1", exp: nowSec + 600, session_id: "s1", app_metadata: { tenant_id: "t1", role: "owner" }, aal: "aal1" };

  it("gidiş-dönüş: claim'ler ve proxy olgusu aynen", async () => {
    const v = await signVerifiedIdentity(claims, { staff: false }, env);
    expect(v.startsWith("v1.")).toBe(true);
    expect(await readVerifiedRequest(v, NOW, env)).toEqual({ claims, facts: { staff: false } });
    expect(await readVerifiedIdentity(v, NOW, env)).toEqual(claims);
    expect(peekVerifiedUserId(v)).toBe("u1");
  });

  it("kurcalanmış, başka anahtarla imzalı, süresi dolmuş ya da imzasız başlık kimlik sayılmaz", async () => {
    const v = await signVerifiedIdentity(claims, {}, env);
    const [, payload, mac] = v.split(".");
    const forged = JSON.parse(atob(payload!.replace(/-/g, "+").replace(/_/g, "/")));
    forged.c.sub = "admin";
    const forgedPayload = btoa(JSON.stringify(forged)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await readVerifiedRequest(`v1.${forgedPayload}.${mac}`, NOW, env)).toBeNull();
    expect(await readVerifiedRequest(v, NOW, { SUPABASE_JWT_SECRET: "baska-sir-0123456789abcdef" })).toBeNull();
    expect(await readVerifiedRequest(v, (nowSec + 601) * 1000, env)).toBeNull();
    expect(await readVerifiedRequest(`${v}.ek`, NOW, env)).toBeNull();
    expect(await readVerifiedRequest("v0.u1", NOW, env)).toBeNull();
    expect(await readVerifiedRequest("u1", NOW, env)).toBeNull();
  });

  it("anahtar yoksa v0 (yalnız proxy içi boşta kalma politikası okur; sunucu kimlik saymaz)", async () => {
    const v = await signVerifiedIdentity(claims, {}, {});
    expect(v).toBe("v0.u1");
    expect(peekVerifiedUserId(v)).toBe("u1");
    expect(await readVerifiedRequest(v, NOW, {})).toBeNull();
  });

  it("anahtar sır kaynağından alan-ayrımlı türetilir (ham sır başlık imzası değildir)", async () => {
    const v = await signVerifiedIdentity(claims, {}, env);
    const [, payload, mac] = v.split(".");
    const raw = await crypto.subtle.importKey("raw", new TextEncoder().encode(TEST_JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const direct = new Uint8Array(await crypto.subtle.sign("HMAC", raw, new TextEncoder().encode(`v1.${payload}`)));
    let bin = "";
    for (const b of direct) bin += String.fromCharCode(b);
    expect(btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")).not.toBe(mac);
  });
});

describe("kaynak sözleşmesi", () => {
  it("proxy işareti önce siler, yalnız kapılardan (oturum canlılığı + 2FA) sonra imzalı koyar", () => {
    const mw = src("src/lib/supabase/middleware.ts");
    const del = mw.indexOf("request.headers.delete(AUTH_VERIFIED_HEADER)");
    const firstNext = mw.indexOf("NextResponse.next({ request })");
    expect(del).toBeGreaterThan(-1);
    expect(del).toBeLessThan(firstNext);
    const set = mw.indexOf("request.headers.set(AUTH_VERIFIED_HEADER, await signVerifiedIdentity(");
    expect(set).toBeGreaterThan(mw.indexOf("/giris/dogrulama"));
    expect(set).toBeGreaterThan(mw.indexOf("gate.sessionAlive === false"));
    expect(mw).not.toContain("auth.getClaims()");
    expect(mw).not.toContain("auth.getUser()");
    expect(mw).not.toMatch(/ES256 yerel, ağ turu yok/);
    expect(AUTH_VERIFIED_HEADER).toMatch(/^x-/);
  });

  it("auth-cache başlığı imzasıyla okur; yoksa önbellekli ağ yedeği (getClaims yok)", () => {
    const cache = src("src/lib/supabase/auth-cache.ts");
    expect(cache).toContain("readVerifiedRequest(");
    expect(cache).toContain('mode: "network"');
    expect(cache).not.toContain("auth.getClaims(");
    const platform = src("src/lib/platform.ts");
    const expired = platform.slice(platform.indexOf("export const isPlatformSessionExpired"), platform.indexOf("export const getPlatformStaff ="));
    expect(expired).toContain("getRequestClaims()");
    expect(expired).not.toContain("getClaims(");
  });

  it("SUPABASE_JWT_SECRET hiçbir istemci dosyasında ve NEXT_PUBLIC olarak geçmez", () => {
    const vr = src("src/lib/supabase/verified-request.ts");
    expect(vr).not.toContain('"use client"');
    expect(vr).not.toMatch(/NEXT_PUBLIC_SUPABASE_JWT_SECRET/);
  });
});
