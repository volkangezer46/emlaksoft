import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings/read", () => ({ getSettings: async () => ({}) }));

import { runPlatformTaskReminders, runTenantHealthDaily } from "./tenant-health-job";

type Call = { table: string; op: string; payload?: unknown; filters: string[] };

/** Zincirlenebilir sahte PostgREST istemcisi: tablo başına yanıt + yapılan yazmaların kaydı. */
function fakeAdmin(opts: { probeRows?: unknown[]; inputs?: unknown[]; tasks?: unknown[]; missing?: boolean }) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    const result = () => {
      if (opts.missing) return { data: null, error: { code: "PGRST205", message: "Could not find the table" } };
      if (call.op !== "select") return { data: [], error: null };
      if (table === "tenant_health_daily") return { data: opts.probeRows ?? [], error: null };
      if (table === "platform_tasks") return { data: opts.tasks ?? [], error: null };
      return { data: [], error: null };
    };
    for (const m of ["select", "eq", "is", "not", "lte", "in", "order", "limit"]) {
      chain[m] = (...args: unknown[]) => {
        if (m !== "select") call.filters.push(`${m}:${String(args[0])}`);
        return chain;
      };
    }
    for (const m of ["insert", "upsert", "update"]) {
      chain[m] = (payload: unknown) => {
        call.op = m;
        call.payload = payload;
        return chain;
      };
    }
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    return chain;
  };
  const rpc = vi.fn(async () => (opts.missing ? { data: null, error: { code: "PGRST202", message: "not found" } } : { data: opts.inputs ?? [], error: null }));
  return { client: { from, rpc } as never, calls, rpc };
}

const NOW = Date.UTC(2026, 9, 13, 9);
const row = (id: string, extra: Record<string, unknown> = {}) => ({
  tenant_id: id,
  status: "active",
  plan: "office",
  sub_status: "active",
  login_days: 0,
  active_users: 0,
  extra_seats: 0,
  module_areas: 0,
  open_tickets: 0,
  csat_avg: null,
  csat_n: 0,
  overdue_invoices: 0,
  max_overdue_days: 0,
  ...extra,
});

describe("günlük sağlık skoru işi", () => {
  it("o gün zaten hesaplandıysa atlar (günde bir kez)", async () => {
    const f = fakeAdmin({ probeRows: [{ tenant_id: "x" }] });
    const r = await runTenantHealthDaily(f.client, NOW);
    expect(r).toEqual({ skipped: true, written: 0, error: null });
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("her ofis için günlük satır + son skor yazar; ağırlık bir sonraki hesaplamada etkili", async () => {
    const f = fakeAdmin({ inputs: [row("a"), row("b", { status: "suspended" })] });
    const r = await runTenantHealthDaily(f.client, NOW, { weights: { usage: 50, payment: 30, support: 20 } });
    expect(r.written).toBe(2);
    const daily = f.calls.find((c) => c.table === "tenant_health_daily" && c.op === "upsert")!.payload as { day: string; tenant_id: string; score: number }[];
    expect(daily.map((d) => [d.tenant_id, d.score])).toEqual([
      ["a", 50],
      ["b", 20],
    ]);
    expect(daily[0]!.day).toBe("2026-10-13");
    const latest = f.calls.find((c) => c.table === "platform_tenant_crm" && c.op === "upsert")!.payload as Record<string, unknown>[];
    expect(Object.keys(latest[0]!).sort()).toEqual(["health_score", "health_scored_at", "tenant_id"]); // sorumlu/aşama ezilmez

    const g = fakeAdmin({ inputs: [row("a")] });
    await runTenantHealthDaily(g.client, NOW + 86_400_000, { weights: { usage: 100, payment: 0, support: 0 } });
    const next = g.calls.find((c) => c.table === "tenant_health_daily" && c.op === "upsert")!.payload as { score: number }[];
    expect(next[0]!.score).toBe(0);
  });

  it("tablo/fonksiyon yoksa sessizce atlar", async () => {
    const f = fakeAdmin({ missing: true });
    expect(await runTenantHealthDaily(f.client, NOW)).toEqual({ skipped: true, written: 0, error: null });
    expect(await runPlatformTaskReminders(f.client, NOW)).toEqual({ skipped: true, notified: 0, error: null });
  });
});

describe("platform görev hatırlatması", () => {
  it("vadesi gelen görev sorumlunun bildirim kutusuna düşer ve işaretlenir", async () => {
    const f = fakeAdmin({ tasks: [{ id: "t1", tenant_id: "ten", title: "Kurulum görüşmesi", due_at: "2026-10-13T08:00:00Z", assignee_staff_id: "s1", tenant: { name: "Ofis A" } }] });
    const r = await runPlatformTaskReminders(f.client, NOW);
    expect(r.notified).toBe(1);
    const ins = f.calls.find((c) => c.table === "platform_notifications" && c.op === "insert")!.payload as { staff_id: string; href: string; title: string }[];
    expect(ins[0]).toMatchObject({ staff_id: "s1", href: "/admin/tenants/ten?sekme=iliski", title: "Görevin vadesi geldi" });
    const upd = f.calls.find((c) => c.table === "platform_tasks" && c.op === "update")!;
    expect(upd.filters).toContain("is:notified_at");
  });
});
