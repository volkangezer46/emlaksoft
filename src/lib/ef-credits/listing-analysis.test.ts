import { beforeEach, describe, expect, it, vi } from "vitest";

type Stored = { input_key: string; result: unknown; units_charged: number; created_at: string };

const w = vi.hoisted(() => ({
  tableMissing: false,
  insertFails: false,
  noComps: false,
  nowMs: Date.parse("2026-10-08T09:00:00.000Z"),
  listPrice: 6_000_000,
  rows: [] as Stored[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/activity", () => ({ logActivity: async () => ({ ok: true }) }));
vi.mock("@/lib/clock", () => ({ now: () => w.nowMs }));
vi.mock("@/lib/platform-settings", () => ({ getPlatformSetting: async () => null }));
vi.mock("@/lib/integrations/emlakfiyati/client", () => ({ getEndeksForPlace: async () => ({ status: "empty", requestedPath: null }) }));
vi.mock("@/lib/photo-quality/load", () => ({ loadPhotoQuality: async () => ({ enabled: false }) }));
vi.mock("@/lib/comparables", () => ({
  estimateFromComparables: async () =>
    w.noComps
      ? { estimatedValue: null, lowValue: null, highValue: null, medianSqmPrice: null, compCount: 0, wonCount: 0, activeCount: 0, confidence: "yetersiz", spreadPct: null }
      : { estimatedValue: 5_000_000, lowValue: 4_700_000, highValue: 5_300_000, medianSqmPrice: 50_000, compCount: 9, wonCount: 4, activeCount: 5, confidence: "orta", spreadPct: 8 },
}));
// KONTÖRSÜZ (2026-10-10): cüzdan modülü HİÇ yüklenmemeli; yüklenirse test düşer.
vi.mock("./wallet", () => {
  throw new Error("ilan analizi cüzdana (kontör) dokunmamalı");
});

import { runListingAnalysis } from "./listing-analysis";

const PROP = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Kadıköy Satılık 3+1 Daire 120 m²",
  status: "live",
  transaction_type: "Satılık",
  property_type: "Daire",
  district_id: "d1",
  address_line: "x",
  lat: null,
  lng: null,
  features: { rooms: "3+1", sqm: 100, description: "x".repeat(250) },
  published_at: "2026-07-01T00:00:00.000Z",
  created_at: "2026-07-01T00:00:00.000Z",
  province: { name: "İstanbul" },
  district: { name: "Kadıköy" },
};

function fakeSupabase() {
  return {
    from(table: string) {
      let head = false;
      let insertPayload: Record<string, unknown> | null = null;
      const b: Record<string, unknown> = {
        select: (_c?: string, o?: { head?: boolean }) => {
          if (o?.head) head = true;
          return b;
        },
        insert: (p: Record<string, unknown>) => {
          insertPayload = p;
          return b;
        },
        eq: () => b,
        is: () => b,
        order: () => b,
        limit: () => b,
        maybeSingle: async () => {
          if (table === "properties") return { data: { ...PROP, list_price: w.listPrice }, error: null };
          if (table === "listing_analyses") {
            const last = w.rows[w.rows.length - 1];
            return { data: last ? { id: "a", ...last } : null, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => {
          if (w.insertFails || !insertPayload) return { data: null, error: { message: "insert" } };
          const created_at = new Date(w.nowMs).toISOString();
          w.rows.push({ input_key: String(insertPayload.input_key), result: insertPayload.result, units_charged: Number(insertPayload.units_charged), created_at });
          return { data: { created_at }, error: null };
        },
        then: (res: (v: unknown) => unknown) => res({ data: null, error: w.tableMissing && head ? { message: "relation missing" } : null }),
      };
      return b;
    },
  };
}

const run = () =>
  runListingAnalysis({ supabase: fakeSupabase() as never, tenantId: "t1", userId: "u1", propertyId: PROP.id });

beforeEach(() => {
  w.tableMissing = false;
  w.insertFails = false;
  w.noComps = false;
  w.nowMs = Date.parse("2026-10-08T09:00:00.000Z");
  w.listPrice = 6_000_000;
  w.rows.length = 0;
});

describe("ilan analizi: kontörsüz", () => {
  it("ilk analiz kontör düşmez (units_charged 0) ve sonuç kaydedilir", async () => {
    const out = await run();
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.cached).toBe(false);
    expect(out.unitsCharged).toBe(0);
    expect(out.settlementPending).toBe(false);
    expect(w.rows).toHaveLength(1);
    expect(w.rows[0]!.units_charged).toBe(0);
    expect(out.result.position.verdict).toBe("piyasa üstü");
  });

  it("24 saat içinde aynı girdiyle kayıtlı sonuç döner (yeni kayıt yok)", async () => {
    await run();
    w.nowMs += 23 * 3_600_000;
    const again = await run();
    expect(again.status).toBe("ok");
    if (again.status === "ok") {
      expect(again.cached).toBe(true);
      expect(again.unitsCharged).toBe(0);
    }
    expect(w.rows).toHaveLength(1);
  });

  it("24 saat geçince ya da girdi (fiyat) değişince yeniden hesaplanır; yine kontörsüz", async () => {
    await run();
    w.nowMs += 25 * 3_600_000;
    await run();
    expect(w.rows).toHaveLength(2);
    w.listPrice = 5_500_000;
    const out = await run();
    expect(out.status === "ok" && out.cached).toBe(false);
    expect(w.rows).toHaveLength(3);
    expect(w.rows.every((r) => r.units_charged === 0)).toBe(true);
  });

  it("emsal yoksa kayıt yazılmaz", async () => {
    w.noComps = true;
    const out = await run();
    expect(out.status).toBe("no_comps");
    expect(w.rows).toHaveLength(0);
  });

  it("kayıt yazılamazsa hata döner (kontör zaten yok)", async () => {
    w.insertFails = true;
    const out = await run();
    expect(out.status).toBe("error");
  });

  it("tablo yoksa özellik etkin değil; cüzdan hazır olmasa da çalışır (bakiye aranmaz)", async () => {
    w.tableMissing = true;
    expect((await run()).status).toBe("disabled");
    w.tableMissing = false;
    expect((await run()).status).toBe("ok");
  });
});
