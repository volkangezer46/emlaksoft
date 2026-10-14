import { beforeEach, describe, expect, it } from "vitest";
import { resetRpcProbes } from "@/lib/supabase/rpc-probe";
import {
  loadDemandCounts,
  loadOfferCounts,
  loadTargetActivityCounts,
  parseDemandCounts,
  parseOfferCounts,
  parseTargetActivityCounts,
  type TargetActivityItem,
} from "./list-count-rpcs";
import { parseGeoLevelCounts, refreshGeoStats } from "@/lib/geo/stats";

type Call = { fn: string; args: Record<string, unknown> };
function client(reply: (fn: string) => { data: unknown; error: { code?: string; message?: string } | null }) {
  const calls: Call[] = [];
  return {
    calls,
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args });
      return reply(fn);
    },
  };
}
const missing = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };

beforeEach(() => resetRpcProbes());

describe("YD7 sayaç RPC ayrıştırıcıları: bozuk yanıt sahte sıfır değil null", () => {
  it("offer_counts", () => {
    expect(parseOfferCounts({ total: 3, by_status: { draft: 1, submitted: "2" } })).toEqual({ total: 3, byStatus: { draft: 1, submitted: 2 } });
    expect(parseOfferCounts({ total: 0, by_status: {} })).toEqual({ total: 0, byStatus: {} });
    expect(parseOfferCounts({ total: 3 })).toBeNull();
    expect(parseOfferCounts({ total: 3, by_status: { draft: "x" } })).toBeNull();
    expect(parseOfferCounts(null)).toBeNull();
  });

  it("demand_counts: 7 anahtarın hepsi sayı olmalı", () => {
    const ok = { new: 1, active: 2, matched: 0, closed: 4, urgent: 1, high: 0, aging: 2 };
    expect(parseDemandCounts(ok)).toEqual(ok);
    expect(parseDemandCounts({ ...ok, aging: null })).toBeNull();
  });

  it("target_activity_counts: istenen alan eksikse null; istenmeyen alan null kalır", () => {
    const items: TargetActivityItem[] = [
      { id: "a", startIso: "x", endIso: "y", profileId: null, appointments: true, listings: false },
      { id: "b", startIso: "x", endIso: "y", profileId: "u", appointments: false, listings: true },
    ];
    expect(parseTargetActivityCounts({ a: { appointments: 2, listings: null }, b: { appointments: null, listings: 1 } }, items)).toEqual(
      new Map([["a", { appointments: 2, listings: null }], ["b", { appointments: null, listings: 1 }]]),
    );
    expect(parseTargetActivityCounts({ a: { appointments: 2 } }, items)).toBeNull();
    expect(parseTargetActivityCounts({ a: { appointments: null }, b: { listings: 1 } }, items)).toBeNull();
  });

  it("geo_level_counts satırları seviye × aktiflik tablosuna", () => {
    expect(parseGeoLevelCounts([
      { level: "province", active: true, n: 81 },
      { level: "district", active: true, n: "973" },
      { level: "district", active: false, n: 2 },
      { level: "neighborhood", active: true, n: 31900 },
    ])).toEqual({ province: { active: 81, inactive: 0 }, district: { active: 973, inactive: 2 }, neighborhood: { active: 31900, inactive: 0 } });
    expect(parseGeoLevelCounts([{ level: "mahalle", active: true, n: 1 }])).toBeNull();
    expect(parseGeoLevelCounts(null)).toBeNull();
  });
});

describe("YD7 sayaç RPC çağrıları: fonksiyon yokken eski yola düşer ve 60 sn yeniden denemez", () => {
  it("offer_counts danışman süzgecini geçirir; yoksa null ve yoklama hatırlanır", async () => {
    const ok = client(() => ({ data: { total: 1, by_status: { draft: 1 } }, error: null }));
    expect(await loadOfferCounts(ok, "u1")).toEqual({ total: 1, byStatus: { draft: 1 } });
    expect(ok.calls).toEqual([{ fn: "offer_counts", args: { p_created_by: "u1" } }]);
    const gone = client(() => missing);
    expect(await loadOfferCounts(gone, null)).toBeNull();
    expect(await loadOfferCounts(gone, null)).toBeNull();
    expect(gone.calls).toHaveLength(1);
  });

  it("demand_counts kapsamı sahip listesine çevirir (self/members/none)", async () => {
    const c = client(() => ({ data: { new: 0, active: 0, matched: 0, closed: 0, urgent: 0, high: 0, aging: 0 }, error: null }));
    await loadDemandCounts(c, { scope: { kind: "self", userId: "u1" }, advisorId: null, openStatuses: ["new"], agingBeforeIso: "t" });
    await loadDemandCounts(c, { scope: { kind: "members", ids: ["u1", "u2"] }, advisorId: "u2", openStatuses: ["new"], agingBeforeIso: "t" });
    await loadDemandCounts(c, { scope: { kind: "none" }, advisorId: null, openStatuses: ["new"], agingBeforeIso: "t" });
    expect(c.calls.map((x) => [x.args.p_owner_ids, x.args.p_advisor])).toEqual([[["u1"], null], [["u1", "u2"], "u2"], [null, null]]);
  });

  it("target_activity_counts: boş listede RPC yok; geçici hata yoklamayı bozmaz", async () => {
    const c = client(() => ({ data: null, error: { code: "57014", message: "timeout" } }));
    expect(await loadTargetActivityCounts(c, "t", [])).toEqual(new Map());
    expect(c.calls).toHaveLength(0);
    const item: TargetActivityItem = { id: "a", startIso: "s", endIso: "e", profileId: null, appointments: true, listings: false };
    expect(await loadTargetActivityCounts(c, "t", [item])).toBeNull();
    expect(await loadTargetActivityCounts(c, "t", [item])).toBeNull();
    expect(c.calls).toHaveLength(2); // geçici hata kalıcı "yok" sayılmaz
    expect(c.calls[0]!.args).toEqual({
      p_tenant_id: "t",
      p_items: [{ id: "a", start_at: "s", end_at: "e", profile_id: null, want_appointments: true, want_listings: false }],
    });
  });

  it("refresh_geo_stats: fonksiyon yoksa skipped, başka hata fırlatır (cron adımı hata yazar)", async () => {
    const asClient = (c: ReturnType<typeof client>) => c as unknown as Parameters<typeof refreshGeoStats>[0];
    expect(await refreshGeoStats(asClient(client(() => missing)))).toEqual({ skipped: true });
    await expect(refreshGeoStats(asClient(client(() => ({ data: null, error: { code: "55000", message: "x" } }))))).rejects.toThrow(/refresh_geo_stats failed: 55000/);
    expect(await refreshGeoStats(asClient(client(() => ({ data: { provinces: 81, districts: 973 }, error: null }))))).toEqual({ refreshed: true, provinces: 81, districts: 973 });
  });
});
