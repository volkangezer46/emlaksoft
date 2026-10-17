import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  createInternalRoutingFetch,
  INTERNAL_COOLDOWN_MS,
  internalSupabaseRoute,
  isConnectFailure,
  toInternalUrl,
} from "./fetch-guard";
import { supabaseAuthCookieName } from "./keys";

/**
 * PERF-3: sunucu Supabase çağrıları isteğe bağlı iç ağdan (SUPABASE_INTERNAL_URL). Çerez adı, Storage bağlantıları ve
 * JWT iss genel URL'de kalır; yalnız taşıma iç köke gider.
 */
const PUBLIC = "https://api.emlaksoft.com.tr";
const INTERNAL = "http://supabase-kong:8000";
const env = { NEXT_PUBLIC_SUPABASE_URL: PUBLIC, SUPABASE_INTERNAL_URL: INTERNAL };

describe("internalSupabaseRoute", () => {
  it("both URLs set → route", () => {
    expect(internalSupabaseRoute(env)).toEqual({ publicBase: PUBLIC, internalBase: INTERNAL });
    expect(internalSupabaseRoute({ ...env, SUPABASE_INTERNAL_URL: `${INTERNAL}/` })).toEqual({ publicBase: PUBLIC, internalBase: INTERNAL });
  });
  it("missing / invalid / same → null (public URL fallback)", () => {
    expect(internalSupabaseRoute({ NEXT_PUBLIC_SUPABASE_URL: PUBLIC })).toBeNull();
    expect(internalSupabaseRoute({ ...env, SUPABASE_INTERNAL_URL: "  " })).toBeNull();
    expect(internalSupabaseRoute({ ...env, SUPABASE_INTERNAL_URL: "not a url" })).toBeNull();
    expect(internalSupabaseRoute({ ...env, SUPABASE_INTERNAL_URL: "ftp://kong" })).toBeNull();
    expect(internalSupabaseRoute({ ...env, SUPABASE_INTERNAL_URL: `${INTERNAL}?x=1` })).toBeNull();
    expect(internalSupabaseRoute({ ...env, SUPABASE_INTERNAL_URL: PUBLIC })).toBeNull();
    expect(internalSupabaseRoute({ SUPABASE_INTERNAL_URL: INTERNAL })).toBeNull();
  });
});

describe("toInternalUrl", () => {
  const route = { publicBase: PUBLIC, internalBase: INTERNAL };
  it("rewrites only the public Supabase origin", () => {
    expect(toInternalUrl(`${PUBLIC}/rest/v1/customers?select=id`, route)).toBe(`${INTERNAL}/rest/v1/customers?select=id`);
    expect(toInternalUrl(`${PUBLIC}/auth/v1/token?grant_type=refresh_token`, route)).toBe(`${INTERNAL}/auth/v1/token?grant_type=refresh_token`);
    expect(toInternalUrl(`${PUBLIC}`, route)).toBe(INTERNAL);
  });
  it("leaves other hosts alone (look-alike host too)", () => {
    expect(toInternalUrl("https://api.openai.com/v1/x", route)).toBeNull();
    expect(toInternalUrl("https://api.emlaksoft.com.tr.evil.test/rest/v1", route)).toBeNull();
  });
});

describe("createInternalRoutingFetch", () => {
  const route = { publicBase: PUBLIC, internalBase: INTERNAL };
  const ok = () => new Response("ok");

  it("server-side request goes to the internal URL, never the public host", async () => {
    const base = vi.fn(async () => ok());
    const f = createInternalRoutingFetch(base as unknown as typeof fetch, route);
    await f(`${PUBLIC}/rest/v1/rpc/app_shell_bootstrap`, { method: "POST", body: "{}" });
    expect(base).toHaveBeenCalledWith(`${INTERNAL}/rest/v1/rpc/app_shell_bootstrap`, { method: "POST", body: "{}" });
  });

  it("no route → identity (public URL)", async () => {
    const base = vi.fn(async () => ok());
    const f = createInternalRoutingFetch(base as unknown as typeof fetch, null);
    expect(f).toBe(base);
  });

  it("connect failure → falls back to public and cools down", async () => {
    let t = 0;
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const base = vi.fn(async (u: string) => {
      if (u.startsWith(INTERNAL)) throw refused;
      return ok();
    });
    const f = createInternalRoutingFetch(base as unknown as typeof fetch, route, () => t);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await f(`${PUBLIC}/rest/v1/x`);
    expect(base.mock.calls.map((c) => c[0])).toEqual([`${INTERNAL}/rest/v1/x`, `${PUBLIC}/rest/v1/x`]);
    base.mockClear();
    t = INTERNAL_COOLDOWN_MS - 1;
    await f(`${PUBLIC}/rest/v1/y`);
    expect(base.mock.calls.map((c) => c[0])).toEqual([`${PUBLIC}/rest/v1/y`]);
    base.mockClear();
    t = INTERNAL_COOLDOWN_MS + 1;
    await f(`${PUBLIC}/rest/v1/z`).catch(() => undefined);
    expect(base.mock.calls[0]?.[0]).toBe(`${INTERNAL}/rest/v1/z`);
    warn.mockRestore();
  });

  it("other errors (timeout, reset after send) are NOT retried on public (no double write)", async () => {
    const reset = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    const base = vi.fn(async () => {
      throw reset;
    });
    const f = createInternalRoutingFetch(base as unknown as typeof fetch, route);
    await expect(f(`${PUBLIC}/rest/v1/x`, { method: "POST" })).rejects.toBe(reset);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("isConnectFailure reads undici cause codes (incl. AggregateError)", () => {
    expect(isConnectFailure({ cause: { code: "ENOTFOUND" } })).toBe(true);
    expect(isConnectFailure({ cause: { errors: [{ code: "ECONNREFUSED" }] } })).toBe(true);
    expect(isConnectFailure({ cause: { code: "ECONNRESET" } })).toBe(false);
    expect(isConnectFailure(null)).toBe(false);
  });
});

describe("auth cookie name stays pinned to the public project ref", () => {
  it("matches supabase-js default derivation for the public URL", () => {
    expect(supabaseAuthCookieName(PUBLIC)).toBe("sb-api-auth-token");
    const c = createClient(PUBLIC, "anon-key", { auth: { persistSession: false } });
    expect((c.auth as unknown as { storageKey: string }).storageKey).toBe(supabaseAuthCookieName(PUBLIC));
    // İç URL istemciye verilseydi çerez adı değişirdi (bu yüzden yalnız taşıma iç köke gider).
    expect(supabaseAuthCookieName(INTERNAL)).not.toBe(supabaseAuthCookieName(PUBLIC));
    expect(supabaseAuthCookieName(undefined)).toBeUndefined();
    expect(supabaseAuthCookieName("::")).toBeUndefined();
  });

  it("server.ts and middleware.ts keep the public URL as client URL, pin cookieOptions.name and use guardedFetch", () => {
    for (const f of ["src/lib/supabase/server.ts", "src/lib/supabase/middleware.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("supabaseAuthCookieName()");
      expect(src, f).toContain("cookieOptions: { name");
      expect(src, f).toContain("global: { fetch: guardedFetch }");
      expect(src, f).not.toMatch(/process\.env\.SUPABASE_INTERNAL_URL/);
    }
    const admin = readFileSync("src/lib/supabase/admin.ts", "utf8");
    expect(admin).toContain("global: { fetch: guardedFetch }");
    // Tarayıcı istemcisi iç yolu hiç bilmez.
    expect(readFileSync("src/lib/supabase/client.ts", "utf8")).not.toMatch(/fetch-guard|SUPABASE_INTERNAL_URL/);
  });

  it("JWT issuer expectation still derives from the public URL", () => {
    const src = readFileSync("src/lib/supabase/verified-request.ts", "utf8");
    expect(src).toContain("env.NEXT_PUBLIC_SUPABASE_URL");
    expect(src).not.toMatch(/SUPABASE_INTERNAL_URL/);
  });
});
