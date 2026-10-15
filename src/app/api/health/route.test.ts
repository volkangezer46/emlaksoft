import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/health (SK1): boşaltma dosyası 503 döndürür (Traefik sunucuyu havuzdan çıkarır) ve RELEASE_MIGRATION_COUNT
 * verilmişse "tüm dosyalar ledger'da" sayımı sınanır: RELEASE_MIGRATION uygulanmış olsa bile daha eski adlı bekleyen
 * dosya varsa 503. Supabase istemcisi sahte zincir; ağ yok.
 */
const state = vi.hoisted(() => ({
  drain: false,
  latest: { version: "20261016010300_x.sql", checksum: "abcdef0123456789", applied_at: "2026-10-16T00:00:00Z" } as
    | { version: string; checksum: string; applied_at: string }
    | null,
  count: 451 as number | null,
  countError: null as { code: string } | null,
  countCalls: 0,
}));

vi.mock("node:fs", async (orig) => {
  const real = await orig<typeof import("node:fs")>();
  return { ...real, existsSync: (p: string) => (p === "/tmp/emlaksoft-drain" ? state.drain : real.existsSync(p)) };
});

vi.mock("@/lib/health-service-probes", () => ({ probeSupabaseServices: vi.fn(async () => null) }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "tenants") {
        return { select: () => ({ limit: async () => ({ data: [{ id: "t" }], error: null }) }) };
      }
      // schema_migrations: son dosya (eq → maybeSingle) ya da sayım (select head → lte).
      return {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.head) {
            return {
              lte: async () => {
                state.countCalls++;
                return { count: state.countError ? null : state.count, error: state.countError };
              },
            };
          }
          return { eq: () => ({ maybeSingle: async () => ({ data: state.latest, error: null }) }) };
        },
      };
    },
  }),
}));

const ENV_KEYS = ["RELEASE_MIGRATION", "RELEASE_MIGRATION_CHECKSUM", "RELEASE_MIGRATION_COUNT", "RELEASE_SHA", "EMLAKSOFT_ENV"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.RELEASE_MIGRATION = "20261016010300_x.sql";
  process.env.RELEASE_MIGRATION_CHECKSUM = "abcdef0123456789";
  process.env.RELEASE_MIGRATION_COUNT = "451";
  process.env.RELEASE_SHA = "abc123";
  process.env.EMLAKSOFT_ENV = "production";
  state.drain = false;
  state.count = 451;
  state.countError = null;
  state.countCalls = 0;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function call() {
  const { GET } = await import("./route");
  const res = await GET(new Request("http://localhost/api/health"));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("/api/health (SK1)", () => {
  it("tüm dosyalar ledger'da → 200 {ok:true}", async () => {
    expect(await call()).toEqual({ status: 200, body: { ok: true } });
    expect(state.countCalls).toBe(1);
  });

  it("son dosya uygulanmış ama daha eski adlı dosya bekliyor (sayım eksik) → 503", async () => {
    state.count = 450;
    expect(await call()).toEqual({ status: 503, body: { ok: false } });
  });

  it("sayım okunamazsa kapalı başarısız → 503", async () => {
    state.countError = { code: "PGRST000" };
    expect((await call()).status).toBe(503);
  });

  it("RELEASE_MIGRATION_COUNT yoksa sayım yapılmaz (eski davranış)", async () => {
    delete process.env.RELEASE_MIGRATION_COUNT;
    state.count = 1;
    expect((await call()).status).toBe(200);
    expect(state.countCalls).toBe(0);
  });

  it("boşaltılan renk DB'ye gitmeden 503 {ok:false} döner", async () => {
    state.drain = true;
    expect(await call()).toEqual({ status: 503, body: { ok: false } });
    expect(state.countCalls).toBe(0);
  });
});
