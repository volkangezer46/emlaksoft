/**
 * home_snapshot RPC'si: saf ayrıştırıcı + RPC yokken zarif düşüş (sahte sıfır yok).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRpcProbes } from "@/lib/supabase/rpc-probe";
import { parseHomeScopeSnapshot } from "./snapshot-core";

const db = vi.hoisted(() => ({
  calls: [] as string[],
  response: null as { data: unknown; error: { code?: string; message?: string } | null } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc(fn: string, args: Record<string, unknown>) {
      db.calls.push(`${fn}:${JSON.stringify(args)}`);
      return Promise.resolve(db.response ?? { data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    },
  }),
}));

import { loadHomeScopeSnapshot } from "./data-batch";

const RAW = {
  version: 1,
  scope: "ben",
  sample_included: false,
  appointments: {
    total: 3,
    rows: [
      {
        id: "a1",
        appointment_type: "showing",
        scheduled_at: "2026-10-11T08:00:00+00:00",
        status: "pending",
        duration_min: 45,
        location: null,
        customer: { full_name: "Ayşe Yılmaz", phone: "05321234567" },
        property: { lat: 41.01, lng: 28.97 },
      },
      { id: 7, scheduled_at: "bozuk" },
    ],
  },
  stale_deals: { days: 14, count: 2 },
  office_target: { target_deals: 5, target_revenue: "250000" },
  my_target: null,
  probe: { customers: 45, properties: 24 },
};

afterEach(() => {
  db.calls = [];
  db.response = null;
  resetRpcProbes();
});

describe("parseHomeScopeSnapshot", () => {
  it("geçerli JSON'u tipler; bozuk randevu satırını atar, toplamı satır sayısının altına düşürmez", () => {
    const s = parseHomeScopeSnapshot(RAW);
    expect(s).not.toBeNull();
    expect(s!.scope).toBe("ben");
    expect(s!.appointments.rows).toHaveLength(1);
    expect(s!.appointments.total).toBe(3);
    expect(s!.appointments.rows[0].customer).toEqual({ full_name: "Ayşe Yılmaz", phone: "05321234567" });
    expect(s!.staleDeals).toEqual({ days: 14, count: 2 });
    expect(s!.officeTarget).toEqual({ target_deals: 5, target_revenue: 250000 });
    expect(s!.myTarget).toBeNull();
    expect(s!.probe).toEqual({ customers: 45, properties: 24 });
  });

  it("şekil bozuksa null (çağıran eski sorgulara düşer)", () => {
    expect(parseHomeScopeSnapshot(null)).toBeNull();
    expect(parseHomeScopeSnapshot({ ...RAW, scope: "baska" })).toBeNull();
    expect(parseHomeScopeSnapshot({ ...RAW, sample_included: "evet" })).toBeNull();
    expect(parseHomeScopeSnapshot({ ...RAW, probe: null })).toBeNull();
  });
});

describe("loadHomeScopeSnapshot", () => {
  it("RPC yoksa null döner; ikinci çağrı yoklama sayesinde RPC'yi hiç çağırmaz", async () => {
    expect(await loadHomeScopeSnapshot("t-yok", "ofis", 14)).toBeNull();
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toBe('home_snapshot:{"p_scope":"ofis","p_stale_days_default":14}');
    db.calls = [];
    expect(await loadHomeScopeSnapshot("t-yok-2", "ben", 14)).toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it("RPC varsa ayrıştırılmış görüntüyü döner", async () => {
    db.response = { data: RAW, error: null };
    const s = await loadHomeScopeSnapshot("t-var", "ben", 21);
    expect(s?.staleDeals.count).toBe(2);
    expect(db.calls[0]).toContain('"p_stale_days_default":21');
  });
});
