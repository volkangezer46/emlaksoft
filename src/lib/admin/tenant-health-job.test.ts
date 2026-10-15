import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings/read", () => ({ getSettings: async () => ({}), getSetting: async () => "" }));

import { runPlatformTaskReminders, runTenantHealthDaily } from "./tenant-health-job";
import { getPlan } from "@/lib/billing/plans";

type Call = { table: string; op: string; payload?: unknown; filters: string[] };

/** Zincirlenebilir sahte PostgREST istemcisi: tablo başına yanıt + yapılan yazmaların kaydı. */
function fakeAdmin(opts: { dailyCount?: number; tenantCount?: number; inputs?: unknown[]; tasks?: unknown[]; missing?: boolean; setup?: unknown[] }) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    const result = () => {
      if (opts.missing) return { data: null, error: { code: "PGRST205", message: "Could not find the table" } };
      if (call.op !== "select") return { data: [], error: null };
      if (table === "tenant_health_daily") return { data: null, count: opts.dailyCount ?? 0, error: null };
      if (table === "tenants") return { data: null, count: opts.tenantCount ?? 0, error: null };
      if (table === "platform_tasks") return { data: opts.tasks ?? [], error: null };
      return { data: [], error: null };
    };
    for (const m of ["select", "eq", "neq", "is", "not", "lte", "in", "order", "limit"]) {
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
  const missingFn = { data: null, error: { code: "PGRST202", message: "not found" } };
  const rpc = vi.fn(async (name: string) => {
    // Kurulum olguları (SN5) ayrı fonksiyon: verilmezse "fonksiyon yok" (skor kurulum girdisiz).
    if (name === "platform_tenant_onboarding_facts") return opts.setup && !opts.missing ? { data: opts.setup, error: null } : missingFn;
    return opts.missing ? missingFn : { data: opts.inputs ?? [], error: null };
  });
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
  it("o gün tüm ofisler hesaplandıysa atlar (günde bir kez)", async () => {
    const f = fakeAdmin({ dailyCount: 3, tenantCount: 3 });
    const r = await runTenantHealthDaily(f.client, NOW);
    expect(r).toEqual({ skipped: true, written: 0, error: null });
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it("o günün turu yarım kaldıysa (satır sayısı eksik) yeniden hesaplar", async () => {
    const f = fakeAdmin({ dailyCount: 1, tenantCount: 3, inputs: [row("a"), row("b"), row("c")] });
    const r = await runTenantHealthDaily(f.client, NOW);
    expect(f.rpc).toHaveBeenCalled();
    expect(r).toEqual({ skipped: false, written: 3, error: null });
  });

  it("adminden eklenen pakette koltuk sınırı katalogdan (Ofis'e düşmez); taban kimlik aynı", async () => {
    const custom = { ...getPlan("office"), id: "ofis_plus", tier: "office" as const, custom: true, limits: { seats: 20, customers: null, activeProperties: null, branches: 5 } };
    const f = fakeAdmin({ inputs: [row("a", { plan: "ofis_plus", active_users: 4 }), row("b", { active_users: 4 })] });
    await runTenantHealthDaily(f.client, NOW, { weights: { usage: 100, payment: 0, support: 0 }, catalog: [custom] });
    const daily = f.calls.find((c) => c.table === "tenant_health_daily" && c.op === "upsert")!.payload as { tenant_id: string; inputs: { seatLimit: number } }[];
    expect(daily.find((d) => d.tenant_id === "a")!.inputs.seatLimit).toBe(20);
    expect(daily.find((d) => d.tenant_id === "b")!.inputs.seatLimit).toBe(getPlan("office").limits.seats);
  });

  it("aşamayı kalıcı yazmaz (boş aşama okuma anında durumdan türetilir)", async () => {
    const f = fakeAdmin({ inputs: [row("a", { status: "trial" })] });
    await runTenantHealthDaily(f.client, NOW);
    expect(f.calls.some((c) => c.table === "platform_tenant_crm" && c.op === "update")).toBe(false);
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

  it("kurulum ilerlemesi biliniyorsa kullanım bileşenine girer; bilinmiyorsa skor eski formülle", async () => {
    const facts = (id: string, done: boolean) => ({
      tenant_id: id,
      tenant_name: id,
      status: "active",
      plan: "office",
      created_at: "2026-10-01T00:00:00Z",
      province_id: done ? "p" : null,
      district_id: done ? "d" : null,
      address_line: done ? "Atatürk Cad. No: 10 Merkez" : null,
      license_no: done ? "1234567" : null,
      owner_you_done: done,
      members: done ? 3 : 1,
      pool_enabled: done,
      pool_advisor_records: done ? 2 : 0,
      published_properties: 0,
      active_integrations: 0,
      sub_status: done ? "active" : "trialing",
      office_finance: done ? 1 : 0,
      office_recurring: 0,
      rentals_answered: done,
      portal_declared: done ? 1 : 0,
      eids_received: done,
    });
    const f = fakeAdmin({ inputs: [row("a"), row("b")], setup: [facts("a", true), facts("b", false)] });
    await runTenantHealthDaily(f.client, NOW, { weights: { usage: 100, payment: 0, support: 0 } });
    const daily = f.calls.find((c) => c.table === "tenant_health_daily" && c.op === "upsert")!.payload as {
      tenant_id: string;
      score: number;
      inputs: { setupPercent: number | null; reasons: string[] };
    }[];
    const a = daily.find((d) => d.tenant_id === "a")!;
    const b = daily.find((d) => d.tenant_id === "b")!;
    expect(a.inputs.setupPercent).toBe(100);
    expect(a.score).toBe(15); // kullanım: %85 x 0 + %15 x 1
    expect(b.inputs.setupPercent).toBe(0);
    expect(b.score).toBe(0);

    const g = fakeAdmin({ inputs: [row("a")] });
    await runTenantHealthDaily(g.client, NOW, { weights: { usage: 100, payment: 0, support: 0 } });
    const plain = g.calls.find((c) => c.table === "tenant_health_daily" && c.op === "upsert")!.payload as { score: number; inputs: { setupPercent: number | null } }[];
    expect(plain[0]!.inputs.setupPercent).toBeNull();
    expect(plain[0]!.score).toBe(0);
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
    expect(ins[0]).toMatchObject({ staff_id: "s1", href: "/admin/gorevler?gorev=t1", title: "Görevin vadesi geldi" });
    const upd = f.calls.find((c) => c.table === "platform_tasks" && c.op === "update")!;
    expect(upd.filters).toContain("is:notified_at");
  });
});
