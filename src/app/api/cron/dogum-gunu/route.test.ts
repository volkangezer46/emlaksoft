import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Doğum günü / yıldönümü cron'u (BUG-3): Türkiye günü, sayfalı okuma (1000 satır sınırında kesilmez),
 * artık yıl olmayan yılda 28 Şubat'ta 29 Şubat doğumlular, modül kapısı ve heartbeat notları.
 */
type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  customers: [] as Row[],
  inserted: [] as Row[],
  ranges: [] as Array<[number, number]>,
  readError: null as null | { message: string },
  disabled: new Map<string, Set<string>>(),
  heartbeat: vi.fn(async (..._args: unknown[]) => true),
}));

function customersQuery() {
  const filters: Array<(r: Row) => boolean> = [];
  let range: [number, number] = [0, Infinity];
  let ordered = false;
  const chain = {
    select: () => chain,
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), chain),
    is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), chain),
    not: (k: string) => (filters.push((r) => r[k] != null), chain),
    order: (k: string) => ((ordered = k === "id"), chain),
    range: (from: number, to: number) => ((range = [from, to]), h.ranges.push(range), chain),
    then: <T,>(resolve: (v: { data: Row[] | null; error: { message: string } | null }) => T) => {
      if (!ordered) throw new Error("sayfalı okuma deterministik sıralı olmalı");
      if (h.readError && range[0] > 0) return Promise.resolve(resolve({ data: null, error: h.readError }));
      // PostgREST max_rows: tek yanıt en çok 1000 satır.
      const rows = h.customers.filter((r) => filters.every((f) => f(r))).slice(range[0], Math.min(range[1] + 1, range[0] + 1000));
      return Promise.resolve(resolve({ data: rows, error: null }));
    },
  };
  return chain;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cron-auth", () => ({ authorizeCron: () => null }));
vi.mock("@/lib/cron-heartbeat", () => ({ recordHeartbeat: h.heartbeat }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      table === "customers"
        ? customersQuery()
        : {
            insert: async (rows: Row[]) => {
              h.inserted.push(...rows);
              return { error: null };
            },
          },
  }),
}));
vi.mock("@/lib/modules/state", () => ({
  getDisabledModulesByTenant: async () => h.disabled,
  isDisabledFor: (map: Map<string, Set<string>>, tenantId: string, key: string) => map.get(tenantId)?.has(key) ?? false,
  skippedTenantsNote: (map: Map<string, Set<string>>, key: string) => {
    const n = [...map.values()].filter((s) => s.has(key)).length;
    return n > 0 ? ` · ${n} ofis atlandı (modül kapalı)` : "";
  },
}));

import { GET } from "./route";

const customer = (id: string, tenant: string, birth: string | null, extra: Row = {}): Row => ({
  id,
  full_name: `Müşteri ${id}`,
  tenant_id: tenant,
  birth_date: birth,
  anniversary_date: null,
  anniversary_note: null,
  is_sample: false,
  deleted_at: null,
  ...extra,
});

const call = () => GET(new NextRequest("http://localhost/api/cron/dogum-gunu"));
const bodyOf = async () => (await (await call()).json()) as { birthdays: number; anniversaries: number; tenants_notified: number; date: string };

beforeEach(() => {
  vi.clearAllMocks();
  h.customers = [];
  h.inserted = [];
  h.ranges = [];
  h.readError = null;
  h.disabled = new Map();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("dogum-gunu cron", () => {
  it("Türkiye gününü kullanır: UTC 22:30 (TR 01:30) ertesi günün doğumlularını bulur", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-09T22:30:00Z"));
    h.customers = [customer("a", "t1", "1990-05-10"), customer("b", "t1", "1990-05-09")];
    const body = await bodyOf();
    expect(body.date).toBe("10/5");
    expect(body.birthdays).toBe(1);
    expect(h.inserted).toHaveLength(1);
    expect(String(h.inserted[0]!.body)).toContain("Müşteri a");
  });

  it("1000 satırı aşan listeyi sayfalayarak sonuna kadar okur", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-10T09:00:00Z"));
    h.customers = Array.from({ length: 2500 }, (_, i) => customer(String(i).padStart(5, "0"), `t${i % 3}`, "1980-01-01"));
    h.customers.push(customer("99999", "t-late", "1985-05-10"));
    const body = await bodyOf();
    expect(body.birthdays).toBe(1);
    expect(h.inserted.map((r) => r.tenant_id)).toEqual(["t-late"]);
    expect(h.ranges.length).toBeGreaterThan(2);
    expect(h.heartbeat).toHaveBeenCalledWith("dogum-gunu", "ok", expect.any(String));
  });

  it("artık yıl olmayan yılda 28 Şubat'ta 29 Şubat doğumluları da dahil eder; artık yılda etmez", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    h.customers = [customer("feb29", "t1", "2000-02-29"), customer("feb28", "t1", "1990-02-28")];
    vi.setSystemTime(new Date("2027-02-28T09:00:00Z"));
    expect((await bodyOf()).birthdays).toBe(2);
    vi.setSystemTime(new Date("2028-02-28T09:00:00Z"));
    expect((await bodyOf()).birthdays).toBe(1);
    vi.setSystemTime(new Date("2028-02-29T09:00:00Z"));
    expect((await bodyOf()).birthdays).toBe(1);
  });

  it("yıldönümlerini de eşler ve modülü kapalı ofisi atlar", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T09:00:00Z"));
    h.customers = [
      customer("a", "t-open", null, { anniversary_date: "2015-06-15", anniversary_note: "ev alımı" }),
      customer("b", "t-closed", "1970-06-15"),
    ];
    h.disabled = new Map([["t-closed", new Set(["automation"])]]);
    await call();
    expect(h.inserted.map((r) => r.tenant_id)).toEqual(["t-open"]);
    expect(String(h.inserted[0]!.body)).toContain("ev alımı");
    expect(h.heartbeat.mock.calls.at(-1)![2]).toContain("1 ofis atlandı");
  });

  it("okuma hatasında heartbeat'e not düşer (error)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-10T09:00:00Z"));
    h.customers = Array.from({ length: 1500 }, (_, i) => customer(String(i).padStart(5, "0"), "t1", "1980-01-01"));
    h.readError = { message: "zaman aşımı" };
    await call();
    const [, status, detail] = h.heartbeat.mock.calls.at(-1)!;
    expect(status).toBe("error");
    expect(String(detail)).toContain("okuması kısmi: zaman aşımı");
  });
});
