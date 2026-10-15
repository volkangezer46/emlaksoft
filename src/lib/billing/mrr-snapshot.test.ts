import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMrrSnapshotDays, runMrrSnapshot } from "./mrr-snapshot";

/**
 * Bellek içi sahte istemci: platform_mrr_daily'yi (day, tenant_id) anahtarlı Map'te tutar, upsert ON CONFLICT
 * davranışını taklit eder. tenants/subscriptions okumaları sabit satır döner.
 */
function fakeAdmin(opts: { tableMissing?: boolean; internalColumnMissing?: boolean; snapshotRows?: Record<string, unknown>[] } = {}) {
  const store = new Map<string, Record<string, unknown>>();
  const upserts: { rows: Record<string, unknown>[]; onConflict?: string }[] = [];
  const tenants = [
    { id: "t1", plan: "professional", status: "active", is_internal: false },
    { id: "t2", plan: "office", status: "active", is_internal: false },
    { id: "t3", plan: "advisor", status: "trial", is_internal: false },
    // İç/test ofisleri: aktif abonelikli demo ve aboneliksiz e2e
    { id: "demo", plan: "professional", status: "active", is_internal: true },
    { id: "e2e", plan: "professional", status: "active", is_internal: true },
  ];
  const selects: string[] = [];
  const subs = [
    { id: "s1", tenant_id: "t1", plan: "professional", status: "active", amount_try: "5990", updated_at: "2026-10-01" },
    { id: "s3", tenant_id: "t3", plan: "advisor", status: "trialing", amount_try: "749", updated_at: "2026-10-01" },
    { id: "sd", tenant_id: "demo", plan: "professional", status: "active", amount_try: "5990", updated_at: "2026-10-01" },
  ];
  const result = (data: unknown, error: unknown = null) => Promise.resolve({ data, error });
  const missingColumn = { code: "42703", message: "column tenants.is_internal does not exist" };
  const builder = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    let cols = "";
    let eqInternal = false;
    for (const m of ["order", "limit", "in", "gte"]) chain[m] = self;
    chain.eq = (col: string) => {
      if (col === "is_internal") eqInternal = true;
      return chain;
    };
    chain.select = (c: string) => {
      cols = c;
      selects.push(`${table}:${c}`);
      return chain;
    };
    chain.range = (from: number) => {
      if (table === "tenants") {
        if (opts.internalColumnMissing && cols.includes("is_internal")) return result(null, missingColumn);
        const rows = cols.includes("is_internal") ? tenants : tenants.map(({ is_internal: _drop, ...t }) => t);
        return result(from === 0 ? rows : []);
      }
      if (table === "subscriptions") return result(from === 0 ? subs : []);
      if (table === "platform_mrr_daily") return result(from === 0 ? (opts.snapshotRows ?? []) : []);
      return result([]);
    };
    chain.then = (resolve: (v: unknown) => unknown) => {
      if (table === "tenants" && eqInternal) {
        return resolve(opts.internalColumnMissing ? { data: null, error: missingColumn } : { data: tenants.filter((t) => t.is_internal).map((t) => ({ id: t.id })), error: null });
      }
      return resolve(
        table === "platform_mrr_daily" && opts.tableMissing
          ? { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.platform_mrr_daily' in the schema cache" } }
          : { data: [], error: null },
      );
    };
    chain.upsert = (rows: Record<string, unknown>[], o?: { onConflict?: string }) => {
      upserts.push({ rows, onConflict: o?.onConflict });
      for (const r of rows) store.set(`${r.day}|${r.tenant_id}`, r);
      return result(null);
    };
    return chain;
  };
  const admin = { from: (t: string) => builder(t) } as unknown as SupabaseClient;
  return { admin, store, upserts, selects };
}

describe("runMrrSnapshot", () => {
  it("her ofis için tek satır upsert eder (on conflict day,tenant_id) ve tekrar koşmak satır çoğaltmaz", async () => {
    const { admin, store, upserts } = fakeAdmin();
    const first = await runMrrSnapshot(admin, "2026-10-13");
    expect(first).toEqual({ written: 5, total: 5990, skipped: false, error: null });
    const second = await runMrrSnapshot(admin, "2026-10-13");
    expect(second.written).toBe(5);
    expect(store.size).toBe(5);
    expect(upserts.every((u) => u.onConflict === "day,tenant_id")).toBe(true);
    expect(store.get("2026-10-13|t1")).toMatchObject({ mrr_try: 5990, subscription_id: "s1", status: "active" });
    // Aboneliği eksik aktif ofis MRR'a 0 ekler (katalog fiyatı yedeği yok; exactMrr kuralı)
    expect(store.get("2026-10-13|t2")).toMatchObject({ mrr_try: 0, subscription_id: null });
    // İç/test/demo ofis: aktif aboneliği olsa da 0
    expect(store.get("2026-10-13|demo")).toMatchObject({ mrr_try: 0, subscription_id: "sd" });
    expect(store.get("2026-10-13|e2e")).toMatchObject({ mrr_try: 0 });
    // Deneme gelir sayılmaz
    expect(store.get("2026-10-13|t3")).toMatchObject({ mrr_try: 0, status: "trial" });
  });

  it("tablo yoksa (migration uygulanmadı) hata fırlatmadan atlanır", async () => {
    const { admin, upserts } = fakeAdmin({ tableMissing: true });
    expect(await runMrrSnapshot(admin, "2026-10-13")).toEqual({ written: 0, total: 0, skipped: true, error: null });
    expect(upserts).toHaveLength(0);
  });

  it("geçersiz gün anahtarı yazmaz", async () => {
    const { admin, upserts } = fakeAdmin();
    expect((await runMrrSnapshot(admin, "13.10.2026")).skipped).toBe(true);
    expect(upserts).toHaveLength(0);
  });

  it("is_internal sütunu yokken (migration öncesi) sütunsuz yeniden okur; iç ofis yok sayılır, katalog yedeği yine yok", async () => {
    const { admin, store, selects } = fakeAdmin({ internalColumnMissing: true });
    const res = await runMrrSnapshot(admin, "2026-10-13");
    expect(res.error).toBeNull();
    expect(selects).toContain("tenants:id, plan, status");
    expect(store.get("2026-10-13|demo")).toMatchObject({ mrr_try: 5990 });
    expect(store.get("2026-10-13|e2e")).toMatchObject({ mrr_try: 0 });
  });
});

describe("loadMrrSnapshotDays", () => {
  const rows = [
    { day: "2026-10-14", tenant_id: "t1", mrr_try: "5990" },
    { day: "2026-10-14", tenant_id: "demo", mrr_try: "5990" },
    { day: "2026-10-14", tenant_id: "e2e", mrr_try: "5490" },
  ];
  it("bayraktan önce yazılmış günlerde de iç ofis satırları toplama girmez", async () => {
    const { admin } = fakeAdmin({ snapshotRows: rows });
    expect(await loadMrrSnapshotDays(admin, ["2026-10-14"])).toEqual([{ day: "2026-10-14", total: 5990 }]);
  });
  it("sütun yokken tüm satırlar toplanır (eski davranış)", async () => {
    const { admin } = fakeAdmin({ snapshotRows: rows, internalColumnMissing: true });
    expect(await loadMrrSnapshotDays(admin, ["2026-10-14"])).toEqual([{ day: "2026-10-14", total: 5990 + 5990 + 5490 }]);
  });
});
