import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyTenant: vi.fn() }));

import { groupHitsByOwner, propertyMatchHits } from "./match-notify";
import type { MatchDemand, MatchProperty } from "./matching";
import type { MatchStateRow } from "./match-state";

const demand = (id: string, budget: number, owner: string | null = "u1"): MatchDemand & { customer: unknown } => ({
  id,
  transaction_type: "Satılık",
  property_type: "Daire",
  province_id: "prov",
  district_id: null,
  neighborhood_id: null,
  budget_min: null,
  budget_max: budget,
  rooms: "3+1",
  min_sqm: null,
  urgency: null,
  status: "active",
  criteria: { required: ["budget"] },
  customer: { id: `c-${id}`, full_name: `Müşteri ${id}`, assigned_to: owner },
});
const property: MatchProperty = {
  id: "p1",
  property_code: "P1",
  title: "Daire",
  transaction_type: "Satılık",
  property_type: "Daire",
  status: "live",
  list_price: 950_000,
  province_id: "prov",
  district_id: null,
  neighborhood_id: null,
  features: { rooms: "3+1", sqm: 100 },
};
const sent = (demandId: string): MatchStateRow => ({
  demand_id: demandId,
  property_id: "p1",
  state: "sent",
  dismiss_reason: null,
  dismissed_at: null,
  sent_at: "2026-10-01",
  send_count: 1,
  channel: "sms",
  share_token: null,
  updated_at: "2026-10-01",
});

describe("propertyMatchHits (CRM-G5)", () => {
  const demands = [demand("cheap", 1_000_000), demand("rich", 5_000_000), demand("poor", 500_000)];
  it("fiyat düşüşünde yalnız eşiği YENİ geçenler bildirilir (zaten eşleşen tekrar gelmez)", () => {
    const prev = { ...property, list_price: 1_300_000 };
    const hits = propertyMatchHits({ property, prevProperty: prev, demands });
    expect(hits.map((h) => h.demandId)).toEqual(["cheap"]);
  });
  it("daha önce gönderilmiş çift fiyat düşüşünde yine bildirilir", () => {
    const prev = { ...property, list_price: 1_300_000 };
    const hits = propertyMatchHits({ property, prevProperty: prev, demands, states: [sent("rich")] });
    expect(hits.map((h) => h.demandId).sort()).toEqual(["cheap", "rich"]);
  });
  it("uygun değil ve müşteri beğenmedi çiftleri bildirilmez", () => {
    const dismissed = { ...sent("cheap"), state: "dismissed" as const };
    const hits = propertyMatchHits({ property, demands, states: [dismissed], dislikedPairs: new Set(["c-rich:p1"]) });
    expect(hits).toEqual([]);
  });
  it("danışmana göre gruplanır; danışmansız müşteri işlemi yapana düşer", () => {
    const hits = propertyMatchHits({ property, demands: [demand("a", 1_000_000, "u1"), demand("b", 1_000_000, null)] });
    const groups = groupHitsByOwner(hits, "actor");
    expect([...groups.keys()].sort()).toEqual(["actor", "u1"]);
  });
});

describe("tetik sözleşmesi (CRM-G5)", () => {
  it("talep kaydı/güncellemesi ve portföy fiyat düşüşü/yayın yanıt sonrası yeniden eşleştirir", async () => {
    const { readFileSync } = await import("node:fs");
    const demands = readFileSync("src/app/actions/demands.ts", "utf8");
    expect(demands.match(/afterSafe\(\(\) => notifyMatchesForDemand\(/g)?.length).toBeGreaterThanOrEqual(2);
    const props = readFileSync("src/app/actions/properties.ts", "utf8");
    expect(props).toContain('reason: "price_drop"');
    expect(props).toContain("notifyMatchesForPublishedProperty(");
  });
});
