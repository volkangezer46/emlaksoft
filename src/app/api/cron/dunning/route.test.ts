import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Ev = { tenant_id: string; invoice_id: string; stage: string; channel: string; result: string; detail?: string | null };

const state = {
  invoices: [] as Record<string, unknown>[],
  invoicesError: null as string | null,
  subs: [] as Record<string, unknown>[],
  insertFailed: 0,
  inserted: [] as { dedupe_key?: string | null; title?: string; body?: string }[],
  updates: [] as { stage: number }[],
  updateError: false,
  heartbeat: [] as { status: string; detail?: string }[],
  settings: {} as Record<string, unknown>,
  events: [] as Ev[],
  eventsMissing: false,
  tenantUpdates: [] as { id: string; status: string }[],
  audits: [] as { action: string; entity_id: string; meta: Record<string, unknown> }[],
  staff: [] as { title: string }[],
  emailOn: false,
  emails: [] as { to: string; subject: string }[],
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cron-heartbeat", () => ({
  recordHeartbeat: async (_j: string, status: string, detail?: string) => {
    state.heartbeat.push({ status, detail });
    return true;
  },
}));
vi.mock("@/lib/platform-notify", () => ({
  notifyPlatformStaff: async (n: { title: string }) => {
    state.staff.push({ title: n.title });
  },
}));
vi.mock("@/lib/billing/auto-renew", () => ({
  runAutoRenewPass: async () => ({ enabled: false, attempted: 0, charged: 0, failed: 0, skipped: 0 }),
}));
vi.mock("@/lib/billing/dunning-policy", async (orig) => {
  const actual = await orig<typeof import("@/lib/billing/dunning-policy")>();
  return { ...actual, loadDunningPolicy: async () => actual.policyFromSettings(state.settings) };
});
vi.mock("@/lib/email/provider", () => ({
  resolveEmailChannelConfig: async () =>
    state.emailOn ? { enabled: true, reason: null, apiKey: "k" } : { enabled: false, reason: "Resend API anahtarı tanımlı değil", apiKey: null },
  sendEmail: async (m: { to: string; subject: string }) => {
    state.emails.push(m);
    return { ok: true, id: "e1" };
  },
}));
vi.mock("@/lib/messaging/netgsm", () => ({ getNetgsmConfig: async () => null, sendSmsWithConfig: async () => ({ ok: true }) }));
vi.mock("@/lib/notify-batch", () => ({
  findNotifiedIds: async () => new Set<string>(),
  insertNotificationsDetailed: async (_a: unknown, rows: { dedupe_key?: string | null }[]) => {
    if (state.insertFailed > 0) return { written: rows.length - state.insertFailed, duplicates: 0, failed: state.insertFailed };
    state.inserted.push(...rows);
    return { written: rows.length, duplicates: 0, failed: 0 };
  },
}));

function upsertEvents(rows: Ev[]) {
  const fresh: { id: number }[] = [];
  if (!state.eventsMissing) {
    for (const r of rows) {
      const dup = state.events.some((e) => e.invoice_id === r.invoice_id && e.stage === r.stage && e.channel === r.channel);
      if (!dup) {
        state.events.push({ ...r });
        fresh.push({ id: state.events.length - 1 });
      }
    }
  }
  const res = { data: fresh, error: state.eventsMissing ? { code: "PGRST205", message: "dunning_events schema cache" } : null };
  return { select: async () => res, then: (f: (v: typeof res) => unknown) => Promise.resolve(res).then(f) };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "sahip@ofis.com" } } }) } },
    from: (table: string) => {
      if (table === "dunning_events") {
        return {
          upsert: (rows: Ev[]) => upsertEvents(rows),
          update: (v: { result: string; detail: string | null }) => ({
            eq: async (_c: string, id: number) => {
              Object.assign(state.events[id], v);
              return { error: null };
            },
          }),
        };
      }
      if (table === "tenants") {
        return {
          update: (v: { status: string }) => {
            let id = "";
            const q = {
              eq: (_c: string, val: string) => ((id = val), q),
              in: () => q,
              select: async () => {
                state.tenantUpdates.push({ id, status: v.status });
                return { data: [{ id }], error: null };
              },
            };
            return q;
          },
        };
      }
      if (table === "platform_audit_logs") {
        return {
          insert: async (row: { action: string; entity_id: string; meta: Record<string, unknown> }) => {
            state.audits.push(row);
            return { error: null };
          },
        };
      }
      if (table === "profiles") {
        const q: Record<string, unknown> = {};
        const chain = () => q;
        Object.assign(q, {
          select: chain,
          in: chain,
          eq: chain,
          order: chain,
          limit: async () => ({ data: [{ id: "u1", tenant_id: "t1", phone: "05321112233" }], error: null }),
        });
        return q;
      }
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
const overdue = (id: string, days = 2, reminder = 0) => ({
  id,
  tenant_id: "t1",
  invoice_no: `F-${id}`,
  reminder_count: reminder,
  tenant: { name: "Ofis", status: "past_due" },
  // Gün sınırına düşmemek için yarım gün ekle.
  due_at: new Date(Date.now() - days * 86_400_000 - 43_200_000).toISOString(),
});

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "s3cret");
  Object.assign(state, {
    invoices: [],
    invoicesError: null,
    subs: [],
    insertFailed: 0,
    inserted: [],
    updates: [],
    updateError: false,
    heartbeat: [],
    settings: {},
    events: [],
    eventsMissing: false,
    tenantUpdates: [],
    audits: [],
    staff: [],
    emailOn: false,
    emails: [],
  });
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

describe("dunning politikası adminden (AD3)", () => {
  it("kademe günleri 2/5/10 yapılınca bildirim bu günlerde gider", async () => {
    state.settings = { "dunning.stage1_days": 2, "dunning.stage2_days": 5, "dunning.stage3_days": 10 };
    state.invoices = [overdue("a", 1), overdue("b", 2), overdue("c", 4), overdue("d", 5), overdue("e", 9), overdue("f", 10)];
    await GET(req());
    const keys = state.inserted.map((r) => r.dedupe_key).sort();
    // 1. gün: henüz kademe yok; 2-4: 1. kademe; 5-9: 2. kademe; 10+: 3. kademe.
    expect(keys).toEqual(["dunning:b:1", "dunning:c:1", "dunning:d:2", "dunning:e:2", "dunning:f:3"]);
    expect(state.updates).toEqual(expect.arrayContaining([{ stage: 1 }, { stage: 2 }, { stage: 3 }]));
    // Askı kapalı (varsayılan): son kademede yalnız personele aday bildirimi, ofis askıya alınmaz.
    expect(state.staff.map((s) => s.title)).toEqual(["Askıya alma adayı"]);
    expect(state.tenantUpdates).toEqual([]);
  });

  it("varsayılan (ayar yok) 1/4/8 bugünkü davranış", async () => {
    state.invoices = [overdue("a", 1), overdue("b", 4), overdue("c", 8)];
    await GET(req());
    expect(state.inserted.map((r) => r.dedupe_key).sort()).toEqual(["dunning:a:1", "dunning:b:2", "dunning:c:3"]);
  });

  it("otomatik askı günü N: N. günde ödenmemiş ofis suspended olur ve audit düşer", async () => {
    state.settings = { "dunning.auto_suspend_days": 12, "dunning.final_warning_days": 0 };
    state.invoices = [overdue("x", 12, 3)];
    await GET(req());
    expect(state.tenantUpdates).toEqual([{ id: "t1", status: "suspended" }]);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({ action: "tenant.suspend", entity_id: "t1", meta: { source: "dunning", auto: true, invoice_id: "x" } });
    expect(state.events.some((e) => e.stage === "suspend" && e.result === "suspended")).toBe(true);
    expect(state.inserted.some((r) => r.dedupe_key === "dunning:x:suspend")).toBe(true);
    expect(state.heartbeat.at(-1)?.status).toBe("ok");
  });

  it("askı günü gelmemişse askı yok; son uyarı askıdan önce gider", async () => {
    state.settings = { "dunning.auto_suspend_days": 12, "dunning.final_warning_days": 2 };
    state.invoices = [overdue("x", 10, 3)];
    await GET(req());
    expect(state.tenantUpdates).toEqual([]);
    expect(state.inserted.map((r) => r.dedupe_key)).toEqual(["dunning:x:final"]);
  });

  it("e-posta kanalı kapalıyken e-posta kademesi atlanır, günlüğe 'kanal kapalı' yazılır", async () => {
    state.settings = { "dunning.stage1_channels": "in_app_email" };
    state.emailOn = false;
    state.invoices = [overdue("m", 1)];
    await GET(req());
    expect(state.emails).toEqual([]);
    const ev = state.events.find((e) => e.channel === "email");
    expect(ev).toMatchObject({ invoice_id: "m", stage: "stage1", result: "channel_disabled" });
    expect(ev?.detail).toContain("kanal kapalı");
    // Uygulama içi bildirim yine gider.
    expect(state.inserted.map((r) => r.dedupe_key)).toEqual(["dunning:m:1"]);
    expect(state.heartbeat.at(-1)?.detail).toContain("kanal kapalı");
  });

  it("e-posta kanalı açıkken bir kez gönderilir (talep satırı mükerrer gönderimi engeller)", async () => {
    state.settings = { "dunning.stage1_channels": "in_app_email" };
    state.emailOn = true;
    state.invoices = [overdue("m", 1)];
    await GET(req());
    expect(state.emails).toHaveLength(1);
    expect(state.events.find((e) => e.channel === "email")?.result).toBe("sent");
    // Sayaç geri kalsa bile ikinci koşu e-postayı tekrar göndermez.
    await GET(req());
    expect(state.emails).toHaveLength(1);
  });

  it("günlük tablosu yokken (migration bekliyor) dış kanal atlanır, hata sayılmaz", async () => {
    state.settings = { "dunning.stage1_channels": "in_app_email" };
    state.emailOn = true;
    state.eventsMissing = true;
    state.invoices = [overdue("m", 1)];
    await GET(req());
    expect(state.emails).toEqual([]);
    expect(state.heartbeat.at(-1)?.status).toBe("ok");
    expect(state.heartbeat.at(-1)?.detail).toContain("migration bekliyor");
  });
});
