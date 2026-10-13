import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tenant: { id: "11111111-1111-4111-8111-111111111111", status: "trial", trial_ends_at: "2026-10-20T10:00:00.000Z" } as Record<string, unknown> | null,
  updates: [] as { table: string; values: Record<string, unknown> }[],
  audits: [] as unknown[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/clock", async (orig) => ({ ...(await orig<typeof import("@/lib/clock")>()), now: () => Date.parse("2026-10-13T09:00:00Z") }));
vi.mock("@/lib/platform", () => ({ requirePlatformStaff: vi.fn(async () => ({ id: "staff-1", role: "support" })) }));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: vi.fn(async (x: unknown) => void state.audits.push(x)) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let mode: "select" | "update" = "select";
      let head = false;
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = (_c?: unknown, o?: { head?: boolean }) => {
        head = Boolean(o?.head);
        return chain;
      };
      chain.update = (values: Record<string, unknown>) => {
        mode = "update";
        state.updates.push({ table, values });
        return chain;
      };
      for (const m of ["eq", "limit"]) chain[m] = self;
      chain.maybeSingle = () =>
        Promise.resolve({ data: table === "tenants" ? state.tenant : { id: "sub-1", trial_ends_at: "2026-10-20T10:00:00.000Z" }, error: null });
      chain.then = (resolve: (v: unknown) => unknown) => {
        if (head) return resolve({ count: 0, error: null });
        if (mode === "update" && table === "tenants") return resolve({ data: [{ id: "x" }], error: null });
        return resolve({ data: null, error: null });
      };
      return chain;
    },
  }),
}));

import { extendTrial } from "./platform-trial";

const ID = "11111111-1111-4111-8111-111111111111";
const REASON = "Müşteri kurulum için ek süre istedi";

describe("extendTrial (sınırlar)", () => {
  beforeEach(() => {
    state.tenant = { id: ID, status: "trial", trial_ends_at: "2026-10-20T10:00:00.000Z" };
    state.updates = [];
    state.audits = [];
  });

  it("+7: ofis ve deneme aboneliği birlikte güncellenir, denetim izine eski/yeni/gerekçe yazılır", async () => {
    const r = await extendTrial(ID, { days: 7 }, REASON);
    expect(r.ok).toBe(true);
    expect(r.endIso).toBe("2026-10-27T10:00:00.000Z");
    expect(state.updates.map((u) => u.table)).toEqual(["tenants", "subscriptions"]);
    expect(state.updates[1]!.values).toMatchObject({ trial_ends_at: r.endIso, current_period_end: r.endIso });
    expect(state.audits[0]).toMatchObject({ action: "tenant.trial_change", meta: { old: "2026-10-20T10:00:00.000Z", new: r.endIso, reason: REASON } });
  });

  it("90 günü aşan değer reddedilir, yazma yapılmaz", async () => {
    const r = await extendTrial(ID, { date: "2027-02-01" }, REASON);
    expect(r.error).toMatch(/90 gün/);
    expect(state.updates).toHaveLength(0);
  });

  it("geçmiş tarih reddedilir", async () => {
    const r = await extendTrial(ID, { date: "2026-10-01" }, REASON);
    expect(r.error).toMatch(/en erken yarın/);
    expect(state.updates).toHaveLength(0);
  });

  it("denemede olmayan ofise uygulanmaz", async () => {
    state.tenant = { id: ID, status: "active", trial_ends_at: null };
    const r = await extendTrial(ID, { days: 7 }, REASON);
    expect(r.error).toMatch(/Yalnız deneme/);
    expect(state.updates).toHaveLength(0);
  });

  it("gerekçe en az 10 karakter", async () => {
    expect((await extendTrial(ID, { days: 7 }, "kısa")).error).toMatch(/Gerekçe/);
  });
});
