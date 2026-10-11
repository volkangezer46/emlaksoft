import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = {
  invoices: [] as Record<string, unknown>[],
  invoicesError: null as string | null,
  subs: [] as Record<string, unknown>[],
  insertFailed: 0,
  inserted: [] as { dedupe_key?: string | null }[],
  updates: [] as { stage: number }[],
  updateError: false,
  heartbeat: [] as { status: string; detail?: string }[],
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cron-heartbeat", () => ({
  recordHeartbeat: async (_j: string, status: string, detail?: string) => {
    state.heartbeat.push({ status, detail });
    return true;
  },
}));
vi.mock("@/lib/platform-notify", () => ({ notifyPlatformStaff: async () => undefined }));
vi.mock("@/lib/billing/auto-renew", () => ({
  runAutoRenewPass: async () => ({ enabled: false, attempted: 0, charged: 0, failed: 0, skipped: 0 }),
}));
vi.mock("@/lib/notify-batch", () => ({
  findNotifiedIds: async () => new Set<string>(),
  insertNotificationsDetailed: async (_a: unknown, rows: { dedupe_key?: string | null }[]) => {
    if (state.insertFailed > 0) return { written: rows.length - state.insertFailed, duplicates: 0, failed: state.insertFailed };
    state.inserted.push(...rows);
    return { written: rows.length, duplicates: 0, failed: 0 };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      Object.assign(q, {
        select: chain,
        eq: chain,
        not: chain,
        lt: chain,
        limit: async () =>
          table === "invoices"
            ? { data: state.invoicesError ? null : state.invoices, error: state.invoicesError ? { message: state.invoicesError } : null }
            : { data: state.subs, error: null },
        update: (v: { reminder_count: number }) => ({
          in: async () => {
            state.updates.push({ stage: v.reminder_count });
            return { error: state.updateError ? { message: "x" } : null };
          },
        }),
      });
      return q;
    },
  }),
}));

import { GET } from "./route";

const req = () => new NextRequest("http://localhost/api/cron/dunning", { headers: { authorization: "Bearer s3cret" } });
const overdue = (id: string) => ({
  id,
  tenant_id: "t1",
  invoice_no: `F-${id}`,
  reminder_count: 0,
  tenant: { name: "Ofis" },
  due_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
});

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "s3cret");
  Object.assign(state, { invoices: [], invoicesError: null, subs: [], insertFailed: 0, inserted: [], updates: [], updateError: false, heartbeat: [] });
});
afterEach(() => vi.unstubAllEnvs());

describe("dunning cron dürüst heartbeat + dedupe", () => {
  it("temiz koşu: ok, bildirim dedupe_key dunning:<fatura>:<kademe>", async () => {
    state.invoices = [overdue("i1")];
    await GET(req());
    expect(state.heartbeat.at(-1)?.status).toBe("ok");
    expect(state.inserted[0]?.dedupe_key).toBe("dunning:i1:1");
    expect(state.updates).toEqual([{ stage: 1 }]);
  });

  it("fatura sorgusu hata verirse heartbeat error", async () => {
    state.invoicesError = "boom";
    await GET(req());
    expect(state.heartbeat.at(-1)?.status).toBe("error");
    expect(state.heartbeat.at(-1)?.detail).toContain("hata");
  });

  it("kısmi bildirim yazımı: error ve sayaç ilerletilmez", async () => {
    state.invoices = [overdue("i1"), overdue("i2")];
    state.insertFailed = 1;
    await GET(req());
    expect(state.heartbeat.at(-1)?.status).toBe("error");
    expect(state.updates).toEqual([]);
  });

  it("reminder_count güncellemesi başarısızsa error", async () => {
    state.invoices = [overdue("i1")];
    state.updateError = true;
    await GET(req());
    expect(state.heartbeat.at(-1)?.status).toBe("error");
  });

  it("abonelik hatırlatması 3 günlük pencere dedupe_key taşır; tavan dolarsa error", async () => {
    state.subs = Array.from({ length: 500 }, (_, i) => ({ id: `s${i}`, tenant_id: `t${i}`, current_period_end: null }));
    await GET(req());
    expect(state.inserted[0]?.dedupe_key).toMatch(/^dunsub:s0:\d+$/);
    expect(state.heartbeat.at(-1)?.status).toBe("error");
    expect(state.heartbeat.at(-1)?.detail).toContain("TAVAN");
  });
});
