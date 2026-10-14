import { describe, expect, it, vi } from "vitest";

/** Sınır dışı sayfa (PostgREST PGRST103) Entegrasyon merkezini hata ekranına düşürmez: boş sayfa + gerçek toplam döner. */

const COUNTS: Record<string, number> = { queued: 3, delivered: 5, failed: 2 };

function fakeAdmin() {
  return {
    from(name: string) {
      if (name === "tenants") {
        return { select: () => ({ in: () => Promise.resolve({ data: [{ id: "11111111-1111-4111-8111-111111111111", name: "Ofis A" }], error: null }) }) };
      }
      let head = false;
      let status: string | null = null;
      const b = {
        select(_cols: string, opts?: { head?: boolean }) {
          head = Boolean(opts?.head);
          return b;
        },
        order: () => b,
        eq(k: string, v: string) {
          if (k === "status") status = v;
          return b;
        },
        range: () => Promise.resolve({ data: null, count: null, error: { code: "PGRST103", message: "Requested range not satisfiable" } }),
        then(resolve: (v: unknown) => void) {
          resolve(head ? { count: COUNTS[status ?? ""] ?? 0, error: null } : { data: [], error: null });
        },
      };
      return b;
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeAdmin() }));

import { loadMessageLog } from "./message-log-read";

describe("loadMessageLog sınır dışı sayfa", () => {
  it("süzgeçsiz: boş satır, toplam = durum sayılarının toplamı", async () => {
    const r = await loadMessageLog({ page: 999, pageSize: 50 });
    expect(r).toMatchObject({ installed: true, rows: [], total: 10 });
    expect(r.statusCounts.delivered).toBe(5);
  });

  it("durum süzgeçli ve ofis süzgeçli: toplam = seçili durumun sayısı, ofis adı çözülür", async () => {
    const r = await loadMessageLog({ page: 999, pageSize: 50, status: "failed", tenantId: "11111111-1111-4111-8111-111111111111" });
    expect(r.total).toBe(2);
    expect(r.tenantNames.get("11111111-1111-4111-8111-111111111111")).toBe("Ofis A");
  });
});
