import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Google OAuth dönüşü: proxy /api/ yolunda oturum çözmez; rota kendi kapısını uygular.
 * Personel olmayan ve super_admin olmayan kullanıcı 403 alır; hiçbir belirteç değişimi/yazma yapılmaz.
 */
const h = vi.hoisted(() => ({
  staff: null as null | { id: string; role: string },
  exchanged: 0,
  saved: 0,
  bindingSession: "session-1",
}));

vi.mock("@/lib/platform", () => ({ getPlatformStaff: async () => h.staff }));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: async () => undefined }));
vi.mock("@/lib/google/db", () => ({ platformSettingsPort: { read: async () => ({}), write: async () => true, remove: async () => true } }));
vi.mock("@/lib/google/oauth", () => ({
  exchangeCode: async () => {
    h.exchanged += 1;
    return { refreshToken: "rt", scope: "s" };
  },
}));
vi.mock("@/lib/google/session", async () => {
  const { createHmac } = await import("node:crypto");
  return {
    GOOGLE_PKCE_COOKIE: "es_google_pkce",
    GOOGLE_CALLBACK_PATH: "/api/admin/google/callback",
    currentSessionBinding: async (staffId: string) => ({ staffId, sessionId: h.bindingSession }),
    googleStateSigner: (i: string) => createHmac("sha256", "k").update(i).digest("base64url"),
  };
});
vi.mock("@/lib/google/token-store", async (orig) => ({
  ...(await orig<typeof import("@/lib/google/token-store")>()),
  readGoogleSnapshot: async () => ({ client: { clientId: "c", clientSecret: "s" }, tokens: { gsc: null, ads: null }, adsAccount: null, gscProperty: null, problems: [] }),
  saveToken: async () => {
    h.saved += 1;
    return true;
  },
}));
vi.mock("@/lib/settings/secrets", async (orig) => ({ ...(await orig<typeof import("@/lib/settings/secrets")>()), secretsWritable: () => true }));

const URL_BASE = "https://emlaksoft.com.tr/api/admin/google/callback";

async function call(query: string, cookie?: string) {
  const { GET } = await import("./route");
  return GET(new NextRequest(`${URL_BASE}?${query}`, { headers: cookie ? { cookie } : {} }));
}

describe("Google OAuth callback kapısı", () => {
  beforeEach(() => {
    h.staff = null;
    h.exchanged = 0;
    h.saved = 0;
    h.bindingSession = "session-1";
  });

  it("personel olmayan kullanıcı: 403", async () => {
    const res = await call("code=x&state=y");
    expect(res.status).toBe(403);
    expect(h.exchanged + h.saved).toBe(0);
  });

  it("super_admin olmayan personel (ops/billing/support): 403", async () => {
    for (const role of ["ops", "billing", "support"]) {
      h.staff = { id: "s1", role };
      const res = await call("code=x&state=y");
      expect(res.status, role).toBe(403);
    }
    expect(h.exchanged + h.saved).toBe(0);
  });

  it("super_admin + geçersiz state: değişim yapılmaz, hata iletisiyle Bağlantılar'a döner", async () => {
    h.staff = { id: "s1", role: "super_admin" };
    const res = await call("code=x&state=bozuk.imza");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/admin/site/baglantilar?hata=");
    expect(h.exchanged).toBe(0);
  });

  it("super_admin + doğru state + PKCE çerezi: belirteç değişimi ve mühürlü kayıt", async () => {
    h.staff = { id: "s1", role: "super_admin" };
    const { signState, createPkceVerifier } = await import("@/lib/google/state");
    const { googleStateSigner } = await import("@/lib/google/session");
    const { now } = await import("@/lib/clock");
    const verifier = createPkceVerifier();
    const state = signState({ binding: { staffId: "s1", sessionId: "session-1" }, service: "gsc", verifier }, now(), googleStateSigner)!;
    const res = await call(`code=kod&state=${encodeURIComponent(state)}`, `es_google_pkce=${verifier}`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("bagli=gsc");
    expect(h.exchanged).toBe(1);
    expect(h.saved).toBe(1);

    // Aynı state başka oturumda: reddedilir.
    h.bindingSession = "session-2";
    const other = await call(`code=kod&state=${encodeURIComponent(state)}`, `es_google_pkce=${verifier}`);
    expect(other.headers.get("location")).toContain("hata=");
    expect(h.exchanged).toBe(1);
  });
});
