import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deneme bitişi adımı (BUG-2): güncelleme okuma koşulunu tekrarlar (status=trialing + süre geçmiş),
 * ofis yalnız 'trial'/'active' iken past_due olur, bildirim yalnız durumu değişen ofise gider ve
 * yazma hataları heartbeat'e 'failed' notuyla düşer. Bellek içi sahte PostgREST filtreleri gerçekten uygular.
 */
type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  db: {} as Record<string, Row[]>,
  failTable: null as string | null,
  /** İlk abonelik okumasından SONRA çalışır — okuma/yazma arası yarışı taklit eder. */
  afterTrialRead: null as null | (() => void),
  heartbeat: vi.fn(async (..._args: unknown[]) => true),
}));

function query(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: "select" | "update" | "insert" = "select";
  let patch: Row = {};
  let inserted: Row[] = [];
  let limit = Infinity;
  const rows = () => (h.db[table] ??= []);
  const run = () => {
    if (h.failTable === table && op !== "select") return { data: null, error: { message: `${table} yazılamadı` } };
    if (op === "insert") {
      rows().push(...inserted);
      return { data: inserted, error: null };
    }
    const hit = rows().filter((r) => filters.every((f) => f(r))).slice(0, limit);
    if (op === "update") hit.forEach((r) => Object.assign(r, patch));
    if (op === "select" && table === "subscriptions" && h.afterTrialRead) {
      const hook = h.afterTrialRead;
      h.afterTrialRead = null;
      const snapshot = hit.map((r) => ({ ...r }));
      hook();
      return { data: snapshot, error: null };
    }
    return { data: hit.map((r) => ({ ...r })), error: null };
  };
  const chain = {
    select: () => chain,
    update: (p: Row) => ((op = "update"), (patch = p), chain),
    insert: (r: Row | Row[]) => ((op = "insert"), (inserted = Array.isArray(r) ? r : [r]), chain),
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), chain),
    neq: (k: string, v: unknown) => (filters.push((r) => r[k] !== v), chain),
    in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), chain),
    lt: (k: string, v: string) => (filters.push((r) => r[k] != null && String(r[k]) < v), chain),
    gte: (k: string, v: string) => (filters.push((r) => r[k] != null && String(r[k]) >= v), chain),
    lte: (k: string, v: string) => (filters.push((r) => r[k] != null && String(r[k]) <= v), chain),
    not: (k: string) => (filters.push((r) => r[k] != null), chain),
    order: () => chain,
    limit: (n: number) => ((limit = n), chain),
    then: <T,>(resolve: (v: ReturnType<typeof run>) => T, reject?: (e: unknown) => T) => Promise.resolve().then(run).then(resolve, reject),
  };
  return chain;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: query }) }));
vi.mock("@/lib/cron-auth", () => ({ authorizeCron: () => null }));
vi.mock("@/lib/cron-heartbeat", () => ({ recordHeartbeat: h.heartbeat }));
vi.mock("@/lib/platform-settings", () => ({ getPlatformSetting: async () => null }));
vi.mock("@/lib/license-reminders", () => ({ runLicenseReminders: async () => ({ expiry: 0, annualFee: 0, skipped: true }) }));
vi.mock("@/lib/offer-expiry-reminders", () => ({ runOfferExpiryReminders: async () => ({ notified: 0, skipped: true }) }));
vi.mock("@/lib/property-authority-reminders", () => ({
  runPropertyAuthorityReminders: async () => ({ candidates: 0, written: 0, skipped: true }),
}));
vi.mock("@/lib/email/trial-reminder", () => ({ sendTrialEndingEmails: async () => 0 }));
vi.mock("@/lib/notify-batch", () => ({ findNotifiedIds: async () => new Set(), insertNotifications: async () => 0 }));
vi.mock("@/lib/billing/subscription-lifecycle", () => ({
  pausedSubscriptionIds: async () => new Set(),
  runSubscriptionLifecycle: async () => ({ resumed: 0, downgraded: 0, downgradeFailed: 0, notified: 0, skipped: true }),
}));

import { GET } from "./route";

// Bir saat önce bitti: tolerans (askıya alma) penceresinin içinde kalsın.
const PAST = new Date(Date.now() - 3_600_000).toISOString();

function seed() {
  h.db = {
    subscriptions: [
      { id: "s-trial", tenant_id: "t-trial", status: "trialing", trial_ends_at: PAST },
      { id: "s-susp", tenant_id: "t-susp", status: "trialing", trial_ends_at: PAST },
      { id: "s-paid", tenant_id: "t-paid", status: "trialing", trial_ends_at: PAST },
    ],
    tenants: [
      { id: "t-trial", status: "trial" },
      { id: "t-susp", status: "suspended" },
      { id: "t-paid", status: "active" },
    ],
    notifications: [],
  };
}

const sub = (id: string) => h.db.subscriptions!.find((r) => r.id === id)!;
const tenant = (id: string) => h.db.tenants!.find((r) => r.id === id)!;
const call = () => GET(new NextRequest("http://localhost/api/cron/abonelik-kontrol"));

beforeEach(() => {
  vi.clearAllMocks();
  h.failTable = null;
  h.afterTrialRead = null;
  seed();
});

describe("abonelik-kontrol deneme bitişi", () => {
  it("askıdaki deneme ofisi past_due olmaz ve ona bildirim gitmez", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(tenant("t-trial").status).toBe("past_due");
    expect(tenant("t-susp").status).toBe("suspended");
    const notified = h.db.notifications!.map((n) => n.tenant_id);
    expect(notified).toContain("t-trial");
    expect(notified).not.toContain("t-susp");
  });

  it("okuma ile yazma arasında ödeme yapıp active olan abonelik ve ofisi ezilmez", async () => {
    h.afterTrialRead = () => {
      sub("s-paid").status = "active";
      sub("s-paid").trial_ends_at = null;
    };
    const body = (await (await call()).json()) as { updated: number };
    expect(sub("s-paid").status).toBe("active");
    expect(tenant("t-paid").status).toBe("active");
    expect(h.db.notifications!.map((n) => n.tenant_id)).not.toContain("t-paid");
    expect(body.updated).toBe(2);
    expect(h.heartbeat).toHaveBeenCalledWith("abonelik-kontrol", "ok", expect.any(String));
  });

  it("yazma hatası heartbeat'e 'failed' notuyla error olarak düşer", async () => {
    h.failTable = "tenants";
    const body = (await (await call()).json()) as { ok: boolean };
    expect(body.ok).toBe(false);
    const [, status, detail] = h.heartbeat.mock.calls.at(-1)!;
    expect(status).toBe("error");
    expect(String(detail)).toMatch(/^failed — deneme bitişi ofis: tenants yazılamadı/);
    expect(h.db.notifications).toHaveLength(0);
  });
});
