import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Hızlı demo girişi (UXM-2): mevcut demo hesabına tekrar girişte parola YAZILMAZ — GoTrue parola
 * değişince hesabın diğer tüm oturumlarını düşürür. Parola yalnız giriş "invalid_credentials" ile
 * başarısız olursa BİR KEZ yazılır; meta veri onarımı parolasız ayrı çağrıdır.
 * Supabase (yönetici + oturum istemcisi) durumlu sahte ile taklit edilir.
 */
type FakeUser = {
  id: string;
  email: string;
  password: string;
  email_confirmed_at: string | null;
  user_metadata: Record<string, unknown>;
  app_metadata: Record<string, unknown>;
};

const h = vi.hoisted(() => ({
  users: new Map<string, FakeUser>(),
  updateUserById: vi.fn(),
  createUser: vi.fn(),
  signIn: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
  ceiling: { tenant: true, platform: false },
  demoLoginRaw: null as string | null,
  audit: vi.fn(async () => {}),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: async () => "127.0.0.1",
  checkRateLimit: async () => ({ allowed: true }),
}));
// Env tavanı + yönetim anahtarı (bayrak önbelleği) taklit edilir; karar gerçek demo-policy kodundan geçer.
vi.mock("@/lib/demo-environment", () => ({
  isDemoLoginEnabled: () => h.ceiling.tenant,
  isPlatformDemoPersonaAllowed: () => h.ceiling.platform,
}));
vi.mock("@/lib/platform-flags-cache", () => ({
  SECURITY_SETTING_KEYS: { demoLogin: "platform.demo_login", mfaEnforced: "platform.mfa_enforced", mfaGraceUntil: "platform.mfa_grace_until" },
  readPlatformFlagsCached: async () => ({ demoLoginRaw: h.demoLoginRaw }),
}));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: h.audit }));
vi.mock("@/lib/platform-mfa", () => ({ isPlatformMfaRequired: () => false, isPlatformMfaRequiredNow: async () => false }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword: h.signIn } }),
}));
vi.mock("@/lib/supabase/admin", () => {
  const table = () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: { id: "tenant-demo" }, error: null }),
      upsert: async () => ({ error: null }),
      insert: () => chain,
      single: async () => ({ data: { id: "tenant-demo" }, error: null }),
    };
    return chain;
  };
  return {
    resolveSupabaseAdminKey: () => "test-service-key",
    createAdminClient: () => ({
      from: table,
      auth: {
        admin: {
          createUser: h.createUser,
          updateUserById: h.updateUserById,
          getUserById: async (id: string) => {
            const user = [...h.users.values()].find((u) => u.id === id) ?? null;
            return { data: { user }, error: null };
          },
          listUsers: async () => ({ data: { users: [...h.users.values()] }, error: null }),
        },
      },
    }),
  };
});

import { quickDemoLogin } from "./demo-login";

function seedFakes() {
  h.users.clear();
  h.createUser.mockImplementation(async (input: Omit<FakeUser, "id" | "email_confirmed_at"> & { email_confirm: boolean }) => {
    if (h.users.has(input.email)) return { data: { user: null }, error: { message: "User already registered" } };
    const user: FakeUser = {
      id: `u-${h.users.size + 1}`,
      email: input.email,
      password: input.password,
      email_confirmed_at: "2026-01-01T00:00:00Z",
      user_metadata: input.user_metadata,
      app_metadata: input.app_metadata,
    };
    h.users.set(input.email, user);
    return { data: { user }, error: null };
  });
  h.updateUserById.mockImplementation(async (id: string, attrs: Partial<FakeUser> & { email_confirm?: boolean }) => {
    const user = [...h.users.values()].find((u) => u.id === id);
    if (!user) return { data: { user: null }, error: { message: "not found" } };
    if (attrs.password) user.password = attrs.password;
    if (attrs.app_metadata) user.app_metadata = { ...user.app_metadata, ...attrs.app_metadata };
    if (attrs.user_metadata) user.user_metadata = { ...user.user_metadata, ...attrs.user_metadata };
    return { data: { user }, error: null };
  });
  h.signIn.mockImplementation(async ({ email, password }: { email: string; password: string }) => {
    const user = h.users.get(email);
    if (!user || user.password !== password) {
      return { error: { code: "invalid_credentials", message: "Invalid login credentials" } };
    }
    return { error: null };
  });
}

async function login(personaId: string) {
  return quickDemoLogin(personaId).catch((e: unknown) => {
    if (e instanceof Error && e.message.startsWith("NEXT_REDIRECT:")) return { redirectTo: e.message.slice(14) };
    throw e;
  });
}

const passwordWrites = () => h.updateUserById.mock.calls.filter(([, attrs]) => attrs && "password" in attrs);

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.test");
  vi.stubEnv("DEMO_LOGIN_SECRET", "demo-test-secret-0123456789abcdefghijklmnop");
  vi.clearAllMocks();
  h.ceiling = { tenant: true, platform: false };
  h.demoLoginRaw = null;
  seedFakes();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("quickDemoLogin parola davranışı", () => {
  it("ikinci (ve sonraki) girişte updateUserById(password) çağrılmaz", async () => {
    expect(await login("owner")).toEqual({ redirectTo: "/app" });
    expect(await login("owner")).toEqual({ redirectTo: "/app" });
    expect(await login("owner")).toEqual({ redirectTo: "/app" });
    expect(passwordWrites()).toHaveLength(0);
    expect(h.signIn).toHaveBeenCalledTimes(3);
  });

  it("meta veri onarımı parolasız ayrı çağrıdır ve kalıntı taklit anahtarlarını temizler", async () => {
    await login("owner");
    const user = h.users.get("sahip@demo.emlaksoft.test")!;
    user.app_metadata = { ...user.app_metadata, impersonating: true, home_tenant_id: "x" };
    h.updateUserById.mockClear();

    expect(await login("owner")).toEqual({ redirectTo: "/app" });
    expect(h.updateUserById).toHaveBeenCalledTimes(1);
    expect(passwordWrites()).toHaveLength(0);
    expect(user.app_metadata.impersonating).toBe(false);
    expect(user.app_metadata.home_tenant_id).toBeNull();
  });

  it("parola tutmuyorsa (invalid_credentials) BİR KEZ yazılır ve giriş yeniden denenir", async () => {
    await login("owner");
    h.users.get("sahip@demo.emlaksoft.test")!.password = "eski-sir-ile-turetilmis";
    h.updateUserById.mockClear();
    h.signIn.mockClear();

    expect(await login("owner")).toEqual({ redirectTo: "/app" });
    expect(passwordWrites()).toHaveLength(1);
    expect(h.signIn).toHaveBeenCalledTimes(2);

    h.updateUserById.mockClear();
    expect(await login("owner")).toEqual({ redirectTo: "/app" });
    expect(passwordWrites()).toHaveLength(0);
  });

  it("platform kişiliği kapı kapalıyken hazırlanmaz ve giriş denenmez", async () => {
    const res = await login("super_admin");
    expect(res).toHaveProperty("error");
    expect(h.createUser).not.toHaveBeenCalled();
    expect(h.signIn).not.toHaveBeenCalled();
  });
});

describe("quickDemoLogin demo politikası (env tavanı + yönetim anahtarı)", () => {
  it("DB satırı yokken env iki kademe açıksa süper admin girer (sahip kararı) ve denetime yazılır", async () => {
    h.ceiling = { tenant: true, platform: true };
    expect(await login("super_admin")).toEqual({ redirectTo: "/admin" });
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.demo_login", meta: expect.objectContaining({ persona: "super_admin", ip_hash: expect.any(String) }) }),
    );
    const meta = (h.audit.mock.calls[0] as unknown as [{ meta: Record<string, unknown> }])[0].meta;
    expect(meta.ip_hash).not.toContain("127.0.0.1");
  });

  it("DB'de platform kapalıyken (mode tenant) süper admin personası sunucuda reddedilir", async () => {
    h.ceiling = { tenant: true, platform: true };
    h.demoLoginRaw = JSON.stringify({ mode: "tenant", until: null });
    const res = await login("super_admin");
    expect(res).toHaveProperty("error");
    expect(h.createUser).not.toHaveBeenCalled();
    expect(h.signIn).not.toHaveBeenCalled();
    // ofis personası açık kalır
    expect(await login("owner")).toEqual({ redirectTo: "/app" });
  });

  it("süresi dolmuş platform demosu reddedilir; 'off' ofis kartlarını da kapatır", async () => {
    h.ceiling = { tenant: true, platform: true };
    h.demoLoginRaw = JSON.stringify({ mode: "tenant_platform", until: "2020-01-01T00:00:00.000Z" });
    expect(await login("super_admin")).toHaveProperty("error");
    h.demoLoginRaw = JSON.stringify({ mode: "off", until: null });
    expect(await login("owner")).toHaveProperty("error");
    expect(h.signIn).not.toHaveBeenCalled();
  });
});
