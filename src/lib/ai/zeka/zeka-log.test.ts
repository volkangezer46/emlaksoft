import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ZekaResult } from "./types";

/**
 * SEC-3 (uygulama tarafı): günlük ve oy RPC'leri service_role istemcisiyle, maskelenmiş metinle ve sunucunun
 * çözdüğü kimlikle çağrılır. Anonim yüzeylerde kimlik geçmez; oy veren kimlik doğrulanmış oturumdan gelir.
 */

vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({ calls: [] as { fn: string; args: Record<string, unknown> }[], user: null as { id: string } | null }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.calls.push({ fn, args });
      return { data: fn === "zeka_query_feedback" ? true : "log-1", error: null };
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error("oturumlu istemci kullanılmamalı");
  },
}));
vi.mock("@/lib/supabase/auth-cache", () => ({ getRequestUser: async () => h.user }));

const result: ZekaResult = { surface: "app", engine: "local", intent: "data", answer: "", cards: [], actions: [], followUps: [], confidence: 0.7, answered: true };

describe("logZekaQuery / recordZekaFeedback", () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.user = null;
  });

  it("uygulama: ofis + kullanıcı geçer, metin maskelenir", async () => {
    const { logZekaQuery } = await import("./log");
    expect(await logZekaQuery({ surface: "app", query: "0532 123 45 67 numaralı müşteri", result, tenantId: "t1", actorId: "u1" })).toBe("log-1");
    expect(h.calls[0]!.fn).toBe("zeka_log_query");
    expect(h.calls[0]!.args).toMatchObject({ p_surface: "app", p_tenant_id: "t1", p_user_id: "u1" });
    expect(String(h.calls[0]!.args.p_query)).not.toContain("123 45 67");
  });

  it("genel: ofis/kullanıcı gönderilse de geçmez; vitrin: yalnız ofis; yönetim: yalnız personel", async () => {
    const { logZekaQuery } = await import("./log");
    await logZekaQuery({ surface: "public", query: "fiyat", result, tenantId: "t1", actorId: "u1" });
    await logZekaQuery({ surface: "vitrin", query: "fiyat", result, tenantId: "t1", actorId: "u1" });
    await logZekaQuery({ surface: "admin", query: "fiyat", result, tenantId: "t1", actorId: "s1" });
    expect(h.calls.map((c) => [c.args.p_tenant_id, c.args.p_user_id])).toEqual([
      [null, null],
      ["t1", null],
      [null, "s1"],
    ]);
  });

  it("oy: kimlik oturumdan; oturum yoksa null", async () => {
    const { recordZekaFeedback } = await import("./log");
    h.user = { id: "u9" };
    expect(await recordZekaFeedback("log-1", 1)).toBe(true);
    h.user = null;
    await recordZekaFeedback("log-1", -1);
    expect(h.calls.map((c) => c.args)).toEqual([
      { p_id: "log-1", p_vote: 1, p_user_id: "u9" },
      { p_id: "log-1", p_vote: -1, p_user_id: null },
    ]);
  });
});
