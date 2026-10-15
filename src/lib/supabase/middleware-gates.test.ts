import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUser = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());
const fromSpy = vi.hoisted(() => vi.fn());
const mode = vi.hoisted(() => ({ rpc: "ok" as "ok" | "missing" | "error" | "garbage" }));
const db = vi.hoisted(() => ({
  user: null as { id: string; app_metadata: Record<string, unknown> } | null,
  staff: null as { id: string } | null,
  profile: null as Record<string, unknown> | null,
  tenant: { status: "active" } as { status: string } | null,
  claims: { session_id: "s1" } as Record<string, unknown>,
  sessionAlive: true as boolean | null,
  staffAccess: { role: "super_admin", custom_role_id: null, custom_role: null } as Record<string, unknown> | null,
}));

vi.mock("@/lib/platform-flags-cache", async (orig) => {
  const actual = await orig<typeof import("@/lib/platform-flags-cache")>();
  return {
    ...actual,
    readPlatformFlagsCached: async () => ({ maintenanceMode: false, maintenanceMessage: "", registrationOpen: true }),
  };
});

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      // getUser = Auth sunucusuna AĞ TURU (/auth/v1/user). Yerel doğrulamada proxy bunu ÇAĞIRMAZ (SK1/B019).
      getUser,
      // Oturum çerezden: testin kullanıcısından HS256 imzalı belirteç (gerçek yerel doğrulama yolu çalışır).
      getSession: async () => {
        const { testSessionFor } = await import("@/lib/supabase/test-support");
        return testSessionFor(db.user, db.claims);
      },
      getClaims: async () => {
        throw new Error("proxy getClaims çağırmamalı (HS256'da /auth/v1/user turuna düşer)");
      },
      signOut: async () => ({}),
    },
    rpc: async (name: string, args: unknown) => {
      rpcMock(name, args);
      if (mode.rpc === "missing") return { data: null, error: { code: "PGRST202", message: "not found" } };
      if (mode.rpc === "error") return { data: null, error: { code: "57014", message: "timeout" } };
      if (mode.rpc === "garbage") return { data: "x", error: null };
      return {
        data: {
          profile: db.profile,
          staff: Boolean(db.staff),
          tenant_status: db.tenant?.status ?? null,
          session_alive: db.sessionAlive,
          staff_access: db.staff ? db.staffAccess : null,
        },
        error: null,
      };
    },
    from: (table: string) => {
      fromSpy(table);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({
        data: table === "profiles" ? db.profile : table === "platform_staff" ? db.staff : db.tenant,
        error: null,
      });
      return chain;
    },
  }),
}));

import { updateSession } from "@/lib/supabase/middleware";
import { resetRpcProbes } from "@/lib/supabase/rpc-probe";
import { adminDeniedHref, adminPathModule } from "@/lib/supabase/proxy-gates";
import { AUTH_VERIFIED_HEADER, readVerifiedRequest, resetVerifiedTokenCache } from "@/lib/supabase/verified-request";
import { TEST_JWT_SECRET } from "@/lib/supabase/test-support";
import { now } from "@/lib/clock";

function req(path: string, init?: { method?: string }) {
  return new NextRequest(new URL(`https://emlaksoft.test${path}`), init);
}
const tenantUser = { id: "u1", app_metadata: { tenant_id: "t1", role: "owner" } };
const staffUser = { id: "u1", app_metadata: {} };
const activeProfile = { tenant_id: "t1", role: "owner", is_active: true, two_factor_sms: false, phone: null, two_factor_version: 1 };

function resetState(rpc: typeof mode.rpc) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "dummy");
  vi.stubEnv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET);
  resetRpcProbes();
  resetVerifiedTokenCache();
  mode.rpc = rpc;
  rpcMock.mockReset();
  fromSpy.mockReset();
  getUser.mockReset();
  getUser.mockImplementation(async () => ({ data: { user: db.user }, error: null }));
  db.user = tenantUser;
  db.staff = null;
  db.profile = activeProfile;
  db.tenant = { status: "active" };
  db.claims = { session_id: "s1" };
  db.sessionAlive = true;
  db.staffAccess = { role: "super_admin", custom_role_id: null, custom_role: null };
}

for (const rpc of ["ok", "missing", "error", "garbage"] as const) {
  describe(`proxy kapıları (RPC modu: ${rpc})`, () => {
    beforeEach(() => resetState(rpc));

    it("aktif ofis kullanıcısı /app'e geçer; JWT yerelde doğrulanır (Auth sunucusuna tur yok)", async () => {
      const r = req("/app/musteriler");
      const res = await updateSession(r);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
      expect(getUser).not.toHaveBeenCalled();
      // Doğrulanmış kimlik İMZALI iç başlıkla sunucuya taşınır.
      const carried = await readVerifiedRequest(r.headers.get(AUTH_VERIFIED_HEADER), now());
      expect(carried?.claims).toMatchObject({ sub: "u1", session_id: "s1", app_metadata: { tenant_id: "t1", role: "owner" } });
      expect(carried?.facts).toEqual({ staff: false });
    });

    it("kapı okumaları: RPC sağlıklıysa tablo sorgusu yok, değilse eski yol", async () => {
      await updateSession(req("/app/musteriler"));
      if (rpc === "ok") {
        expect(rpcMock).toHaveBeenCalledWith("proxy_gate_snapshot", { p_user_id: "u1", p_tenant_id: "t1" });
        expect(fromSpy).not.toHaveBeenCalled();
      } else {
        expect(fromSpy.mock.calls.map((c) => c[0]).sort()).toEqual(["platform_staff", "profiles", "tenants"]);
      }
    });

    it("pasif profil: oturum kapatılıp girişe (inactive_or_invalid_identity)", async () => {
      db.profile = { ...activeProfile, is_active: false };
      const res = await updateSession(req("/app"));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("reason=inactive_or_invalid_identity");
    });

    it("rol/ofis uyuşmazlığı girişe yönlenir", async () => {
      db.profile = { ...activeProfile, role: "agent" };
      const res = await updateSession(req("/app"));
      expect(res.headers.get("location")).toContain("/giris");
    });

    it("askıdaki ofis /app/askida'ya yönlenir; askı sayfası geçer", async () => {
      db.tenant = { status: "suspended" };
      const res = await updateSession(req("/app/musteriler"));
      expect(res.headers.get("location")).toContain("/app/askida");
      const ok = await updateSession(req("/app/askida"));
      expect(ok.headers.get("location")).toBeNull();
    });

    it("iptal edilmiş ve görünmeyen (null) ofis askıya yönlenir", async () => {
      db.tenant = { status: "cancelled" };
      expect((await updateSession(req("/app/musteriler"))).headers.get("location")).toContain("/app/askida");
      db.tenant = null;
      expect((await updateSession(req("/app/musteriler"))).headers.get("location")).toContain("/app/askida");
    });

    it("platform personeli (ofis kullanıcısı değil) /app'ten /admin'e; /admin'de kalır", async () => {
      db.user = staffUser;
      db.profile = null;
      db.staff = { id: "u1" };
      db.tenant = null;
      const app = await updateSession(req("/app"));
      expect(app.headers.get("location")).toContain("/admin");
      const admin = await updateSession(req("/admin/tenants"));
      expect(admin.headers.get("location")).toBeNull();
    });

    it("oturumlu giriş sayfası: nokta segmentli next dış adrese değil panele yönlenir", async () => {
      for (const next of ["/.//evil.com", "/x/..//evil.com", "/%2e//evil.com"]) {
        const res = await updateSession(req(`/giris?next=${encodeURIComponent(next)}`));
        const loc = new URL(res.headers.get("location") ?? "");
        expect(loc.host, next).toBe("emlaksoft.test");
        expect(loc.pathname, next).toBe("/app");
      }
      const ok = await updateSession(req(`/giris?next=${encodeURIComponent("/app/musteriler?durum=yeni")}`));
      const okLoc = new URL(ok.headers.get("location") ?? "");
      expect(`${okLoc.pathname}${okLoc.search}`).toBe("/app/musteriler?durum=yeni");
    });

    it("ofis kullanıcısı /admin'den /app'e atılır", async () => {
      const res = await updateSession(req("/admin"));
      expect(res.headers.get("location")).toContain("/app");
      expect(res.headers.get("location")).not.toContain("/admin");
    });

    it("2FA açık profil: doğrulama çerezi yoksa /giris/dogrulama", async () => {
      db.profile = { ...activeProfile, two_factor_sms: true };
      const res = await updateSession(req("/app/musteriler"));
      expect(res.headers.get("location")).toContain("/giris/dogrulama");
    });

    it("destek oturumu (impersonation) personeli /app'e girer", async () => {
      db.user = {
        id: "u1",
        app_metadata: { tenant_id: "t1", role: "readonly", impersonating: true, impersonation_session_id: "s1" },
      };
      db.staff = { id: "u1" };
      db.profile = null;
      const res = await updateSession(req("/app/musteriler"));
      expect(res.headers.get("location")).toBeNull();
    });

    it("oturum yoksa (çerez yok) girişe; Auth sunucusuna tur yok", async () => {
      db.user = null;
      const res = await updateSession(req("/app/musteriler"));
      expect(res.headers.get("location")).toContain("/giris?next=%2Fapp%2Fmusteriler");
      expect(getUser).not.toHaveBeenCalled();
    });
  });
}

describe("SK1: oturum iptali (session_alive) ve yerel doğrulama", () => {
  beforeEach(() => resetState("ok"));

  it("başka cihazdan çıkış / iptal: eski belirteç bir sonraki istekte reddedilir, auth çerezleri silinir", async () => {
    db.sessionAlive = false;
    const r = new NextRequest(new URL("https://emlaksoft.test/app/musteriler"), {
      headers: { cookie: "sb-example-auth-token=base64-x; sb-example-auth-token.0=y" },
    });
    const res = await updateSession(r);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/giris?reason=session_revoked");
    expect(res.cookies.get("sb-example-auth-token")?.value).toBe("");
    expect(r.headers.get(AUTH_VERIFIED_HEADER)).toBeNull();
  });

  it("oturum canlılığı bilinmiyorsa (eski RPC gövdesi) geçer", async () => {
    db.sessionAlive = null;
    const res = await updateSession(req("/app/musteriler"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("imzası tutmayan belirteç reddedilir (yerel doğrulama ağa düşmez)", async () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", "baska-bir-sir-0123456789abcdef");
    const res = await updateSession(req("/app/musteriler"));
    expect(res.headers.get("location")).toContain("/giris");
    expect(getUser).not.toHaveBeenCalled();
  });

  it("sır tanımsız: yedek yol getUser'ı belirteç özetiyle önbelleğe alır (≤60 sn içinde ikinci tur yok)", async () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", "");
    await updateSession(req("/app/musteriler"));
    await updateSession(req("/app/raporlar"));
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it("istemcinin gönderdiği doğrulama başlığı silinir; sahte değer sunucuya ulaşmaz", async () => {
    db.user = null;
    const r = new NextRequest(new URL("https://emlaksoft.test/app"), { headers: { [AUTH_VERIFIED_HEADER]: "v1.sahte.imza" } });
    await updateSession(r);
    expect(r.headers.get(AUTH_VERIFIED_HEADER)).toBeNull();
  });
});

describe("SK1/B122: admin modül kapısı kabuk akmadan (proxy)", () => {
  beforeEach(() => {
    resetState("ok");
    db.user = staffUser;
    db.profile = null;
    db.staff = { id: "u1" };
    db.tenant = null;
  });

  it("yetkisiz sayfa 307 ile açıklama kartına (/admin?yetki=yok&sayfa=<modül>)", async () => {
    db.staffAccess = { role: "support", custom_role_id: null, custom_role: null };
    const res = await updateSession(req("/admin/sistem"));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location") ?? "");
    expect(`${loc.pathname}${loc.search}`).toBe("/admin?yetki=yok&sayfa=sistem");
    // Yetkili modül ve modülsüz sayfa geçer.
    expect((await updateSession(req("/admin/tickets/abc"))).headers.get("location")).toBeNull();
    expect((await updateSession(req("/admin/hesabim"))).headers.get("location")).toBeNull();
    expect((await updateSession(req("/admin"))).headers.get("location")).toBeNull();
  });

  it("özel rol matrisi uygulanır; okunamayan özel rol FAIL-CLOSED", async () => {
    db.staffAccess = {
      role: "ops",
      custom_role_id: "r1",
      custom_role: { id: "r1", label: "Destek izleyici", base_role: "ops", permissions: { tickets: ["view"] } },
    };
    expect((await updateSession(req("/admin/tickets"))).headers.get("location")).toBeNull();
    expect((await updateSession(req("/admin/tenants"))).headers.get("location")).toContain("sayfa=tenants");
    db.staffAccess = { role: "ops", custom_role_id: "r1", custom_role: null };
    expect((await updateSession(req("/admin/tickets"))).headers.get("location")).toContain("sayfa=tickets");
  });

  it("server action POST'u proxy'de kapılanmaz (eylem kapısı sunucuda); yetki öznesi bilinmiyorsa atlanır", async () => {
    db.staffAccess = { role: "support", custom_role_id: null, custom_role: null };
    expect((await updateSession(req("/admin/sistem", { method: "POST" }))).headers.get("location")).toBeNull();
    db.staffAccess = null;
    expect((await updateSession(req("/admin/sistem"))).headers.get("location")).toBeNull();
  });

  it("süper admin her sayfaya geçer", async () => {
    for (const p of ["/admin/sistem", "/admin/personel/guvenlik", "/admin/billing/muhasebe", "/admin/site/seo"]) {
      expect((await updateSession(req(p))).headers.get("location"), p).toBeNull();
    }
  });
});

describe("adminPathModule ↔ sayfa kapıları sözleşmesi", () => {
  const ADMIN_DIR = join(process.cwd(), "src/app/admin");
  function pages(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...pages(full));
      else if (name === "page.tsx") out.push(full);
    }
    return out;
  }

  it("her admin page.tsx'in requirePlatformModule modülü proxy tablosuyla aynı; kapısız sayfa eşleşmez", () => {
    const files = pages(ADMIN_DIR);
    expect(files.length).toBeGreaterThan(40);
    for (const file of files) {
      const rel = relative(ADMIN_DIR, file).split(sep).slice(0, -1);
      const route = `/admin${rel.length ? `/${rel.map((s) => (s.startsWith("[") ? "x" : s)).join("/")}` : ""}`;
      const src = readFileSync(file, "utf8");
      const m = /requirePlatformModule\("([a-z]+)"/.exec(src);
      expect(adminPathModule(route), route).toBe(m ? m[1] : null);
    }
  });

  it("yetkisiz adres biçimi", () => {
    expect(adminDeniedHref("billing")).toBe("/admin?yetki=yok&sayfa=billing");
    expect(adminPathModule("/admin/sistemx")).toBeNull();
    expect(adminPathModule("/admin/tickets/yardim/duzenle")).toBe("sitecontent");
  });
});

describe("RPC yoklaması", () => {
  beforeEach(() => resetState("missing"));

  it("RPC yoksa ikinci istekte tekrar denenmez (60 sn atlama)", async () => {
    await updateSession(req("/app"));
    await updateSession(req("/app"));
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});
