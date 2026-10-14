import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * YD3 randevu hatırlatması: bildirim YALNIZ randevunun sahibine (atanan danışman, yoksa açan) yazılır; sahipsiz randevu
 * ofis geneline bildirim üretmez (sayılır). Pencere 24 SAAT; müşteri SMS adımı ayrık ve hatası danışman adımını bozmaz.
 */
type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  appointments: [] as Row[],
  window: null as null | { gte: string; lte: string },
  inserted: [] as Row[],
  heartbeat: vi.fn(async (..._args: unknown[]) => true),
  customerStep: vi.fn(async (..._args: unknown[]) => ({ sent: 0, failed: 0, note: null as string | null })),
}));

function appointmentsQuery() {
  const chain = {
    select: () => chain,
    gte: (_k: string, v: string) => ((h.window = { gte: v, lte: h.window?.lte ?? "" }), chain),
    lte: (_k: string, v: string) => ((h.window = { gte: h.window?.gte ?? "", lte: v }), chain),
    neq: () => chain,
    eq: () => chain,
    order: () => chain,
    range: () => chain,
    then: <T,>(resolve: (v: { data: Row[]; error: null }) => T) => Promise.resolve(resolve({ data: h.appointments, error: null })),
  };
  return chain;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cron-auth", () => ({ authorizeCron: () => null }));
vi.mock("@/lib/cron-pause", () => ({ beginCronRun: async () => null }));
vi.mock("@/lib/cron-heartbeat", () => ({ recordHeartbeat: h.heartbeat }));
vi.mock("@/lib/base-url", () => ({ getBaseUrl: () => "https://app.test" }));
vi.mock("@/lib/integrations-api/webhooks", () => ({ runWebhookRetries: async () => ({ attempted: 0, delivered: 0 }) }));
vi.mock("@/lib/appointment-customer-messages", () => ({ runCustomerReminderStep: h.customerStep }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => appointmentsQuery() }) }));
vi.mock("@/lib/notify-batch", () => ({
  findNotifiedIds: async () => new Set<string>(),
  findNotifiedKeys: async () => new Set<string>(),
  insertNotificationsDetailed: async (_admin: unknown, rows: Row[]) => {
    h.inserted.push(...rows);
    return { written: rows.length, duplicates: 0, failed: 0 };
  },
}));

import { GET } from "./route";

const T = "11111111-1111-4111-8111-111111111111";
const appt = (id: string, extra: Row = {}): Row => ({
  id,
  tenant_id: T,
  scheduled_at: "2026-10-15T11:30:00.000Z",
  confirm_token: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  assigned_to: null,
  created_by: null,
  customer: { full_name: "Ayşe Yılmaz" },
  ...extra,
});
const req = () => new NextRequest("https://app.test/api/cron/randevu-hatirlat", { headers: { authorization: "Bearer x" } });

beforeEach(() => {
  h.appointments = [];
  h.inserted = [];
  h.window = null;
  h.heartbeat.mockClear();
  h.customerStep.mockClear();
});

describe("randevu-hatirlat: hedefli hatırlatma", () => {
  it("bildirim yalnız atanan danışmana gider; sahipsiz randevu ofis geneline yazılmaz", async () => {
    h.appointments = [
      appt("a1", { assigned_to: "u-danisman", created_by: "u-mudur" }),
      appt("a2", { assigned_to: null, created_by: "u-acan" }),
      appt("a3"),
    ];
    const res = await GET(req());
    const body = (await res.json()) as { notified: number; unowned: number };

    expect(h.inserted).toHaveLength(2);
    expect(h.inserted.every((r) => typeof r.user_id === "string" && r.user_id)).toBe(true);
    expect(h.inserted.find((r) => String(r.href).endsWith("a1"))?.user_id).toBe("u-danisman");
    expect(h.inserted.find((r) => String(r.href).endsWith("a2"))?.user_id).toBe("u-acan");
    expect(h.inserted.some((r) => String(r.href).endsWith("a3"))).toBe(false);
    expect(h.inserted[0]!.href).toBe("/app/randevular?randevu=a1");
    expect(body.notified).toBe(2);
    expect(body.unowned).toBe(1);
    expect(String(h.heartbeat.mock.calls[0]![2])).toContain("1 sahipsiz randevu atlandı");
  });

  it("pencere önümüzdeki 24 saattir (gün değil)", async () => {
    await GET(req());
    const span = new Date(h.window!.lte).getTime() - new Date(h.window!.gte).getTime();
    expect(span).toBe(24 * 3_600_000);
  });

  it("müşteri adımı hatası danışman hatırlatmasını bozmaz", async () => {
    h.appointments = [appt("a1", { assigned_to: "u1" })];
    h.customerStep.mockRejectedValueOnce(new Error("sms down"));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(h.inserted).toHaveLength(1);
    expect(String(h.heartbeat.mock.calls[0]![2])).toContain("müşteri adımı hata");
  });
});
