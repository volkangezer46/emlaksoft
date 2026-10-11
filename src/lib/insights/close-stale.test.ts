import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseMock, hasFilter, type RecordedQuery } from "../../test/supabase-mock";
import { processTenant } from "@/lib/insights/engine";
import { InsightFactsUnavailable } from "@/lib/insights/facts";
import type { InsightRule } from "@/lib/insights/rules";
import { evaluateCallPriorityRun } from "@/lib/insights/rules/call-priority";
import { closeCallPriorityForCustomer, expireStaleInsights, selectStaleInsightIds } from "@/lib/insights/store";
import type { InsightDraft, InsightRuleRun } from "@/lib/insights/types";

/**
 * ARGE-1: koşulu kalkan içgörü satırları motor turunda kapanır (valid_until = şimdi); kural hata verirse,
 * olgu yoksa (InsightFactsUnavailable) ya da üst sınırla elenen kayıt varsa KAPANMAZ.
 */
const NOW = Date.UTC(2026, 9, 6, 9, 0, 0);
const NOW_ISO = new Date(NOW).toISOString();
const U1 = "11111111-1111-4111-8111-111111111111";

const openRows = [
  { id: "i-old", entity_id: "c-old" },
  { id: "i-live", entity_id: "c-live" },
];

function setup(rows = openRows) {
  const mock = createSupabaseMock((q: RecordedQuery) => {
    if (q.table === "customers" || q.table === "properties") return { count: 9, data: [] };
    if (q.table === "profiles") return { data: [{ id: U1, role: "advisor" }] };
    if (q.table === "insights" && q.op === "update") return { data: rows.filter((r) => hasInIds(q, r.id)).map((r) => ({ id: r.id })) };
    if (q.table === "insights") return { data: rows };
    return { data: [] };
  });
  return { mock, admin: mock.client as unknown as SupabaseClient };
}
function hasInIds(q: RecordedQuery, id: string): boolean {
  const f = q.filters.find((x) => x.method === "in" && x.args[0] === "id");
  return Array.isArray(f?.args[1]) && (f!.args[1] as string[]).includes(id);
}
const rule = (run: InsightRule["run"]): InsightRule => ({ id: "call_priority@1", kind: "call_priority", label: "Test", run });
const updates = (m: ReturnType<typeof setup>["mock"]) => m.forTable("insights", "update");

describe("selectStaleInsightIds (saf)", () => {
  it("canlı kümede olmayan varlıkların satırlarını seçer; entity_id'siz satıra dokunmaz", () => {
    const rows = [...openRows, { id: "i-null", entity_id: null }];
    expect(selectStaleInsightIds(rows, new Set(["c-live"]))).toEqual(["i-old"]);
    expect(selectStaleInsightIds(rows, new Set(["c-live", "c-old"]))).toEqual([]);
  });
});

describe("expireStaleInsights", () => {
  it("yalnız bu kuralın açık satırlarını okur ve stale olanları valid_until=şimdi yapar; state/state_reason'a dokunmaz", async () => {
    const { mock, admin } = setup();
    const closed = await expireStaleInsights(admin, "t1", "call_priority@1", new Set(["c-live"]), NOW);
    expect(closed).toBe(1);
    const [sel] = mock.forTable("insights", "select");
    expect(hasFilter(sel, "eq", "tenant_id", "t1")).toBe(true);
    expect(hasFilter(sel, "eq", "rule_id", "call_priority@1")).toBe(true);
    expect(sel.filters.find((f) => f.method === "in" && f.args[0] === "state")?.args[1]).toEqual(["new", "seen", "snoozed"]);
    expect(hasFilter(sel, "gt", "valid_until", NOW_ISO)).toBe(true);
    const [upd] = updates(mock);
    expect(upd.payload).toEqual({ valid_until: NOW_ISO });
    expect(upd.payload).not.toHaveProperty("state");
    expect(upd.payload).not.toHaveProperty("state_reason");
    expect(hasFilter(upd, "eq", "tenant_id", "t1")).toBe(true);
    expect(upd.filters.find((f) => f.method === "in" && f.args[0] === "id")?.args[1]).toEqual(["i-old"]);
  });

  it("hepsi canlıysa yazma gitmez", async () => {
    const { mock, admin } = setup();
    expect(await expireStaleInsights(admin, "t1", "call_priority@1", new Set(["c-live", "c-old"]), NOW)).toBe(0);
    expect(updates(mock)).toHaveLength(0);
  });
});

describe("closeCallPriorityForCustomer (olay anında)", () => {
  it("kiracı + müşteri + call_priority + açık satırlarla sınırlı; yalnız valid_until yazar", async () => {
    const { mock, admin } = setup();
    await closeCallPriorityForCustomer(admin, "t1", "c-old", NOW);
    const [upd] = updates(mock);
    expect(upd.payload).toEqual({ valid_until: NOW_ISO });
    expect(hasFilter(upd, "eq", "tenant_id", "t1")).toBe(true);
    expect(hasFilter(upd, "eq", "kind", "call_priority")).toBe(true);
    expect(hasFilter(upd, "eq", "entity_id", "c-old")).toBe(true);
    expect(upd.filters.find((f) => f.method === "in" && f.args[0] === "state")?.args[1]).toEqual(["new", "seen", "snoozed"]);
  });
});

describe("processTenant: koşulu kalkanı kapatma", () => {
  it("olgu düşünce satır kapanır, canlı kalan kapanmaz", async () => {
    const { mock, admin } = setup();
    const run: InsightRuleRun = { drafts: [], liveEntityIds: new Set(["c-live"]) };
    const r = await processTenant(admin, "t1", NOW, { rules: [rule(async () => run)] });
    expect(r.expired).toBe(1);
    const [upd] = updates(mock);
    expect(upd.filters.find((f) => f.method === "in" && f.args[0] === "id")?.args[1]).toEqual(["i-old"]);
  });

  it("kural hata verirse hiçbir şey kapanmaz", async () => {
    const { mock, admin } = setup();
    const boom = rule(async () => {
      throw new Error("rpc patladi");
    });
    const r = await processTenant(admin, "t1", NOW, { rules: [boom] });
    expect(r.expired).toBe(0);
    expect(updates(mock)).toHaveLength(0);
  });

  it("olgu RPC'si yoksa (InsightFactsUnavailable) kapatma atlanır", async () => {
    const { mock, admin } = setup();
    const missing = rule(async () => {
      throw new InsightFactsUnavailable("insight_quiet_valuable_customers");
    });
    const r = await processTenant(admin, "t1", NOW, { rules: [missing] });
    expect(r.rulesUnavailable).toEqual(["call_priority@1"]);
    expect(updates(mock)).toHaveLength(0);
  });

  it("yalnız dizi döndüren (eski) kural ve liveEntityIds=null: kapatma yok", async () => {
    const { mock, admin } = setup();
    const legacy = rule(async () => [] as InsightDraft[]);
    const nullLive = rule(async () => ({ drafts: [], liveEntityIds: null }));
    await processTenant(admin, "t1", NOW, { rules: [legacy, nullLive] });
    expect(updates(mock)).toHaveLength(0);
  });

  it("zaman bütçesi dolmuşsa kural koşmaz, kapatma da olmaz", async () => {
    const { mock, admin } = setup();
    const r = await processTenant(admin, "t1", NOW, { rules: [rule(async () => ({ drafts: [], liveEntityIds: new Set<string>() }))] }, 0);
    expect(r.expired).toBe(0);
    expect(updates(mock)).toHaveLength(0);
  });
});

describe("üst sınır (capPerUser) öncesi canlı küme", () => {
  it("sınırla elenen müşteri canlı kümede kalır (kapanmaz)", () => {
    const facts = Array.from({ length: 6 }, (_, i) => ({
      customerId: `c${i}`,
      assignedTo: U1,
      fullName: `Müşteri ${i}`,
      activeDemands: 3,
      quietDays: 30,
    }));
    const run = evaluateCallPriorityRun(facts, NOW);
    // Kişi başı üst sınır 3: yalnız 3 taslak üretilir ama 6 müşterinin hepsi hâlâ canlıdır.
    expect(run.drafts.length).toBe(3);
    expect([...(run.liveEntityIds ?? [])].sort()).toEqual(["c0", "c1", "c2", "c3", "c4", "c5"]);
    const dropped = facts.map((f) => f.customerId).filter((id) => !run.drafts.some((d) => d.entityId === id));
    expect(dropped).toHaveLength(3);
    for (const id of dropped) expect(run.liveEntityIds?.has(id)).toBe(true);
  });

  it("uygunluk dışına çıkan (eşik altı) müşteri canlı kümeden düşer", () => {
    const run = evaluateCallPriorityRun(
      [{ customerId: "calm", assignedTo: U1, fullName: "Sakin", activeDemands: 1, quietDays: 2 }],
      NOW,
    );
    expect(run.drafts).toEqual([]);
    expect(run.liveEntityIds?.has("calm")).toBe(false);
  });
});
