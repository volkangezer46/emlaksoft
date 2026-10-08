import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLifecycleFacts } from "@/lib/insights/lifecycle-facts";

type Rec = { table: string; filters: [string, unknown][] };

/** Sahte Supabase istemcisi: her tablo için sabit sonuç döner, süzgeçleri kaydeder. */
function fakeAdmin(results: Record<string, { data: unknown; error?: unknown }>) {
  const recs: Rec[] = [];
  const admin = {
    from(table: string) {
      const rec: Rec = { table, filters: [] };
      recs.push(rec);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit", "range", "not", "is", "gte", "lte"]) b[m] = () => b;
      for (const m of ["eq", "in"]) {
        b[m] = (col: string, val: unknown) => {
          rec.filters.push([col, val]);
          return b;
        };
      }
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null, ...(results[table] ?? { data: [] }) }).then(res);
      return b;
    },
  };
  return { admin: admin as unknown as SupabaseClient, recs };
}

describe("loadLifecycleFacts", () => {
  it("boş veride boş olgu döner; her sorgu tenant_id süzgeçlidir", async () => {
    const { admin, recs } = fakeAdmin({});
    const facts = await loadLifecycleFacts(admin, "tenant-1", Date.UTC(2026, 9, 1));
    expect(facts).toEqual({ resale: [], leaseEnd: [], sellers: [] });
    expect(recs.length).toBeGreaterThanOrEqual(2);
    for (const r of recs) expect(r.filters).toContainEqual(["tenant_id", "tenant-1"]);
  });

  it("kazanılmış satışlar örnek olmayan kayıtlarla sorgulanır", async () => {
    const { admin, recs } = fakeAdmin({});
    await loadLifecycleFacts(admin, "t", 0);
    const deals = recs.find((r) => r.table === "deals")!;
    expect(deals.filters).toContainEqual(["is_sample", false]);
    expect(deals.filters).toContainEqual(["stage", "won"]);
  });

  it("nowMs ile gelen kira bitişi satırı olguya çevrilir (saat dışarıdan gelir)", async () => {
    const nowMs = Date.UTC(2026, 9, 1);
    const { admin } = fakeAdmin({
      rentals: {
        data: [
          {
            id: "r1",
            end_date: "2026-10-20",
            renter_customer_id: "c1",
            renter: { full_name: "Ayşe", assigned_to: "u1", is_sample: false },
            property: { title: "2+1", property_code: "P1", assigned_to: null, is_sample: false },
          },
        ],
      },
    });
    const facts = await loadLifecycleFacts(admin, "t", nowMs);
    expect(facts.leaseEnd).toEqual([
      { rentalId: "r1", renterName: "Ayşe", propertyLabel: "2+1", assignedTo: "u1", endDate: "2026-10-20", hasOpenBuyDemand: false },
    ]);
  });

  it("örnek kayıt ve atanmamış kiracı elenir", async () => {
    const { admin } = fakeAdmin({
      rentals: {
        data: [
          { id: "r1", end_date: "2026-10-20", renter_customer_id: "c1", renter: { full_name: "A", assigned_to: "u", is_sample: true }, property: null },
          { id: "r2", end_date: "2026-10-21", renter_customer_id: "c2", renter: { full_name: "B", assigned_to: null }, property: { title: "x", property_code: null, assigned_to: null } },
        ],
      },
    });
    expect((await loadLifecycleFacts(admin, "t", Date.UTC(2026, 9, 1))).leaseEnd).toEqual([]);
  });
});
