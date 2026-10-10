import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/platform-settings", () => ({ getPlatformSettingsMany: async () => ({}) }));

const db = vi.hoisted(() => ({
  walletReady: true,
  /** "yok" = ef_credit_lots_ready RPC'si yok (eski şema); false = var ama hazır değil. */
  lotsReady: true as boolean | "yok",
  lotsTable: "ok" as "ok" | "yok",
  lots: [] as { id: string; kind: string; units: number; remaining: number; expires_at: string }[],
  balance: { available: 80, reserved: 0, granted_total: 130, committed_total: 20, expired_total: 30 },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string) => {
      if (name === "ef_credit_ready") return { data: db.walletReady, error: null };
      if (name === "ef_credit_lots_ready") {
        return db.lotsReady === "yok" ? { data: null, error: { code: "PGRST202", message: "function not found" } } : { data: db.lotsReady, error: null };
      }
      if (name === "ef_credit_balance") return { data: db.balance, error: null };
      return { data: null, error: { message: "unknown rpc" } };
    },
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gt", "order"]) q[m] = () => q;
      q.limit = async () => (db.lotsTable === "yok" ? { data: null, error: { code: "42P01", message: "relation does not exist" } } : { data: db.lots, error: null });
      return q;
    },
  }),
}));

import { getEfCreditReady, getEfLotsReady, readEfBalance } from "./credit-reader";

beforeEach(() => {
  db.walletReady = true;
  db.lotsReady = true;
  db.lotsTable = "ok";
  db.lots = [{ id: "l1", kind: "purchase", units: 3000, remaining: 80, expires_at: "2027-01-10T00:00:00.000Z" }];
});

describe("süreli kontör: şema yokken eski akışa güvenli düşüş (rpc-probe)", () => {
  it("cüzdan hazır + parti sistemi hazır: ikisi de true", async () => {
    expect(await getEfCreditReady()).toBe(true);
    expect(await getEfLotsReady()).toBe(true);
  });

  it("parti RPC'si yok (20261010000300 uygulanmamış): cüzdan true kalır, paket satışı kapısı (lots) false", async () => {
    db.lotsReady = "yok";
    expect(await getEfCreditReady()).toBe(true);
    expect(await getEfLotsReady()).toBe(false);
  });

  it("cüzdan hazır değilse parti kapısı da false", async () => {
    db.walletReady = false;
    expect(await getEfCreditReady()).toBe(false);
    expect(await getEfLotsReady()).toBe(false);
  });

  it("bakiye + partiler okunur (expired_total dahil)", async () => {
    const b = await readEfBalance("t1");
    expect(b).toMatchObject({ available: 80, expired_total: 30 });
    expect(b?.lots).toEqual([{ id: "l1", kind: "purchase", units: 3000, remaining: 80, expiresAt: "2027-01-10T00:00:00.000Z" }]);
  });

  it("parti tablosu yoksa bakiye yine okunur, lots null (son kullanma gösterilmez)", async () => {
    db.lotsTable = "yok";
    const b = await readEfBalance("t1");
    expect(b).toMatchObject({ available: 80 });
    expect(b?.lots).toBeNull();
  });
});
