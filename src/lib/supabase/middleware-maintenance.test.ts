import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const flags = vi.hoisted(() => ({ maintenanceMode: false }));
const readFlags = vi.hoisted(() => vi.fn());
const getUser = vi.hoisted(() => vi.fn());
const db = vi.hoisted(() => ({
  staff: null as { id: string } | null,
  profile: null as Record<string, unknown> | null,
  tenant: { status: "active" } as { status: string } | null,
}));

vi.mock("@/lib/platform-flags-cache", async (orig) => {
  const actual = await orig<typeof import("@/lib/platform-flags-cache")>();
  return { ...actual, readPlatformFlagsCached: readFlags };
});

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser,
      getClaims: async () => ({ data: { claims: { session_id: "s1" } }, error: null }),
      signOut: async () => ({}),
    },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({
        data:
          table === "profiles" ? db.profile : table === "platform_staff" ? db.staff : db.tenant,
        error: null,
      });
      return chain;
    },
  }),
}));

import { updateSession } from "@/lib/supabase/middleware";
import { config } from "@/proxy";

function req(path: string) {
  return new NextRequest(new URL(`https://emlaksoft.test${path}`));
}

/** Matcher yalnız negatif-ileri bakışlı tek desen içerir; RegExp'e çevrilip yollar denenir. */
function matcherHits(path: string) {
  return config.matcher.some((m) => new RegExp(`^${m}$`).test(path));
}

describe("proxy matcher kapsamı", () => {
  it("her sayfa isteğini kapsar (public vitrin, portal, kayıt, /app, /admin, /bakim)", () => {
    for (const p of ["/", "/kayit", "/giris", "/giris/mfa", "/app", "/app/musteriler", "/admin/tenants", "/vitrin/ofis", "/paylas/abc", "/bakim", "/fiyatlar"]) {
      expect(matcherHits(p), p).toBe(true);
    }
  });
  it("api, _next ve uzantılı statik dosyaları kapsamaz", () => {
    for (const p of ["/api/cron/x", "/api/health", "/_next/static/a.js", "/_next/image", "/logo.png", "/sw.js", "/robots.txt", "/favicon.ico", "/sitemap.xml"]) {
      expect(matcherHits(p), p).toBe(false);
    }
  });
});

describe("bakım modu proxy davranışı", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "dummy");
    flags.maintenanceMode = false;
    readFlags.mockReset();
    readFlags.mockImplementation(async () => ({
      maintenanceMode: flags.maintenanceMode,
      maintenanceMessage: "",
      registrationOpen: true,
    }));
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: null } });
    db.staff = null;
    db.profile = null;
    db.tenant = { status: "active" };
  });

  it("bakım kapalıyken public sayfa geçer ve getUser çağrılmaz", async () => {
    const res = await updateSession(req("/vitrin/ofis"));
    expect(res.status).toBe(200);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("bakım açıkken public sayfa 503 + /bakim'e yeniden yazılır, getUser çağrılmaz", async () => {
    flags.maintenanceMode = true;
    const res = await updateSession(req("/vitrin/ofis?x=1"));
    expect(res.status).toBe(503);
    expect(res.headers.get("x-middleware-rewrite")).toContain("/bakim");
    expect(res.headers.get("x-middleware-rewrite")).not.toContain("x=1");
    expect(res.headers.get("Retry-After")).toBe("600");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(getUser).not.toHaveBeenCalled();
  });

  it("bakım açıkken /kayit 503; /giris, /admin, /bakim muaf (bayrak bile okunmaz)", async () => {
    flags.maintenanceMode = true;
    expect((await updateSession(req("/kayit"))).status).toBe(503);
    readFlags.mockClear();
    for (const p of ["/giris", "/giris/mfa", "/bakim"]) {
      const res = await updateSession(req(p));
      expect(res.status, p).not.toBe(503);
    }
    const admin = await updateSession(req("/admin"));
    expect(admin.status).toBe(307); // oturumsuz: girişe yönlenir, bakım sayfası değil
    expect(readFlags).not.toHaveBeenCalled();
  });

  it("bakım açıkken oturumsuz /app girişe yönlenir (bakım sayfası değil)", async () => {
    flags.maintenanceMode = true;
    const res = await updateSession(req("/app/musteriler"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/giris");
  });

  it("bakım açıkken ofis kullanıcısı /app'te 503, platform personeli geçer", async () => {
    flags.maintenanceMode = true;
    getUser.mockResolvedValue({
      data: { user: { id: "u1", app_metadata: { tenant_id: "t1", role: "owner" } } },
    });
    db.profile = { tenant_id: "t1", role: "owner", is_active: true, two_factor_sms: false };
    const blocked = await updateSession(req("/app/musteriler"));
    expect(blocked.status).toBe(503);

    // Platform personeli (ofis içinde destek oturumu): bakım onu engellemez.
    db.staff = { id: "u1" };
    getUser.mockResolvedValue({
      data: {
        user: {
          id: "u1",
          app_metadata: {
            tenant_id: "t1",
            role: "readonly",
            impersonating: true,
            impersonation_session_id: "s1",
          },
        },
      },
    });
    const staff = await updateSession(req("/app/musteriler"));
    expect(staff.status).not.toBe(503);
  });
});
