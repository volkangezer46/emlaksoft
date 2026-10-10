import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/platform-settings", () => ({ getPlatformSettingsMany: async () => ({}) }));

const err = { message: "relation does not exist", code: "42P01" };
const chain: Record<string, unknown> = {};
for (const m of ["select", "eq", "order", "limit", "in", "ilike", "range"]) chain[m] = () => chain;
chain.then = (res: (v: unknown) => unknown) => res({ data: null, error: err, count: null });
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: async () => ({ data: null, error: err }), from: () => chain }),
}));

import { getEfCatalog, getEfCreditReady, readEfBalance, readEfHistory } from "@/lib/ef-credits/credit-reader";
import { listTenantEfBalances } from "@/lib/ef-credits/admin-data";

describe("şema/RPC yokken zarif düşüş", () => {
  it("hazır değil, bakiye yok, geçmiş etkin değil", async () => {
    expect(await getEfCreditReady()).toBe(false);
    expect(await readEfBalance("t")).toBeNull();
    expect((await readEfHistory("t")).enabled).toBe(false);
    expect((await listTenantEfBalances({ page: 1 })).enabled).toBe(false);
  });
  it("ayar yokken varsayılan paket kataloğu ve varsayılan tarife", async () => {
    const c = await getEfCatalog();
    expect(c.packs).toHaveLength(12);
    expect(new Set(c.packs.map((p) => p.months))).toEqual(new Set([1, 3, 6, 12]));
    expect(c.tariff.valuationArsa).toBeGreaterThan(0);
  });
});
