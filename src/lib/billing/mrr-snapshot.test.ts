import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runMrrSnapshot } from "./mrr-snapshot";

/**
 * Bellek içi sahte istemci: platform_mrr_daily'yi (day, tenant_id) anahtarlı Map'te tutar, upsert ON CONFLICT
 * davranışını taklit eder. tenants/subscriptions okumaları sabit satır döner.
 */
function fakeAdmin(opts: { tableMissing?: boolean } = {}) {
  const store = new Map<string, Record<string, unknown>>();
  const upserts: { rows: Record<string, unknown>[]; onConflict?: string }[] = [];
  const tenants = [
    { id: "t1", plan: "professional", status: "active" },
    { id: "t2", plan: "office", status: "active" },
    { id: "t3", plan: "advisor", status: "trial" },
  ];
  const subs = [
    { id: "s1", tenant_id: "t1", plan: "professional", status: "active", amount_try: "5990", updated_at: "2026-10-01" },
    { id: "s3", tenant_id: "t3", plan: "advisor", status: "trialing", amount_try: "749", updated_at: "2026-10-01" },
  ];
  const result = (data: unknown, error: unknown = null) => Promise.resolve({ data, error });
  const builder = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of ["eq", "order", "limit", "in", "gte"]) chain[m] = self;
    chain.select = self;
    chain.range = (from: number) => {
      if (table === "tenants") return result(from === 0 ? tenants : []);
      if (table === "subscriptions") return result(from === 0 ? subs : []);
      return result([]);
    };
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve(
        table === "platform_mrr_daily" && opts.tableMissing
          ? { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.platform_mrr_daily' in the schema cache" } }
          : { data: [], error: null },
      );
    chain.upsert = (rows: Record<string, unknown>[], o?: { onConflict?: string }) => {
      upserts.push({ rows, onConflict: o?.onConflict });
      for (const r of rows) store.set(`${r.day}|${r.tenant_id}`, r);
      return result(null);
    };
    return chain;
  };
  const admin = { from: (t: string) => builder(t) } as unknown as SupabaseClient;
  return { admin, store, upserts };
}

const PRICES = new Map([
  ["advisor", 749],
  ["office", 2490],
  ["professional", 5990],
]);

describe("runMrrSnapshot", () => {
  it("her ofis için tek satır upsert eder (on conflict day,tenant_id) ve tekrar koşmak satır çoğaltmaz", async () => {
    const { admin, store, upserts } = fakeAdmin();
    const first = await runMrrSnapshot(admin, "2026-10-13", { prices: PRICES });
    expect(first).toEqual({ written: 3, total: 5990 + 2490, skipped: false, error: null });
    const second = await runMrrSnapshot(admin, "2026-10-13", { prices: PRICES });
    expect(second.written).toBe(3);
    expect(store.size).toBe(3);
    expect(upserts.every((u) => u.onConflict === "day,tenant_id")).toBe(true);
    expect(store.get("2026-10-13|t1")).toMatchObject({ mrr_try: 5990, subscription_id: "s1", status: "active" });
    // Aboneliği eksik aktif ofis: katalog fiyatı (exactMrr kuralı)
    expect(store.get("2026-10-13|t2")).toMatchObject({ mrr_try: 2490, subscription_id: null });
    // Deneme gelir sayılmaz
    expect(store.get("2026-10-13|t3")).toMatchObject({ mrr_try: 0, status: "trial" });
  });

  it("tablo yoksa (migration uygulanmadı) hata fırlatmadan atlanır", async () => {
    const { admin, upserts } = fakeAdmin({ tableMissing: true });
    expect(await runMrrSnapshot(admin, "2026-10-13", { prices: PRICES })).toEqual({ written: 0, total: 0, skipped: true, error: null });
    expect(upserts).toHaveLength(0);
  });

  it("geçersiz gün anahtarı yazmaz", async () => {
    const { admin, upserts } = fakeAdmin();
    expect((await runMrrSnapshot(admin, "13.10.2026", { prices: PRICES })).skipped).toBe(true);
    expect(upserts).toHaveLength(0);
  });
});
