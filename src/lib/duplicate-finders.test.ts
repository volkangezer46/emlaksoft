import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findCustomerDuplicates, findSimilarOpenDemands } from "@/lib/duplicate-finders";

/** Zincirleme sorgu kurucusunu taklit eder: her çağrı kendini döndürür, await tablo verisini verir. */
function fakeSupabase(tables: Record<string, unknown[]>): SupabaseClient {
  const builder = (rows: unknown[]) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: rows[0] ?? null });
    b.then = (res: (v: unknown) => unknown) => res({ data: rows });
    return b;
  };
  return {
    from: (t: string) => builder(tables[t] ?? []),
    rpc: async () => ({ data: [{ customer_id: "c1", last_contact: "2026-01-01T00:00:00Z" }] }),
  } as unknown as SupabaseClient;
}

const ME = "user-me";
const OTHER = "user-other";
const row = (assigned_to: string | null, created_by: string | null) => ({
  id: "c1", full_name: "Ayşe Yılmaz", phone: "05321234567", email: null, assigned_to, created_by,
});
const profiles = [{ id: OTHER, full_name: "Başka Danışman" }, { id: ME, full_name: "Ben" }];
const args = { tenantId: "t1", phone: "05321234567", email: "" };

describe("mükerrer uyarısı gizliliği", () => {
  it("kendine atanmamış (ama kendi oluşturduğu) müşteride ad/danışman/son temas dönmez", async () => {
    const sb = fakeSupabase({ customers: [row(OTHER, ME)], profiles });
    const [hit] = await findCustomerDuplicates(sb, args, { userId: ME, officeWide: false });
    expect(hit.visible).toBe(false);
    expect(hit.id).toBeNull();
    expect(hit.label).toBeNull();
    expect(hit.advisor).toBeNull();
    expect(hit.lastContact).toBeNull();
  });

  it("atanmamış müşteride de ayrıntı dönmez", async () => {
    const sb = fakeSupabase({ customers: [row(null, ME)], profiles });
    const [hit] = await findCustomerDuplicates(sb, args, { userId: ME, officeWide: false });
    expect(hit.visible).toBe(false);
    expect(hit.label).toBeNull();
  });

  it("kendine atanmış müşteride ayrıntı serbest", async () => {
    const sb = fakeSupabase({ customers: [row(ME, OTHER)], profiles });
    const [hit] = await findCustomerDuplicates(sb, args, { userId: ME, officeWide: false });
    expect(hit.visible).toBe(true);
    expect(hit.label).toBe("Ayşe Yılmaz");
  });

  it("ofis geneli rol her kaydı görür", async () => {
    const sb = fakeSupabase({ customers: [row(OTHER, OTHER)], profiles });
    const [hit] = await findCustomerDuplicates(sb, args, { userId: ME, officeWide: true });
    expect(hit.visible).toBe(true);
    expect(hit.advisor).toBe("Başka Danışman");
  });

  it("başkasına atanmış müşterinin açık talebi maskelenir", async () => {
    const sb = fakeSupabase({
      customers: [{ assigned_to: OTHER, created_by: ME }],
      customer_demands: [{ id: "d1", transaction_type: "sale", property_type: "apartment", district_id: null }],
    });
    const [hit] = await findSimilarOpenDemands(
      sb,
      { tenantId: "t1", customerId: "c1", transactionType: "sale", propertyType: "apartment", districtId: "" },
      { userId: ME, officeWide: false },
    );
    expect(hit.visible).toBe(false);
    expect(hit.label).toBeNull();
  });
});
