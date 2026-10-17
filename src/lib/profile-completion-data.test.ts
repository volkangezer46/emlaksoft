import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; select: string; filters: [string, unknown][] };
const h = vi.hoisted(() => ({
  calls: [] as Call[],
  results: {} as Record<string, { data: unknown; error: unknown; count?: number | null }>,
}));

function builder(table: string, select: string) {
  const call: Call = { table, select, filters: [] };
  h.calls.push(call);
  // getTenantRow (PERF-6): önce birleşik kolonlar (genişletme dahil) okunur; 42703'te temel kolonlarla tekrar.
  const key = table === "tenants" ? (select.includes("office_type") ? "tenants_full" : "tenants_base") : table;
  const b: Record<string, unknown> = {};
  b.eq = (col: string, val: unknown) => {
    call.filters.push([col, val]);
    return b;
  };
  b.maybeSingle = async () => h.results[key];
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(h.results[key]).then(res);
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => ({ select: (s: string) => builder(table, s) }) }),
}));

import { loadProfileSnapshot } from "@/lib/profile-completion-data";

const BASE = { id: "t", name: "Ofis", slug: "ofis", province_id: null, district_id: null, address_line: null, phone: null, license_no: null, tax_number: null, tax_office: "Kadıköy", logo_url: null, brand_color: null };

beforeEach(() => {
  h.calls.length = 0;
  h.results = {
    tenants_full: { data: { ...BASE, office_type: "kurumsal", focus_segments: ["kiralik"], work_district_ids: ["d1"] }, error: null },
    tenants_base: { data: BASE, error: null },
    profiles: { data: null, error: null, count: 3 },
  };
});

describe("loadProfileSnapshot", () => {
  it("her sorguyu tenant_id/id ile süzer; ofis satırı TEK okuma (getTenantRow)", async () => {
    await loadProfileSnapshot("t-1");
    const tenantCalls = h.calls.filter((c) => c.table === "tenants");
    expect(tenantCalls).toHaveLength(1);
    for (const c of tenantCalls) expect(c.filters).toEqual([["id", "t-1"]]);
    expect(h.calls.find((c) => c.table === "profiles")!.filters).toEqual([["tenant_id", "t-1"]]);
  });

  it("değerleri okur; üye sayısı ve ofis özeti dolar", async () => {
    const snap = await loadProfileSnapshot("t-2");
    expect(snap?.facts.memberCount).toBe(3);
    expect(snap?.facts.extAvailable).toBe(true);
    expect(snap?.facts.officeType).toBe("kurumsal");
    expect(snap?.office).toEqual({ name: "Ofis", taxOffice: "Kadıköy", slug: "ofis" });
  });

  it("temel kayıt yok (null) ise null döner", async () => {
    h.results.tenants_full = { data: null, error: null };
    expect(await loadProfileSnapshot("t-3")).toBeNull();
  });

  it("temel okuma hatası veya üye sayımı hatası null döner (sahte ilerleme yok)", async () => {
    h.results.tenants_full = { data: null, error: { message: "x" } };
    expect(await loadProfileSnapshot("t-4")).toBeNull();
    h.results.tenants_full = { data: { ...BASE, office_type: null, focus_segments: null, work_district_ids: null }, error: null };
    h.results.profiles = { data: null, error: { message: "y" }, count: null };
    expect(await loadProfileSnapshot("t-5")).toBeNull();
  });

  it("genişletme sütunları yoksa yalnız extAvailable=false olur", async () => {
    h.results.tenants_full = { data: null, error: { code: "42703", message: "column does not exist" } };
    const snap = await loadProfileSnapshot("t-6");
    expect(snap?.facts.extAvailable).toBe(false);
    expect(snap?.facts.officeType).toBeNull();
    expect(snap?.facts.focusSegments).toBeNull();
  });
});
