import { beforeEach, describe, expect, it, vi } from "vitest";

type Res = { units: number; state: "reserved" | "committed" | "released"; idem: string };
type Stored = { input_key: string; result: unknown; units_charged: number; created_at: string };

const w = vi.hoisted(() => ({
  ready: true,
  balance: 100,
  tableMissing: false,
  insertFails: false,
  noComps: false,
  nowMs: Date.parse("2026-10-08T09:00:00.000Z"),
  listPrice: 6_000_000,
  res: new Map<string, Res>(),
  rows: [] as Stored[],
  reserveCalls: 0,
  commitCalls: 0,
  releaseCalls: 0,
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
vi.mock("./wallet", () => {
  const available = () => w.balance - [...w.res.values()].filter((r) => r.state === "reserved").reduce((s, r) => s + r.units, 0);
  return {
    efCreditReady: async () => w.ready,
    efReserve: async (p: { units: number; idem: string; item: string }) => {
      w.reserveCalls += 1;
      expect(p.item).toBe("listing_analysis");
      for (const [id, r] of w.res) if (r.idem === p.idem) return { ok: true, code: "duplicate", reservation_id: id, state: r.state, available: available() };
      if (available() < p.units) return { ok: false, code: "insufficient", available: available() };
      const id = crypto.randomUUID();
      w.res.set(id, { units: p.units, state: "reserved", idem: p.idem });
      return { ok: true, code: "ok", reservation_id: id, state: "reserved", available: available() };
    },
    efCommit: async (_t: string, id: string) => {
      w.commitCalls += 1;
      const r = w.res.get(id)!;
      if (r.state === "committed") return { ok: true, state: "committed", already: true };
      r.state = "committed";
      w.balance -= r.units;
      return { ok: true, state: "committed", already: false };
    },
    efRelease: async (_t: string, id: string) => {
      w.releaseCalls += 1;
      const r = w.res.get(id)!;
      if (r.state === "reserved") r.state = "released";
      return { ok: true, state: r.state, already: false };
    },
  };
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
  w.ready = true;
  w.balance = 100;
  w.tableMissing = false;
  w.insertFails = false;
  w.noComps = false;
  w.nowMs = Date.parse("2026-10-08T09:00:00.000Z");
  w.listPrice = 6_000_000;
  w.res.clear();
  w.rows.length = 0;
  w.reserveCalls = w.commitCalls = w.releaseCalls = 0;
});

describe("ilan analizi kontör tüketimi", () => {
  it("ilk analiz TEK kontör düşer ve sonuç kaydedilir", async () => {
    const out = await run();
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.cached).toBe(false);
    expect(out.unitsCharged).toBe(1);
    expect(w.balance).toBe(99);
    expect([w.reserveCalls, w.commitCalls, w.releaseCalls]).toEqual([1, 1, 0]);
    expect(w.rows).toHaveLength(1);
    expect(out.result.position.verdict).toBe("piyasa üstü");
  });

  it("24 saat içinde aynı girdiyle tekrar ücret alınmaz (önbellek)", async () => {
    await run();
    w.nowMs += 23 * 3_600_000;
    const again = await run();
    expect(again.status).toBe("ok");
    if (again.status === "ok") {
      expect(again.cached).toBe(true);
      expect(again.unitsCharged).toBe(0);
    }
    expect(w.balance).toBe(99);
    expect(w.reserveCalls).toBe(1);
    expect(w.rows).toHaveLength(1);
  });

  it("24 saat geçince yeniden analiz yeniden ücretlenir", async () => {
    await run();
    w.nowMs += 25 * 3_600_000;
    await run();
    expect(w.balance).toBe(98);
    expect(w.rows).toHaveLength(2);
  });

  it("fiyat değişince (yeni girdi) önbellek geçersiz, yeni analiz ücretlenir", async () => {
    await run();
    w.listPrice = 5_500_000;
    const out = await run();
    expect(out.status === "ok" && out.cached).toBe(false);
    expect(w.balance).toBe(98);
  });

  it("çift tıklama/yarış tek düşüm yapar", async () => {
    await Promise.all([run(), run()]);
    expect(w.balance).toBe(99);
    expect([...w.res.values()].filter((r) => r.state === "committed")).toHaveLength(1);
  });

  it("emsal yoksa kontör düşmez ve rezerv açılmaz", async () => {
    w.noComps = true;
    const out = await run();
    expect(out.status).toBe("no_comps");
    expect(w.reserveCalls).toBe(0);
    expect(w.balance).toBe(100);
    expect(w.rows).toHaveLength(0);
  });

  it("bakiye yoksa no_credit; kayıt ve düşüm yok", async () => {
    w.balance = 0;
    const out = await run();
    expect(out).toMatchObject({ status: "no_credit", available: 0, needed: 1 });
    expect(w.rows).toHaveLength(0);
    expect(w.commitCalls).toBe(0);
  });

  it("kayıt yazılamazsa rezerv iade edilir (kontör düşmez)", async () => {
    w.insertFails = true;
    const out = await run();
    expect(out.status).toBe("error");
    expect(w.releaseCalls).toBe(1);
    expect(w.commitCalls).toBe(0);
    expect(w.balance).toBe(100);
  });

  it("cüzdan hazır değil veya tablo yok: etkin değil, hiçbir rezerv yok", async () => {
    w.ready = false;
    expect((await run()).status).toBe("disabled");
    w.ready = true;
    w.tableMissing = true;
    expect((await run()).status).toBe("disabled");
    expect(w.reserveCalls).toBe(0);
  });
});
