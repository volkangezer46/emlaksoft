import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/sample-scope", async () => ({
  ...(await vi.importActual<typeof import("@/lib/sample-scope")>("@/lib/sample-scope")),
  getSampleScope: async () => ({ include: false, counts: { realCustomers: 99, realProperties: 99 } }),
}));

import { loadLeagueData, periodOf } from "@/lib/gamification-query";
import { loadCoachPlan } from "./coach-load";

/** Süzgeçleri yok sayan, tablo başına sabit veri döndüren sahte istemci (her zincir yöntemi zincirin kendisi). */
function fakeClient(fixtures: Record<string, unknown[]>, log: string[]): SupabaseClient {
  return {
    from(table: string) {
      log.push(table);
      const result = { data: fixtures[table] ?? [], error: null, count: 0 };
      const chain: unknown = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === "then") return (res: (v: unknown) => unknown) => res(result);
            if (prop === "maybeSingle" || prop === "single") return async () => ({ data: null, error: null });
            return () => chain;
          },
        },
      );
      return chain;
    },
  } as unknown as SupabaseClient;
}

const NOW = Date.parse("2026-10-14T09:00:00.000Z"); // Çarşamba
const WEEK = periodOf(new Date(NOW), "week");
const profile = (id: string, name: string) => ({ id, full_name: name, role: "advisor", branch_id: null, avatar_url: null, avatar_preset: null });
const FIX = {
  profiles: [profile("a", "Ayşe"), profile("b", "Burak"), profile("c", "Can")],
  deals: [
    { id: "d1", assigned_to: "b", updated_at: "2026-10-13T10:00:00Z", is_sample: false },
    { id: "d2", assigned_to: "b", updated_at: "2026-10-13T11:00:00Z", is_sample: false },
    { id: "d3", assigned_to: "a", updated_at: "2026-10-13T12:00:00Z", is_sample: false },
  ],
  tasks: [{ id: "t1", assigned_to: "c", completed_at: "2026-10-13T12:00:00Z", is_sample: false }],
};

describe("lig koçu sırası = lig sayfası sırası (davranış)", () => {
  it("rankingOnly sıralaması tam sürümle BİREBİR aynı; ömür boyu/seri sorguları atlanır", async () => {
    const fullLog: string[] = [];
    const rankLog: string[] = [];
    const base = { period: WEEK, tenantId: "t1", todayIso: "2026-10-14", nowMs: NOW };
    const full = await loadLeagueData(fakeClient(FIX, fullLog), base);
    const only = await loadLeagueData(fakeClient(FIX, rankLog), { ...base, rankingOnly: true });
    expect(full.ranked.length).toBe(3);
    expect(full.ranked[0]!.staffId).toBe("b");
    expect(only.ranked).toEqual(full.ranked);
    expect(only.agents).toEqual(full.agents);
    expect(only.activity).toEqual(full.activity);
    // Tam sürüm ömür boyu + seri için ek tablo okumaları yapar; rankingOnly yapmaz.
    expect(rankLog.length).toBeLessThan(fullLog.length);
    expect(fullLog.length - rankLog.length).toBe(7);
  });

  it("koç planı: önbellek yok — aynı veri aynı sıra; bir sonraki çağrı yeni veriyi görür (120 sn sapma yok)", async () => {
    const log1: string[] = [];
    const plan1 = await loadCoachPlan(fakeClient(FIX, log1), { tenantId: "t1", userId: "a", nowMs: NOW });
    // 'a' bir anlaşmayla 2. sırada: lider değil, boşluk > 0
    expect(plan1?.isLeader).toBe(false);
    expect(plan1?.gapPoints).toBeGreaterThan(0);

    // Veri değişir (a iki anlaşma daha kazanır): önbellek olsaydı eski sıra dönerdi; canlı okumada a lider olur.
    const changed = {
      ...FIX,
      deals: [
        ...FIX.deals,
        { id: "d4", assigned_to: "a", updated_at: "2026-10-13T13:00:00Z", is_sample: false },
        { id: "d5", assigned_to: "a", updated_at: "2026-10-13T14:00:00Z", is_sample: false },
      ],
    };
    const log2: string[] = [];
    const plan2 = await loadCoachPlan(fakeClient(changed, log2), { tenantId: "t1", userId: "a", nowMs: NOW });
    expect(plan2?.isLeader).toBe(true);
    // Koç yalnız sıralama okur (lig sayfasının ömür boyu/seri taramaları yok)
    expect(log2.filter((t) => t === "network_listings")).toHaveLength(0);
  });
});
