import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * SK1/B019 SÖZLEŞME: sayfa, RSC ve önyükleme (prefetch) isteği başına Auth sunucusuna (/auth/v1/user) ağ turu 0.
 *
 * GERÇEK @supabase/ssr istemcisi + gerçek proxy (src/proxy.ts → updateSession) + gerçek auth-cache/platform kimlik
 * okumaları çalışır; yalnız ağ (global fetch) ve Next istek bağlamı (next/headers) taklittir. Oturum çerezi gerçek
 * biçimde (`sb-<ref>-auth-token`, base64url) kurulur, erişim JWT'si HS256 ile imzalıdır (GoTrue'nun canlı yapılandırması).
 * Tek izinli Auth turu: süresi ≤90 sn kalan belirtecin YENİLENMESİ (POST /auth/v1/token).
 */

const net = vi.hoisted(() => ({
  calls: [] as { method: string; path: string }[],
  gate: {} as Record<string, unknown>,
  refreshed: null as Record<string, unknown> | null,
}));
const reqCtx = vi.hoisted(() => ({ headers: new Headers(), cookies: [] as { name: string; value: string }[] }));

vi.mock("@/lib/platform-flags-cache", async (orig) => {
  const actual = await orig<typeof import("@/lib/platform-flags-cache")>();
  return { ...actual, readPlatformFlagsCached: async () => ({ maintenanceMode: false, maintenanceMessage: "", registrationOpen: true }) };
});
vi.mock("@/lib/office-security/policy-cache", () => ({ readOfficeSecurityPolicyCached: async () => null }));
vi.mock("@/lib/platform-security/admin-access-cache", () => ({
  readAdminAccessPolicyCached: async () => ({ rules: [], idleMinutes: 0, maxHours: 12 }),
  resetAdminAccessCache: () => undefined,
}));
vi.mock("@/lib/platform-mfa", async (orig) => {
  const actual = await orig<typeof import("@/lib/platform-mfa")>();
  return { ...actual, isPlatformMfaRequiredNow: async () => false };
});
vi.mock("next/headers", () => ({
  headers: async () => reqCtx.headers,
  cookies: async () => ({
    getAll: () => reqCtx.cookies,
    get: (n: string) => reqCtx.cookies.find((c) => c.name === n),
    set: () => undefined,
  }),
}));

import { proxy } from "@/proxy";
import { getRequestClaims, getRequestUser } from "@/lib/supabase/auth-cache";
import { isPlatformSessionExpired } from "@/lib/platform";
import { AUTH_VERIFIED_HEADER, resetVerifiedTokenCache } from "@/lib/supabase/verified-request";
import { resetRpcProbes } from "@/lib/supabase/rpc-probe";
import { TEST_JWT_SECRET, signTestAccessToken } from "@/lib/supabase/test-support";
import { now } from "@/lib/clock";

const SUPABASE_URL = "https://example.supabase.co";
const COOKIE = "sb-example-auth-token";
const SESSION_ID = "11111111-2222-4333-8444-555555555555";
type TestUser = { id: string; email: string; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown> };
const tenantUser: TestUser = { id: "u1", email: "ofis@x.test", app_metadata: { tenant_id: "t1", role: "owner" }, user_metadata: {} };
const staffUser: TestUser = { id: "s1", email: "staff@x.test", app_metadata: {}, user_metadata: {} };
const activeProfile = { tenant_id: "t1", role: "owner", is_active: true, two_factor_sms: false, phone: null, two_factor_version: 1 };

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

async function sessionCookie(user: TestUser, opts: { expiresInSec?: number } = {}) {
  const nowSec = Math.floor(now() / 1000);
  const exp = nowSec + (opts.expiresInSec ?? 3600);
  const access_token = await signTestAccessToken(
    { sub: user.id, email: user.email, app_metadata: user.app_metadata, user_metadata: user.user_metadata, session_id: SESSION_ID, aal: "aal1", amr: [{ method: "password", timestamp: nowSec - 60 }] },
    { nowSec: exp - 3600 },
  );
  const session = {
    access_token,
    refresh_token: "refresh-1",
    token_type: "bearer",
    expires_in: exp - nowSec,
    expires_at: exp,
    user: { ...user, aud: "authenticated", role: "authenticated", created_at: "2026-01-01T00:00:00Z" },
  };
  return { name: COOKIE, value: `base64-${b64url(JSON.stringify(session))}`, session };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  const method = (init?.method ?? "GET").toUpperCase();
  net.calls.push({ method, path: url.pathname });
  if (url.pathname === "/rest/v1/rpc/proxy_gate_snapshot") return json(net.gate);
  if (url.pathname === "/auth/v1/token" && net.refreshed) return json(net.refreshed);
  if (url.pathname === "/auth/v1/user") return json({ id: "u1", aud: "authenticated" });
  return json({ message: "beklenmeyen istek" }, 404);
}

function authCalls(path?: string) {
  return net.calls.filter((c) => c.path.startsWith("/auth/v1/") && (!path || c.path === path));
}

function pageRequest(path: string, cookie: { name: string; value: string }, extra: Record<string, string> = {}) {
  return new NextRequest(new URL(`https://emlaksoft.test${path}`), {
    headers: { cookie: `${cookie.name}=${cookie.value}`, "x-real-ip": "198.51.100.7", ...extra },
  });
}

/** Proxy'den geçen isteğin başlık/çerezleri sunucu bileşeni bağlamına (next/headers) aktarılır. */
function enterServerContext(request: NextRequest) {
  reqCtx.headers = new Headers(request.headers);
  reqCtx.cookies = request.cookies.getAll().map((c) => ({ name: c.name, value: c.value }));
}

describe("SK1/B019 sözleşmesi: sayfa/RSC/önyükleme başına /auth/v1/user = 0", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-dummy");
    vi.stubEnv("SUPABASE_JWT_SECRET", TEST_JWT_SECRET);
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    resetRpcProbes();
    resetVerifiedTokenCache();
    net.calls = [];
    net.refreshed = null;
    net.gate = { profile: activeProfile, staff: false, tenant_status: "active", session_alive: true, staff_access: null };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("/app belge, RSC ve önyükleme istekleri + sunucu kimlik okumaları: Auth turu yok, kapı tek RPC", async () => {
    const cookie = await sessionCookie(tenantUser);
    const variants: Record<string, string>[] = [{}, { rsc: "1" }, { rsc: "1", "next-router-prefetch": "1" }, { purpose: "prefetch" }];
    for (const extra of variants) {
      net.calls = [];
      const request = pageRequest("/app/musteriler", cookie, extra);
      const res = await proxy(request);
      expect(res.headers.get("location"), JSON.stringify(extra)).toBeNull();
      expect(request.headers.get(AUTH_VERIFIED_HEADER)).toMatch(/^v1\./);
      // Sunucu bileşenleri: kimlik + claim'ler başlıktan.
      enterServerContext(request);
      expect((await getRequestUser())?.id).toBe("u1");
      expect((await getRequestClaims())?.session_id).toBe(SESSION_ID);
      expect(authCalls(), JSON.stringify(extra)).toEqual([]);
      expect(net.calls.filter((c) => c.path === "/rest/v1/rpc/proxy_gate_snapshot")).toHaveLength(1);
    }
  });

  it("/admin sayfası + oturum ömrü denetimi (isPlatformSessionExpired): Auth turu yok", async () => {
    net.gate = { profile: null, staff: true, tenant_status: null, session_alive: true, staff_access: { role: "super_admin", custom_role_id: null, custom_role: null } };
    const cookie = await sessionCookie(staffUser);
    const variants: Record<string, string>[] = [{}, { rsc: "1", "next-router-prefetch": "1" }];
    for (const extra of variants) {
      net.calls = [];
      const request = pageRequest("/admin/tenants", cookie, extra);
      const res = await proxy(request);
      expect(res.headers.get("location")).toBeNull();
      enterServerContext(request);
      expect((await getRequestUser())?.id).toBe("s1");
      expect(await isPlatformSessionExpired()).toBe(false);
      expect(authCalls()).toEqual([]);
    }
  });

  it("/api/admin (bildirim zili) proxy'de yerel doğrulanır; rota Auth sunucusuna gitmez", async () => {
    net.gate = { profile: null, staff: true, tenant_status: null, session_alive: true, staff_access: { role: "support", custom_role_id: null, custom_role: null } };
    const cookie = await sessionCookie(staffUser);
    const request = pageRequest("/api/admin/notifications", cookie);
    const res = await proxy(request);
    expect(res.headers.get("location")).toBeNull();
    enterServerContext(request);
    expect((await getRequestUser())?.id).toBe("s1");
    expect(authCalls()).toEqual([]);
  });

  it("tek izinli Auth turu: süresi dolmak üzere olan belirtecin yenilenmesi (/auth/v1/token); /auth/v1/user yine 0", async () => {
    const cookie = await sessionCookie(tenantUser, { expiresInSec: 30 });
    const fresh = await sessionCookie(tenantUser);
    net.refreshed = { ...fresh.session, refresh_token: "refresh-2" };
    const request = pageRequest("/app", cookie);
    const res = await proxy(request);
    expect(res.headers.get("location")).toBeNull();
    expect(authCalls("/auth/v1/token")).toHaveLength(1);
    expect(authCalls("/auth/v1/user")).toHaveLength(0);
    // Yenilenen oturum çerezi yanıta yazılır.
    expect(res.cookies.getAll().some((c) => c.name.startsWith(COOKIE) && c.value.startsWith("base64-"))).toBe(true);
  });

  it("sahte doğrulama başlığı /api yolunda kimlik sayılmaz (imza yok → yedek yol)", async () => {
    reqCtx.headers = new Headers({ [AUTH_VERIFIED_HEADER]: "v1.eyJjIjp7InN1YiI6ImFkbWluIn19.sahte" });
    reqCtx.cookies = [];
    expect(await getRequestUser()).toBeNull();
  });
});

describe("statik sözleşme: sunucu sayfa/kabuk yolunda doğrudan Auth sunucusu turu yok", () => {
  const ROOT = process.cwd();
  /** Sunucu kimliği tek yerden (auth-cache) çözülür; doğrudan getUser/getClaims yalnız bu dosyalarda (gerekçeli). */
  const ALLOWED = new Set([
    "src/lib/supabase/verified-request.ts", // yedek yol + JWKS (belirteçle; önbellekli)
    "src/lib/google/session.ts", // yalnız Google bağlama akışı (personel eylemi), sayfa yolu değil
  ]);
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }

  it("/app ve /admin sayfa/düzen dosyaları ile src/lib ve bileşenler auth.getUser()/auth.getClaims() çağırmaz", () => {
    const files = [
      ...walk(join(ROOT, "src/app/app")),
      ...walk(join(ROOT, "src/app/admin")),
      ...walk(join(ROOT, "src/lib")),
      ...walk(join(ROOT, "src/components")),
    ].map((f) => relative(ROOT, f));
    const offenders = files.filter((f) => {
      if (ALLOWED.has(f) || f.endsWith("test-support.ts")) return false;
      // Sunucu eylemleri (POST) sayfa yolu değildir; yazma işlemleri taze kullanıcıyı ağdan okuyabilir.
      if (/\/actions?\.tsx?$|-actions\.ts$/.test(f)) return false;
      return /auth\.(getUser|getClaims)\(/.test(readFileSync(join(ROOT, f), "utf8"));
    });
    expect(offenders).toEqual([]);
  });
});
