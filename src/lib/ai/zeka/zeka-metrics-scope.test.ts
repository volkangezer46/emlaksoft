import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MATRIX } from "@/lib/permissions";
import { KnowledgeBase } from "./knowledge/base";
import { makeScope } from "./scope";
import { toolCountMetric, type MetricQuery, type ToolEnv, type ZekaDataPort } from "./tools";
import type { MetricId } from "./metrics";

/**
 * SEC-7: kendi kapsamındaki rol (danışman) ofis geneli sayıyı "kapsamınızdaki" etiketiyle ALMAZ. Kira/sözleşme
 * sayıları ofis kapsamı ister ("yetki_yok"); teklif sayısı oluşturan kişiye süzülür (teklif listesiyle aynı kural).
 */

vi.mock("server-only", () => ({}));

const NOW = Date.parse("2026-10-17T09:00:00+03:00");

function envFor(role: "advisor" | "owner") {
  const calls: { id: MetricId; q: MetricQuery }[] = [];
  const port: ZekaDataPort = {
    async search() {
      return [];
    },
    async metric(id, q) {
      calls.push({ id, q });
      return { kind: "count", count: 4 };
    },
  };
  // Tüm modülleri görebilen izin seti: ret yalnız veri kapsamından gelmeli.
  const scope = makeScope({ userId: "u-adv", tenantId: "t1", role, perms: DEFAULT_MATRIX.owner, closed: [], locked: [] });
  const env: ToolEnv = { scope, port, kb: new KnowledgeBase([]), nowMs: NOW };
  return { env, calls };
}

describe("Zeka metrik kapsamı (kendi kapsamındaki rol)", () => {
  for (const id of ["rent_overdue", "rentals_active", "contracts_active"] as const) {
    it(`${id}: danışmana ofis geneli sayı verilmez (yetki_yok, sorgu yok)`, async () => {
      const { env, calls } = envFor("advisor");
      const out = await toolCountMetric(env, { query: "kaç tane", metric: id });
      expect(out.summary).toMatchObject({ durum: "yetki_yok", metrik: id, neden: "ofis_kapsami" });
      expect(out.answer).not.toContain("kapsamınızdaki");
      expect(calls).toHaveLength(0);
    });
    it(`${id}: ofis geneli rol sayıyı alır`, async () => {
      const { env, calls } = envFor("owner");
      const out = await toolCountMetric(env, { query: "kaç tane", metric: id });
      expect(out.answered).toBe(true);
      expect(calls[0]?.q.officeWide).toBe(true);
    });
  }

  it("offers_open: danışman sayıyı alır, kapsamı kendi (officeWide=false) ve 'kapsamınızdaki' notu doğru", async () => {
    const { env, calls } = envFor("advisor");
    const out = await toolCountMetric(env, { query: "bekleyen teklif", metric: "offers_open" });
    expect(out.answered).toBe(true);
    expect(calls[0]).toMatchObject({ id: "offers_open", q: { officeWide: false } });
    expect(out.answer).toContain("kapsamınızdaki");
  });
});

/* -------------------------- port-supabase: teklif sayısı created_by ile süzülür -------------------------- */

const h = vi.hoisted(() => ({ ops: [] as string[][] }));
vi.mock("@/lib/supabase/server", () => {
  const builder = (table: string) => {
    const ops: string[] = [`from:${table}`];
    h.ops.push(ops);
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "lt", "gte", "not", "neq", "limit"]) {
      b[m] = (...args: unknown[]) => {
        ops.push(`${m}:${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(",")}`);
        return b;
      };
    }
    b.then = (resolve: (v: unknown) => void) => resolve({ count: 2, error: null, data: [] });
    return b;
  };
  return { createClient: async () => ({ from: builder }) };
});
vi.mock("@/app/actions/search", () => ({ searchWorkspace: async () => [] }));
vi.mock("@/lib/access-control/list-scope", () => ({ getListScope: async (i: { userId: string }) => ({ filter: { kind: "self", userId: i.userId } }) }));

describe("createSupabaseZekaPort: offers_open sahiplik süzgeci", () => {
  it("ofis geneli olmayan sorguda offers.created_by = kullanıcı; kira/sözleşme sorgusu hiç atılmaz", async () => {
    const { createSupabaseZekaPort } = await import("./port-supabase");
    const scope = makeScope({ userId: "u-adv", tenantId: "t1", role: "advisor", perms: DEFAULT_MATRIX.advisor, closed: [], locked: [] });
    const port = createSupabaseZekaPort(scope);
    const base = { slots: {} as MetricQuery["slots"], period: null, officeWide: false, earnings: false };
    h.ops.length = 0;
    expect(await port.metric("offers_open", base)).toEqual({ kind: "count", count: 2 });
    const offers = h.ops.find((o) => o[0] === "from:offers")!;
    expect(offers).toContain("eq:created_by,u-adv");
    h.ops.length = 0;
    for (const id of ["rent_overdue", "rentals_active", "contracts_active"] as const) expect(await port.metric(id, base)).toBeNull();
    expect(h.ops).toHaveLength(0);
  });
});
