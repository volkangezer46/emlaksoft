import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = {
  rpc: { data: 3, error: null } as { data: unknown; error: { code?: string; message: string } | null },
  /** Süpürme idempotent: ilk koşu serbest bırakır, sonraki koşu 0 döner. */
  drain: false,
  calls: 0,
  heartbeat: [] as { status: string; detail?: string }[],
};

vi.mock("@/lib/cron-heartbeat", () => ({
  recordHeartbeat: async (_job: string, status: string, detail?: string) => {
    state.heartbeat.push({ status, detail });
    return true;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async () => {
      state.calls += 1;
      if (state.drain && !state.rpc.error) {
        const data = state.calls === 1 ? state.rpc.data : 0;
        return { data, error: null };
      }
      return state.rpc;
    },
  }),
}));
// Mutabakat gövdesinin diğer bağımlılıkları (yalnız ef_sweep yolu çalışır).
vi.mock("@/lib/billing/fulfillment", () => ({ fulfillBillingPaymentAtomic: vi.fn() }));
vi.mock("@/lib/growth/engine", () => ({ processClaims: vi.fn() }));
vi.mock("@/lib/try-credits/wallet", () => ({ tryReleaseDead: vi.fn() }));
vi.mock("@/lib/insights/engine", () => ({ runInsightEngine: vi.fn() }));
vi.mock("@/lib/insights/platform-engine", () => ({ runPlatformInsightEngine: vi.fn() }));
vi.mock("@/lib/ai/insight-narrative", () => ({ generateInsightNarrative: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyTenant: vi.fn() }));

import { GET } from "./route";

const req = (auth?: string) =>
  new NextRequest("http://localhost/api/cron/ef-kontor-sweep", { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "s3cret");
  state.rpc = { data: 3, error: null };
  state.drain = false;
  state.calls = 0;
  state.heartbeat = [];
});

describe("GET /api/cron/ef-kontor-sweep", () => {
  it("yetkisiz istek 401 döner, RPC çağrılmaz", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer yanlis"))).status).toBe(401);
    expect(state.calls).toBe(0);
    expect(state.heartbeat).toEqual([]);
  });

  it("başarılı süpürme ok yazar ve serbest bırakılan sayıyı döndürür", async () => {
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, released: 3 });
    expect(state.heartbeat.at(-1)).toEqual({ status: "ok", detail: "3 rezerv serbest bırakıldı" });
  });

  it("RPC hatası (şema dışı kod) heartbeat'i error yapar ve 500 döner", async () => {
    state.rpc = { data: null, error: { code: "57014", message: "statement timeout" } };
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(500);
    expect(state.heartbeat.at(-1)?.status).toBe("error");
  });

  it("eksik şema (PGRST202 / 42883 / PGRST205) ok + atlandı yazar", async () => {
    for (const code of ["PGRST202", "42883", "PGRST205"]) {
      state.rpc = { data: null, error: { code, message: "yok" } };
      const res = await GET(req("Bearer s3cret"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, released: null });
      expect(state.heartbeat.at(-1)?.status).toBe("ok");
      expect(state.heartbeat.at(-1)?.detail).toContain("atlandı");
    }
  });

  it("ikinci koşu idempotenttir: tekrar serbest bırakılacak rezerv yoksa 0 ve ok", async () => {
    state.drain = true;
    const first = await (await GET(req("Bearer s3cret"))).json();
    const second = await (await GET(req("Bearer s3cret"))).json();
    expect(first).toEqual({ ok: true, released: 3 });
    expect(second).toEqual({ ok: true, released: 0 });
    expect(state.heartbeat.map((h) => h.status)).toEqual(["ok", "ok"]);
  });
});
