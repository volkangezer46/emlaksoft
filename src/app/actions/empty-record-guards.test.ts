import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * KQ3 sözleşmesi: boş "Yeni anlaşma" ve boş "Randevuyu planla" sunucuda reddedilir — istemci kuralı
 * atlansa (eski sekme, elle POST) bile kayıt OLUŞMAZ. Kural istemciyle tek kaynak (deal-tabs / appointment-tabs).
 */

const requirePermission = vi.fn();
const inserts: { table: string; row: unknown }[] = [];

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T,>(fn: T) => fn,
}));
vi.mock("@/lib/require-permission", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...a) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({}) }) }));
vi.mock("@/lib/tenant-references", () => ({ validateTenantReferences: async () => ({ ok: true }) }));
vi.mock("@/lib/custom-fields/save", () => ({
  prepareCustomFieldInputs: async () => ({ ok: true, value: [] }),
  writeCustomFieldInputs: async () => undefined,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        neq: () => chain,
        gte: () => chain,
        lt: () => chain,
        is: () => chain,
        insert: (row: unknown) => {
          inserts.push({ table, row });
          return chain;
        },
        single: async () => ({ data: { id: "new-id" }, error: null }),
        maybeSingle: async () => ({ data: { id: "new-id" }, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
      };
      return chain;
    },
  }),
}));

import { createPipelineDeal } from "./deals";
import { createAppointment } from "./appointments";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  inserts.length = 0;
  requirePermission.mockReset();
  requirePermission.mockResolvedValue({ ok: true, tenantId: "t1", userId: "u1", role: "agent" });
});

describe("createPipelineDeal — boş anlaşma reddi", () => {
  it("formun varsayılanlarıyla (müşteri/portföy/tutar boş) kayıt oluşturmaz", async () => {
    const res = await createPipelineDeal(fd({ property_id: "", customer_id: "", deal_type: "sale", stage: "new", deal_value: "" }));
    expect(res.ok).toBeFalsy();
    expect(res.error).toMatch(/Müşteri ya da portföy/);
    expect(res.error).toMatch(/Tutar/);
    expect(inserts).toHaveLength(0);
  });

  it("taraf var ama tutar yoksa reddeder", async () => {
    const res = await createPipelineDeal(fd({ customer_id: "c1", deal_value: "  " }));
    expect(res.error).toMatch(/Tutar/);
    expect(inserts).toHaveLength(0);
  });

  it("tutar var ama taraf yoksa reddeder", async () => {
    const res = await createPipelineDeal(fd({ deal_value: "4.500.000" }));
    expect(res.error).toMatch(/Müşteri ya da portföy/);
    expect(inserts).toHaveLength(0);
  });
});

describe("createAppointment — boş randevu reddi", () => {
  it("katılımcısız yer gösterme kayıt oluşturmaz (müşteri + portföy eksik)", async () => {
    const res = await createAppointment(fd({ appointment_type: "showing", date: "2026-10-20", time: "10:00" }));
    expect(res.error).toMatch(/Müşteri/);
    expect(res.error).toMatch(/Portföy/);
    expect(inserts).toHaveLength(0);
  });

  it("yer göstermede tek taraf yetmez", async () => {
    const res = await createAppointment(fd({ appointment_type: "showing", date: "2026-10-20", time: "10:00", customer_id: "c1" }));
    expect(res.error).toMatch(/Portföy/);
    expect(inserts).toHaveLength(0);
  });

  it("diğer türlerde müşteri ya da portföyden biri şart", async () => {
    const res = await createAppointment(fd({ appointment_type: "office", date: "2026-10-20", time: "10:00" }));
    expect(res.error).toMatch(/Müşteri ya da portföy/);
    expect(inserts).toHaveLength(0);
  });

  it("ofis görüşmesi yalnız müşteriyle kabul edilir (kural engellemez)", async () => {
    const res = await createAppointment(fd({ appointment_type: "office", date: "2026-10-20", time: "10:00", customer_id: "c1" }));
    expect(res.error).toBeUndefined();
    expect(inserts.filter((i) => i.table === "appointments")).toHaveLength(1);
  });
});
