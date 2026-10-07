import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUser = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());
const fromSpy = vi.hoisted(() => vi.fn());
const mode = vi.hoisted(() => ({ rpc: "ok" as "ok" | "missing" | "error" | "garbage" }));
const db = vi.hoisted(() => ({
  staff: null as { id: string } | null,
  profile: null as Record<string, unknown> | null,
  tenant: { status: "active" } as { status: string } | null,
  claims: { session_id: "s1" } as Record<string, unknown>,
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
      getUser,
      getClaims: async () => ({ data: { claims: db.claims }, error: null }),
      signOut: async () => ({}),
    },
    rpc: async (name: string, args: unknown) => {
      rpcMock(name, args);
      if (mode.rpc === "missing") return { data: null, error: { code: "PGRST202", message: "not found" } };
      if (mode.rpc === "error") return { data: null, error: { code: "57014", message: "timeout" } };
      if (mode.rpc === "garbage") return { data: "x", error: null };
      return {
        data: { profile: db.profile, staff: Boolean(db.staff), tenant_status: db.tenant?.status ?? null },
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

function req(path: string) {
  return new NextRequest(new URL(`https://emlaksoft.test${path}`));
}
const tenantUser = { id: "u1", app_metadata: { tenant_id: "t1", role: "owner" } };
const activeProfile = { tenant_id: "t1", role: "owner", is_active: true, two_factor_sms: false, phone: null, two_factor_version: 1 };

for (const rpc of ["ok", "missing", "error", "garbage"] as const) {
  describe(`proxy kapıları (RPC modu: ${rpc})`, () => {
    beforeEach(() => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "dummy");
      resetRpcProbes();
      mode.rpc = rpc;
      rpcMock.mockReset();
      fromSpy.mockReset();
      getUser.mockReset();
      getUser.mockResolvedValue({ data: { user: tenantUser } });
      db.staff = null;
      db.profile = activeProfile;
      db.tenant = { status: "active" };
      db.claims = { session_id: "s1" };
    });

    it("aktif ofis kullanıcısı /app'e geçer", async () => {
      const res = await updateSession(req("/app/musteriler"));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
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
      getUser.mockResolvedValue({ data: { user: { id: "u1", app_metadata: {} } } });
      db.profile = null;
      db.staff = { id: "u1" };
      db.tenant = null;
      const app = await updateSession(req("/app"));
      expect(app.headers.get("location")).toContain("/admin");
      const admin = await updateSession(req("/admin/tenants"));
      expect(admin.headers.get("location")).toBeNull();
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
      getUser.mockResolvedValue({
        data: {
          user: {
            id: "u1",
            app_metadata: { tenant_id: "t1", role: "readonly", impersonating: true, impersonation_session_id: "s1" },
          },
        },
      });
      db.staff = { id: "u1" };
      db.profile = null;
      const res = await updateSession(req("/app/musteriler"));
      expect(res.headers.get("location")).toBeNull();
    });
  });
}

describe("RPC yoklaması", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "dummy");
    resetRpcProbes();
    rpcMock.mockReset();
    getUser.mockResolvedValue({ data: { user: tenantUser } });
    db.profile = activeProfile;
    db.tenant = { status: "active" };
    db.staff = null;
  });

  it("RPC yoksa ikinci istekte tekrar denenmez (60 sn atlama)", async () => {
    mode.rpc = "missing";
    await updateSession(req("/app"));
    await updateSession(req("/app"));
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});
