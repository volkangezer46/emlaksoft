import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type NotifRow = { tenant_id: string; title: string; href: string; dedupe_key?: string | null };

const state = {
  rentals: [] as Record<string, unknown>[],
  charges: [] as Record<string, unknown>[],
  rpc: { data: {}, error: null } as { data: unknown; error: { code?: string; message: string } | null },
  /** notifications tablosuna yapılan DOĞRUDAN sorgu/yazma (gömülü notify-batch mock'u dışında): olmamalı. */
  notificationsTouched: [] as string[],
  inCalls: [] as { table: string; col: string }[],
  notifWritten: [] as NotifRow[],
  notifFailed: 0,
  seenKeys: new Set<string>() as Set<string> | null,
  reminders: { enabledTenants: 0, office: 0, sms: 0, skippedOptOut: 0, smsFailed: 0, schemaMissing: false },
  remindersThrow: false,
  payoutThrow: false,
  buildingThrow: false,
  heartbeat: [] as { status: string; detail?: string }[],
};

vi.mock("@/lib/cron-heartbeat", () => ({
  recordHeartbeat: async (_job: string, status: string, detail?: string) => {
    state.heartbeat.push({ status, detail });
    return true;
  },
}));
vi.mock("@/lib/tufe-server", () => ({ loadTufeTable: async () => ({}) }));
vi.mock("@/lib/tufe", () => ({
  computeLegalIncreaseIn: () => ({ official: false, newRent: 0, appliedRate: 0 }),
}));
vi.mock("@/lib/modules/state", () => ({
  getDisabledModulesByTenant: async () => new Map(),
  isDisabledFor: () => false,
  skippedTenantsNote: () => "",
  tenantsDisabledFor: () => [],
}));
vi.mock("@/lib/rent-reminders/run", () => ({
  runRentReminders: async () => {
    if (state.remindersThrow) throw new Error("boom");
    return state.reminders;
  },
}));
vi.mock("@/lib/property-management/payout-reminders", () => ({
  runOwnerPayoutReminders: async () => {
    if (state.payoutThrow) throw new Error("boom");
    return { notified: 0 };
  },
}));
vi.mock("@/lib/building-management/reminders", () => ({
  runBuildingDueReminders: async () => {
    if (state.buildingThrow) throw new Error("boom");
    return { notified: 0 };
  },
}));
vi.mock("@/lib/notify-batch", () => ({
  findNotifiedKeys: async () => state.seenKeys,
  insertNotifications: async (_a: unknown, rows: NotifRow[]) => rows.length,
  insertNotificationsDetailed: async (_a: unknown, rows: NotifRow[]) => {
    if (state.notifFailed > 0) return { written: 0, duplicates: 0, failed: rows.length };
    state.notifWritten.push(...rows);
    return { written: rows.length, duplicates: 0, failed: 0 };
  },
}));

function builder(table: string) {
  let selectCols = "";
  let op: "select" | "upsert" | "update" = "select";
  const q: Record<string, unknown> = {
    select(cols: string) {
      selectCols = cols;
      return q;
    },
    eq: () => q,
    lte: () => q,
    order: () => q,
    range: () => q,
    in(col: string) {
      state.inCalls.push({ table, col });
      return q;
    },
    upsert() {
      op = "upsert";
      return q;
    },
    update() {
      op = "update";
      return q;
    },
    insert() {
      if (table === "notifications") state.notificationsTouched.push("insert");
      return q;
    },
    then(resolve: (v: unknown) => unknown) {
      let value: unknown = { data: [], error: null };
      if (table === "rentals") value = { data: state.rentals, error: null };
      else if (table === "rent_charges" && op === "upsert") value = { data: [{ id: "new" }], error: null };
      else if (table === "rent_charges" && op === "update") value = { data: null, error: null };
      else if (table === "rent_charges") value = { data: selectCols === "rental_id" ? [] : state.charges, error: null };
      return Promise.resolve(value).then(resolve);
    },
  };
  return q;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "notifications") state.notificationsTouched.push("from");
      return builder(table);
    },
    rpc: async () => state.rpc,
  }),
}));

import { GET } from "./route";

const req = (auth?: string) =>
  new NextRequest("http://localhost/api/cron/kira-tahakkuk", { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T09:00:00Z"));
  state.rentals = [
    {
      id: "r1",
      tenant_id: "t1",
      monthly_rent: 20000,
      due_day: 5,
      start_date: "2025-12-01",
      end_date: null,
      property: { property_code: "P-1", title: "Daire" },
    },
  ];
  state.charges = [
    {
      id: "c1",
      tenant_id: "t1",
      rental_id: "r1",
      period: "2026-10-01",
      amount: 20000,
      rental: { due_day: 5, property: { property_code: "P-1", title: "Daire" } },
    },
  ];
  state.rpc = { data: {}, error: null };
  state.notificationsTouched = [];
  state.inCalls = [];
  state.notifWritten = [];
  state.notifFailed = 0;
  state.seenKeys = new Set();
  state.reminders = { enabledTenants: 0, office: 0, sms: 0, skippedOptOut: 0, smsFailed: 0, schemaMissing: false };
  state.remindersThrow = false;
  state.payoutThrow = false;
  state.buildingThrow = false;
  state.heartbeat = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/cron/kira-tahakkuk", () => {
  it("yetkisiz istek 401", async () => {
    expect((await GET(req("Bearer yanlis"))).status).toBe(401);
    expect(state.heartbeat).toEqual([]);
  });

  it("temiz koşu ok yazar", async () => {
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(state.heartbeat.at(-1)?.status).toBe("ok");
  });

  it("gecikme bildirimi rent-overdue:<tahakkuk> dedupe_key ile yazılır", async () => {
    await GET(req("Bearer s3cret"));
    const overdue = state.notifWritten.find((n) => n.title === "Geciken kira tahakkuku");
    expect(overdue?.dedupe_key).toBe("rent-overdue:c1");
    expect(overdue?.dedupe_key?.startsWith("rent-overdue:")).toBe(true);
  });

  it("yenileme dedupe_key rent-renew:<kira>:<yıl>; notifications üzerinde href .in() sorgusu yok", async () => {
    await GET(req("Bearer s3cret"));
    const renew = state.notifWritten.find((n) => n.title === "Kira yenileme yaklaşıyor");
    expect(renew?.dedupe_key).toBe("rent-renew:r1:2026");
    expect(state.inCalls.filter((c) => c.table === "notifications")).toEqual([]);
    expect(state.notificationsTouched).toEqual([]);
  });

  it("yenileme daha önce bildirilmişse tekrar yazılmaz", async () => {
    state.seenKeys = new Set(["rent-renew:r1:2026"]);
    await GET(req("Bearer s3cret"));
    expect(state.notifWritten.some((n) => n.title === "Kira yenileme yaklaşıyor")).toBe(false);
  });

  it("recurring_run_due şema-dışı hata -> heartbeat error", async () => {
    state.rpc = { data: null, error: { code: "57014", message: "timeout" } };
    await GET(req("Bearer s3cret"));
    expect(state.heartbeat.at(-1)?.status).toBe("error");
  });

  it("recurring_run_due fonksiyon yok (PGRST202) -> ok", async () => {
    state.rpc = { data: null, error: { code: "PGRST202", message: "yok" } };
    await GET(req("Bearer s3cret"));
    expect(state.heartbeat.at(-1)?.status).toBe("ok");
  });

  it("recurring_run_due {failed:2} -> error ve notta 2 hata", async () => {
    state.rpc = { data: { posted: 1, failed: 2 }, error: null };
    await GET(req("Bearer s3cret"));
    const hb = state.heartbeat.at(-1);
    expect(hb?.status).toBe("error");
    expect(hb?.detail).toContain("2 hata");
  });

  it("4b (mülk sahibi hatırlatması) catch -> error", async () => {
    state.payoutThrow = true;
    await GET(req("Bearer s3cret"));
    expect(state.heartbeat.at(-1)?.status).toBe("error");
  });

  it("4c (bina aidat) catch -> error", async () => {
    state.buildingThrow = true;
    await GET(req("Bearer s3cret"));
    expect(state.heartbeat.at(-1)?.status).toBe("error");
  });

  it("SMS hatası (smsFailed) -> error", async () => {
    state.reminders = { ...state.reminders, enabledTenants: 1, smsFailed: 2 };
    await GET(req("Bearer s3cret"));
    const hb = state.heartbeat.at(-1);
    expect(hb?.status).toBe("error");
    expect(hb?.detail).toContain("2 hata");
  });

  it("gecikme bildirimi yazılamazsa error", async () => {
    state.notifFailed = 1;
    await GET(req("Bearer s3cret"));
    expect(state.heartbeat.at(-1)?.status).toBe("error");
  });
});
