import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { policyFromSettingRows } from "./policy";

/**
 * DG7 proxy kapısı (gerçek updateSession): 2FA zorunlu rolde kurmamış kullanıcı kurulum ekranına; izinsiz IP'de oturum
 * kapatılır; politika yokken davranış bugünküyle aynı (ek okuma/çerez yok); destek oturumu ve platform personeli muaf.
 */
const state = vi.hoisted(() => ({
  rows: [] as { key: string; value: unknown }[],
  policyCalls: 0,
  signOut: 0,
  profile: null as Record<string, unknown> | null,
  user: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/platform-flags-cache", async (orig) => {
  const actual = await orig<typeof import("@/lib/platform-flags-cache")>();
  return { ...actual, readPlatformFlagsCached: async () => ({ maintenanceMode: false, maintenanceMessage: "", registrationOpen: true }) };
});

vi.mock("./policy-cache", () => ({
  readOfficeSecurityPolicyCached: vi.fn(async () => {
    state.policyCalls += 1;
    return state.rows.length ? policyFromSettingRows(state.rows) : null;
  }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: { setAll: (c: { name: string; value: string; options?: object }[]) => void } }) => ({
    auth: {
      getClaims: async () =>
        state.user
          ? { data: { claims: { sub: state.user.id, app_metadata: state.user.app_metadata, session_id: "s1" } }, error: null }
          : { data: null, error: null },
      signOut: async () => {
        state.signOut += 1;
        opts.cookies.setAll([{ name: "sb-x-auth-token", value: "", options: { maxAge: 0 } }]);
        return {};
      },
    },
    rpc: async () => ({ data: { profile: state.profile, staff: false, tenant_status: "active" }, error: null }),
    from: () => {
      throw new Error("beklenmeyen tablo okuması");
    },
  }),
}));

import { updateSession } from "@/lib/supabase/middleware";
import { resetRpcProbes } from "@/lib/supabase/rpc-probe";

function req(path: string, ip = "198.51.100.7") {
  return new NextRequest(new URL(`https://emlaksoft.test${path}`), { headers: { "x-real-ip": ip } });
}
const advisorProfile = { tenant_id: "t1", role: "advisor", is_active: true, two_factor_sms: false, phone: null, two_factor_version: 1 };

describe("DG7 ofis güvenlik politikası (proxy)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "dummy");
    vi.stubEnv("TWO_FACTOR_COOKIE_SECRET", "x".repeat(40));
    resetRpcProbes();
    state.rows = [];
    state.policyCalls = 0;
    state.signOut = 0;
    state.user = { id: "u1", app_metadata: { tenant_id: "t1", role: "advisor" } };
    state.profile = advisorProfile;
    delete process.env.OFFICE_IP_ALLOWLIST;
  });

  it("politika yokken geçer; yönlendirme, oturum kapatma ve etkinlik çerezi yok", async () => {
    const res = await updateSession(req("/app/musteriler"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get("es_app_seen")).toBeUndefined();
    expect(state.signOut).toBe(0);
  });

  it("2FA zorunlu rolde kurmamış kullanıcı kurulum ekranına (server action POST dahil)", async () => {
    state.rows = [{ key: "office.security.mfa_roles", value: "advisor" }];
    const res = await updateSession(req("/app/musteriler"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/giris/iki-adim-kurulum?next=%2Fapp%2Fmusteriler");
    const post = await updateSession(new NextRequest(new URL("https://emlaksoft.test/app/musteriler"), { method: "POST" }));
    expect(post.headers.get("location")).toContain("/giris/iki-adim-kurulum");
    // Başka rol etkilenmez; 2FA'sı açık kullanıcı normal SMS doğrulamasına gider (kurulum değil).
    state.profile = { ...advisorProfile, role: "gm" };
    state.user = { id: "u1", app_metadata: { tenant_id: "t1", role: "gm" } };
    expect((await updateSession(req("/app"))).headers.get("location")).toBeNull();
    state.profile = { ...advisorProfile, two_factor_sms: true };
    state.user = { id: "u1", app_metadata: { tenant_id: "t1", role: "advisor" } };
    expect((await updateSession(req("/app"))).headers.get("location")).toContain("/giris/dogrulama");
  });

  it("izinsiz IP'de oturum kapatılır ve auth çerezleri temizlenir; izinli IP geçer", async () => {
    state.rows = [{ key: "office.security.ip_allowlist", value: "198.51.100.0/24" }];
    const blocked = await updateSession(req("/app/musteriler", "203.0.113.9"));
    expect(blocked.headers.get("location")).toContain("/giris?reason=office_ip");
    expect(state.signOut).toBe(1);
    expect(blocked.cookies.get("sb-x-auth-token")?.value).toBe("");
    expect((await updateSession(req("/app/musteriler", "198.51.100.20"))).headers.get("location")).toBeNull();
  });

  it("sahip muafiyeti ve acil kapatma (OFFICE_IP_ALLOWLIST=off) kilitlenmeyi önler", async () => {
    state.rows = [{ key: "office.security.ip_allowlist", value: "198.51.100.0/24" }];
    state.profile = { ...advisorProfile, role: "owner" };
    state.user = { id: "u1", app_metadata: { tenant_id: "t1", role: "owner" } };
    expect((await updateSession(req("/app", "203.0.113.9"))).headers.get("location")).toBeNull();
    state.rows.push({ key: "office.security.ip_owner_exempt", value: "off" });
    expect((await updateSession(req("/app", "203.0.113.9"))).headers.get("location")).toContain("reason=office_ip");
    process.env.OFFICE_IP_ALLOWLIST = "off";
    expect((await updateSession(req("/app", "203.0.113.9"))).headers.get("location")).toBeNull();
  });

  it("boşta kalma açıkken etkinlik çerezi yazılır", async () => {
    state.rows = [{ key: "office.security.idle_minutes", value: "15" }];
    const res = await updateSession(req("/app"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get("es_app_seen")?.value).toMatch(/^v1\.u1\./);
  });

  it("destek oturumu (impersonation) politikadan muaf; politika okunmaz", async () => {
    state.rows = [{ key: "office.security.mfa_roles", value: "readonly" }];
    state.user = { id: "staff1", app_metadata: { tenant_id: "t1", role: "readonly", impersonating: true } };
    state.profile = null;
    await updateSession(req("/app"));
    expect(state.policyCalls).toBe(0);
  });
});
