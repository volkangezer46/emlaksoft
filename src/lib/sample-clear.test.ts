import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SAMPLE_CLEAR_ORDER,
  countSampleRecords,
  deleteSampleRecords,
  describeSampleCounts,
  isMissingSampleSchema,
} from "./sample-clear";

type Behavior = { count?: number; error?: { code?: string; message?: string } };

/** delete().eq().eq() ve select().eq().eq() zincirlerini taklit eden minimal sahte client. */
function fakeDb(behavior: Record<string, Behavior>, log: string[] = []) {
  const chain = (table: string, kind: "delete" | "count") => {
    const calls: Record<string, unknown> = {};
    const result = () => {
      const b = behavior[table] ?? { count: 0 };
      log.push(`${kind}:${table}:${JSON.stringify(calls)}`);
      return Promise.resolve({ count: b.count ?? 0, error: b.error ?? null });
    };
    const api = {
      eq(col: string, val: unknown) {
        calls[col] = val;
        return Object.keys(calls).length >= 2 ? Object.assign(result(), api) : api;
      },
    };
    return api;
  };
  return {
    from: (table: string) => ({
      delete: () => chain(table, "delete"),
      select: () => chain(table, "count"),
    }),
  } as unknown as SupabaseClient;
}

describe("sample-clear sırası", () => {
  const order = SAMPLE_CLEAR_ORDER.map((s) => s.table);
  const before = (a: string, b: string) => expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));

  it("çocuk tablolar ana tablolardan önce silinir", () => {
    before("commissions", "deals");
    before("deals", "properties");
    before("deals", "customers");
    before("offers", "properties");
    before("rentals", "properties");
    before("rentals", "customers");
    before("tasks", "customers");
    before("appointments", "properties");
    before("properties", "customers");
  });

  it("profiles silinmez (demo hesap yok, gerçek kullanıcıya dokunulmaz)", () => {
    expect(order).not.toContain("profiles");
  });
});

describe("deleteSampleRecords", () => {
  it("yalnız tenant_id + is_sample=true ile siler ve toplar", async () => {
    const log: string[] = [];
    const db = fakeDb({ customers: { count: 12 }, properties: { count: 9 }, deals: { count: 5 } }, log);
    const report = await deleteSampleRecords(db, "t1");
    expect(report.complete).toBe(true);
    expect(report.totalDeleted).toBe(26);
    expect(report.deleted.customers).toBe(12);
    for (const line of log) expect(line).toContain('"tenant_id":"t1","is_sample":true');
  });

  it("is_sample sütunu olmayan tabloyu 'etkin değil' sayar, hata vermez", async () => {
    const db = fakeDb({ offers: { error: { code: "42703", message: 'column "is_sample" does not exist' } }, customers: { count: 2 } });
    const report = await deleteSampleRecords(db, "t1");
    expect(report.unavailable).toContain("offers");
    expect(report.failed).toHaveLength(0);
    expect(report.complete).toBe(true);
  });

  it("bir tablo takılırsa diğerleri denenir ve kısmi hata raporlanır (idempotent yeniden deneme)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = fakeDb({ customers: { error: { code: "23503", message: "fk" } }, properties: { count: 4 } });
    const report = await deleteSampleRecords(db, "t1");
    spy.mockRestore();
    expect(report.complete).toBe(false);
    expect(report.failed.map((f) => f.table)).toEqual(["customers"]);
    expect(report.deleted.properties).toBe(4);
    // Tekrar çalıştırıldığında silinecek kalmaz → sıfır, hata yok
    const again = await deleteSampleRecords(fakeDb({}), "t1");
    expect(again.complete).toBe(true);
    expect(again.totalDeleted).toBe(0);
  });
});

describe("countSampleRecords / özet", () => {
  it("sayıları toplar; sütunsuz tablo null", async () => {
    const db = fakeDb({ customers: { count: 12 }, offers: { error: { code: "42703" } } });
    const summary = await countSampleRecords(db, "t1");
    expect(summary.total).toBe(12);
    expect(summary.rows.find((r) => r.table === "offers")?.count).toBeNull();
    expect(describeSampleCounts(summary)).toContain("12 müşteri");
  });

  it("boş özet metni", () => {
    expect(describeSampleCounts({ rows: [], total: 0 })).toBe("silinecek örnek kayıt yok");
  });

  it("eksik şema hatalarını tanır", () => {
    expect(isMissingSampleSchema({ code: "42703" })).toBe(true);
    expect(isMissingSampleSchema({ message: "column rentals.is_sample does not exist" })).toBe(true);
    expect(isMissingSampleSchema({ code: "23503", message: "fk violation" })).toBe(false);
    expect(isMissingSampleSchema(null)).toBe(false);
  });
});
