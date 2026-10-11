import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = { rule: 0, candidates: 0, chain: 0, propertyQueries: 0, breach: [] as { entryId?: string }[] };
const state = {
  entries: [] as Record<string, unknown>[],
  entriesError: false,
  eventInsertError: false,
  past: [] as { entry_id: string; event: string }[],
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/clock", () => ({ now: () => Date.parse("2026-10-12T10:00:00Z") }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("./notify", () => ({
  notifyPoolAssigned: async () => 0,
  notifyPoolBreach: async (_d: unknown, i: { entryId?: string }) => {
    calls.breach.push(i);
    return 0;
  },
}));
vi.mock("./server", () => ({
  loadPoolRule: async () => {
    calls.rule += 1;
    return { id: "r1", name: "Kural", mode: "semi_auto", minScore: null, slaMinutes: 30, escalate: true };
  },
  loadPoolCandidates: async () => {
    calls.candidates += 1;
    return { candidates: [], officeAvgOpen: 0 };
  },
  loadFallbackChain: async () => {
    calls.chain += 1;
    return [];
  },
  computeSuggestions: async () => [],
  toPoolProperty: (r: Record<string, unknown>) => r,
}));

function adminClient() {
  return {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      const self = () => q;
      Object.assign(q, {
        select: self,
        eq: self,
        order: self,
        in: async () => {
          if (table === "properties") {
            calls.propertyQueries += 1;
            return {
              data: state.entries.map((e) => ({ id: e.property_id, tenant_id: e.tenant_id, title: `İlan ${String(e.property_id)}`, property_code: "P" })),
              error: null,
            };
          }
          return { data: state.past, error: null };
        },
        limit: async () => ({ data: state.entriesError ? null : state.entries, error: state.entriesError ? { message: "boom" } : null }),
        update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
        insert: async () => ({ error: state.eventInsertError ? { message: "x" } : null }),
      });
      // events: select().in().in() zinciri
      if (table === "listing_pool_events") {
        q.select = () => ({ in: () => ({ in: async () => ({ data: state.past, error: null }) }) });
      }
      return q;
    },
  };
}

const entry = (i: number, over: Record<string, unknown> = {}) => ({
  id: `e${i}`,
  tenant_id: "t1",
  property_id: `p${i}`,
  source: "manual",
  rule_id: "r1",
  created_at: "2026-10-12T08:00:00Z",
  sla_due_at: "2026-10-12T09:00:00Z",
  claim_open_until: null,
  ...over,
});

import { runPoolSweep } from "./system-assign";

beforeEach(() => {
  Object.assign(calls, { rule: 0, candidates: 0, chain: 0, propertyQueries: 0, breach: [] });
  Object.assign(state, { entries: [], entriesError: false, eventInsertError: false, past: [] });
});

describe("runPoolSweep toplu sorgu + sayaç", () => {
  it("20 kayıt: ilanlar tek toplu sorgu, kural ofis başına bir kez; SLA uyarısı entryId (dedupe) taşır", async () => {
    state.entries = Array.from({ length: 20 }, (_, i) => entry(i));
    const s = await runPoolSweep(adminClient() as never);
    expect(s.examined).toBe(20);
    expect(calls.propertyQueries).toBe(1);
    expect(calls.rule).toBe(1);
    expect(s.slaBreached).toBe(20);
    expect(s.failed).toBe(0);
    expect(s.truncated).toBe(false);
    expect(calls.breach[0]?.entryId).toBe("e0");
  });

  it("kayıt sorgusu hata verirse failed sayılır (sessiz 0 değil)", async () => {
    state.entriesError = true;
    const s = await runPoolSweep(adminClient() as never);
    expect(s.failed).toBe(1);
  });

  it("olay yazımı başarısızsa failed artar ve uyarı gitmez", async () => {
    state.entries = [entry(1)];
    state.eventInsertError = true;
    const s = await runPoolSweep(adminClient() as never);
    expect(s.failed).toBe(1);
    expect(s.slaBreached).toBe(0);
    expect(calls.breach).toHaveLength(0);
  });

  it("500 kayıt tavana dayanırsa truncated", async () => {
    state.entries = Array.from({ length: 500 }, (_, i) => entry(i, { sla_due_at: null }));
    const s = await runPoolSweep(adminClient() as never);
    expect(s.truncated).toBe(true);
    expect(calls.propertyQueries).toBe(5);
  });
});
