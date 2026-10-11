import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMatchContext } from "./load";
import { suggestAll } from "./match";

/**
 * Aday listesi birim testi: tahsil edilmiş ve kasaya bağlı komisyon/kira/aidat aday DEĞİL; bekleyen komisyon (ve kasaya bağlanmamış
 * tahsil edilmiş komisyon) aday. Sahte istemci tablo adına göre sabit satır döner.
 */
type Row = Record<string, unknown>;
function fakeClient(tables: Record<string, Row[]>) {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "gte", "lte", "order", "limit", "in", "not"]) q[m] = () => q;
    q.then = (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: tables[table] ?? [], error: null });
    return q;
  };
  return { from: (t: string) => chain(t) } as unknown as SupabaseClient;
}

const LINES = [{ id: "l1", date: "2026-10-08", dir: "in" as const, amount: 5000, description: "" }];

describe("loadMatchContext: tahsilat adayları", () => {
  it("tahsil edilmiş ve kasaya bağlı komisyon aday listesinde yok; bekleyen komisyon var", async () => {
    const supabase = fakeClient({
      commissions: [
        { id: "c-paid-linked", gross_amount: 5000, vat_amount: 0, status: "paid" },
        { id: "c-collected-linked", gross_amount: 5000, vat_amount: 0, status: "collected" },
        { id: "c-pending", gross_amount: 5000, vat_amount: 0, status: "pending" },
        { id: "c-paid-unlinked", gross_amount: 5000, vat_amount: 0, status: "paid" },
      ],
      cash_entries: [
        { source_type: "commission", source_id: "c-paid-linked" },
        { source_type: "commission", source_id: "c-collected-linked" },
      ],
    });
    const ctx = await loadMatchContext(supabase, "acc", LINES, true);
    expect(ctx.collections.map((c) => c.id).sort()).toEqual(["c-paid-unlinked", "c-pending"]);
    expect(ctx.collections.find((c) => c.id === "c-paid-unlinked")!.label).toContain("kasaya bağlı değil");
    expect(ctx.collections.find((c) => c.id === "c-pending")!.label).toBe("Komisyon tutarıyla eşleşiyor");
  });

  it("kira ve aidat tahsilatı başka bir hesaba bağlıysa aday değildir", async () => {
    const supabase = fakeClient({
      rent_payments: [
        { id: "r1", paid_on: "2026-10-08", amount: 5000, receipt_no: "K1" },
        { id: "r2", paid_on: "2026-10-08", amount: 5000, receipt_no: "K2" },
      ],
      building_payments: [{ id: "b1", paid_on: "2026-10-08", amount: 5000, receipt_no: "A1" }],
      cash_entries: [
        { source_type: "rent", source_id: "r1" },
        { source_type: "building", source_id: "b1" },
      ],
    });
    const ctx = await loadMatchContext(supabase, "acc", LINES, true);
    expect(ctx.collections.map((c) => c.id)).toEqual(["r2"]);
    expect(suggestAll(LINES, { ...ctx, canSalary: true }).get("l1")).toMatchObject({ kind: "collection", sourceId: "r2" });
  });

  it("kişisel hesapta (withCollections=false) tahsilat adayı aranmaz", async () => {
    const supabase = fakeClient({ commissions: [{ id: "c1", gross_amount: 5000, vat_amount: 0, status: "pending" }] });
    expect((await loadMatchContext(supabase, "acc", LINES, false)).collections).toEqual([]);
  });
});
