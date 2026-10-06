import { beforeEach, describe, expect, it, vi } from "vitest";

const inserted: Record<string, unknown>[] = [];
const updated: Record<string, unknown>[] = [];
const importExisting: string[][] = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/billing/plan-definitions", async () => {
  const { getPlan } = await import("@/lib/billing/plans");
  return { getPlanDefinition: vi.fn(async (id: string) => getPlan(id)) };
});
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/revalidate", () => ({ revalidateTenantData: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/automation-engine", () => ({ dispatchAutomationEvent: vi.fn() }));
vi.mock("@/lib/playbook-trigger", () => ({ triggerPlaybooks: vi.fn() }));
vi.mock("@/lib/pool/server", () => ({ enqueueListingPoolBatch: vi.fn(async () => ({ queued: 0, disabled: true, failed: 0 })) }));
vi.mock("@/lib/pool/notify", () => ({ notifyPoolBatch: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("admin client doğrulamadan önce çağrılmamalı");
  },
}));
vi.mock("@/lib/require-permission", () => ({
  requirePermission: vi.fn(async () => ({ ok: true, tenantId: "t1", userId: "u1" })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", app_metadata: { role: "owner" } } } }) },
    from: () => {
      const chain: Record<string, unknown> = {
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return { select: () => ({ single: async () => ({ data: { id: "c1" }, error: null }) }) };
        },
        update: (row: Record<string, unknown>) => {
          updated.push(row);
          return chain;
        },
        select: () => chain,
        in: async () => ({ data: importExisting.flat().map((phone) => ({ phone })), error: null }),
        eq: () => chain,
        is: () => chain,
        then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
      };
      return chain;
    },
  }),
}));

import { createCustomer, updateCustomer } from "./customers";
import { createTeamMember } from "./team";
import { importChunk } from "./import-data";

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

beforeEach(() => {
  inserted.length = 0;
  updated.length = 0;
  importExisting.length = 0;
});

describe("createCustomer / updateCustomer telefon + e-posta", () => {
  it("TR numarasının her biçimi aynı saklama biçimine normalize olur (dedupe tutarlılığı)", async () => {
    for (const raw of ["0532 123 45 67", "+90 532 123 45 67", "532 123 45 67", "905321234567"]) {
      inserted.length = 0;
      const r = await createCustomer({}, fd({ full_name: "Ali", phone: raw }));
      expect(r.error).toBeUndefined();
      expect(inserted[0].phone).toBe("05321234567");
    }
  });

  it("yabancı numara +E164 saklanır", async () => {
    await createCustomer({}, fd({ full_name: "Hans", phone: "+49 151 2345 6789" }));
    expect(inserted[0].phone).toBe("+4915123456789");
  });

  it("geçersiz telefon ve e-postayı reddeder, yazmaz", async () => {
    const badPhone = await createCustomer({}, fd({ full_name: "Ali", phone: "abc" }));
    expect(badPhone.error).toBeTruthy();
    const badMail = await createCustomer({}, fd({ full_name: "Ali", email: "ali@" }));
    expect(badMail.error).toBe("Geçerli bir e-posta adresi girin");
    expect(inserted).toHaveLength(0);
  });

  it("e-posta kırpılır ve küçük harfe çevrilir", async () => {
    await createCustomer({}, fd({ full_name: "Ali", email: "  Ali@Ornek.COM " }));
    expect(inserted[0].email).toBe("ali@ornek.com");
  });

  it("güncellemede de aynı doğrulama", async () => {
    const bad = await updateCustomer({}, fd({ id: "c1", full_name: "Ali", email: "x" }));
    expect(bad.error).toBe("Geçerli bir e-posta adresi girin");
    const ok = await updateCustomer({}, fd({ id: "c1", full_name: "Ali", phone: "+90 532 123 45 67" }));
    expect(ok.error).toBeUndefined();
    expect(updated[0].phone).toBe("05321234567");
  });
});

describe("createTeamMember", () => {
  it("geçersiz e-posta/telefon admin client'a gitmeden reddedilir", async () => {
    const base = { full_name: "Veli", password: "Sifre1234!", role: "advisor" };
    const m = await createTeamMember({}, fd({ ...base, email: "veli" }));
    expect(m.error).toBe("Geçerli bir e-posta adresi girin");
    const p = await createTeamMember({}, fd({ ...base, email: "veli@ofis.com", phone: "12" }));
    expect(p.error).toBeTruthy();
  });
});

describe("importChunk (içe aktarma sihirbazının yolu)", () => {
  it("geçersiz telefon/e-posta satırı raporlanır; farklı biçimli aynı numara dosyada tekilleşir", async () => {
    const res = await importChunk(
      "customers",
      [
        { row: 1, full_name: "A", phone: "0532 123 45 67" },
        { row: 2, full_name: "B", phone: "+90 532 123 45 67" },
        { row: 3, full_name: "C", phone: "xyz" },
        { row: 4, full_name: "D", email: "bozuk" },
        { row: 5, full_name: "E", phone: "+49 151 2345 6789" },
      ],
      { batchId: crypto.randomUUID() },
    );
    expect(res.error).toBeFalsy();
    const problemRows = (res.rows ?? []).filter((r) => r.status === "error" || r.status === "skip").map((r) => r.row).sort();
    expect(problemRows).toEqual([2, 3, 4]);
    expect(res.counters?.skip).toBe(1);
  });
});
