import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseAllowlist } from "./admin-access";

/** AD11 proxy kapısı: izin listesi dışındaki IP /admin ve /api/admin'de 403 alır; diğer yollar etkilenmez. */
const state = vi.hoisted(() => ({ allowlist: "", sessions: 0 }));

vi.mock("./admin-access-cache", () => ({
  readAdminAccessPolicyCached: vi.fn(async () => ({ rules: parseAllowlist(state.allowlist).rules, idleMinutes: 60, maxHours: 12 })),
}));
vi.mock("@/lib/supabase/middleware", async () => {
  const { NextResponse } = await import("next/server");
  return {
    updateSession: vi.fn(async () => {
      state.sessions += 1;
      return NextResponse.next();
    }),
  };
});

import { proxy } from "@/proxy";

function req(path: string, ip: string) {
  return new NextRequest(new URL(`https://emlaksoft.test${path}`), { headers: { "x-real-ip": ip } });
}

describe("yönetim IP izin listesi (proxy)", () => {
  beforeEach(() => {
    state.allowlist = "198.51.100.0/24";
    state.sessions = 0;
    delete process.env.ADMIN_IP_ALLOWLIST;
  });

  it("liste dışındaki IP /admin'de 403 alır ve oturum çözülmez", async () => {
    const res = await proxy(req("/admin/personel", "203.0.113.9"));
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Erişim engellendi");
    expect(state.sessions).toBe(0);
  });

  it("liste dışındaki IP /api/admin'de JSON 403 alır", async () => {
    const res = await proxy(req("/api/admin/notifications", "203.0.113.9"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/IP/);
  });

  it("listedeki IP geçer; /app ve public yollar listeden etkilenmez", async () => {
    expect((await proxy(req("/admin", "198.51.100.20"))).status).toBe(200);
    expect((await proxy(req("/app", "203.0.113.9"))).status).toBe(200);
    expect((await proxy(req("/", "203.0.113.9"))).status).toBe(200);
  });

  it("acil kapatma (ADMIN_IP_ALLOWLIST=off) ve boş liste kısıtlamaz", async () => {
    process.env.ADMIN_IP_ALLOWLIST = "off";
    expect((await proxy(req("/admin", "203.0.113.9"))).status).toBe(200);
    delete process.env.ADMIN_IP_ALLOWLIST;
    state.allowlist = "";
    expect((await proxy(req("/admin", "203.0.113.9"))).status).toBe(200);
  });
});
