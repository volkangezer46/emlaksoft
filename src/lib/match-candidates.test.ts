import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMatchCandidateProperties, MATCH_CANDIDATE_LIMIT } from "./match-candidates";

function fakeProps(result: { data: unknown[] | null; error: unknown }) {
  let limitArg = -1;
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "is", "in", "eq", "or", "order"]) chain[m] = () => chain;
  chain.limit = (n: number) => {
    limitArg = n;
    return Promise.resolve(result);
  };
  return { client: { from: () => chain } as unknown as SupabaseClient, limit: () => limitArg };
}

const demand = { transaction_type: "sale", province_id: null, district_id: null, neighborhood_id: null, criteria: {} };
const row = (i: number) => ({ id: `p${i}`, property_code: `C${i}`, title: null, list_price: "100", features: null });

describe("fetchMatchCandidateProperties (B15)", () => {
  it("sorgu hatasını boş liste olarak yutmaz", async () => {
    const f = fakeProps({ data: null, error: { message: "boom" } });
    const r = await fetchMatchCandidateProperties(f.client, { demands: [demand] });
    expect(r.error).toBeTruthy();
    expect(r.properties).toEqual([]);
  });
  it("sınırı aşınca truncated=true ve yalnız LIMIT kadar aday döner", async () => {
    const f = fakeProps({ data: Array.from({ length: MATCH_CANDIDATE_LIMIT + 1 }, (_, i) => row(i)), error: null });
    const r = await fetchMatchCandidateProperties(f.client, { demands: [demand] });
    expect(f.limit()).toBe(MATCH_CANDIDATE_LIMIT + 1);
    expect(r.truncated).toBe(true);
    expect(r.properties).toHaveLength(MATCH_CANDIDATE_LIMIT);
    expect(r.error).toBeNull();
  });
  it("sınır altında truncated=false", async () => {
    const f = fakeProps({ data: [row(1)], error: null });
    const r = await fetchMatchCandidateProperties(f.client, { demands: [demand] });
    expect(r.truncated).toBe(false);
    expect(r.properties[0]!.list_price).toBe(100);
  });
});

describe("match-notify sıralı kırpma (B15)", () => {
  it("talep taraması created_at ile sıralanır ve hata yutulmaz", () => {
    const src = readFileSync("src/lib/match-notify.ts", "utf8");
    expect(src).toContain('.order("created_at", { ascending: false })');
    expect(src).toContain("demandsError");
  });
});

import { MATCH_LIKED_BONUS, MATCH_SHOW_MIN, scoreDemandMatches } from "./match-candidates";
import type { MatchDemand, MatchProperty } from "./matching";
import type { MatchStateRow } from "./match-state";

const md: MatchDemand = {
  id: "d1",
  transaction_type: "Satılık",
  property_type: "Daire",
  province_id: "prov",
  district_id: null,
  neighborhood_id: null,
  budget_min: null,
  budget_max: 1_000_000,
  rooms: "3+1",
  min_sqm: null,
  urgency: null,
  status: "active",
  criteria: {},
};
const mp = (id: string, over: Partial<MatchProperty> = {}): MatchProperty => ({
  id,
  property_code: id,
  title: id,
  transaction_type: "Satılık",
  property_type: "Daire",
  status: "live",
  list_price: 900_000,
  province_id: "prov",
  district_id: null,
  neighborhood_id: null,
  features: { rooms: "3+1", sqm: 100 },
  ...over,
});
const st = (property_id: string, state: MatchStateRow["state"]): MatchStateRow => ({
  demand_id: "d1",
  property_id,
  state,
  dismiss_reason: null,
  dismissed_at: null,
  sent_at: null,
  send_count: 0,
  channel: null,
  share_token: null,
  updated_at: "2026-10-01",
});

describe("scoreDemandMatches — tek kural (CRM-G3/G4)", () => {
  const properties = [mp("a"), mp("b"), mp("c"), mp("rent", { transaction_type: "Kiralık" })];
  it("eşik altı (işlem türü uyumsuz) düşer; beğenmedi ve uygun değil gizlenir ve sayılır", () => {
    const r = scoreDemandMatches({
      demands: [md],
      properties,
      customerOf: () => "c1",
      feedback: [{ customer_id: "c1", property_id: "b", verdict: "disliked" }],
      states: [st("c", "dismissed")],
    });
    expect(r.pairs.map((p) => p.property.id)).toEqual(["a"]);
    expect(r.hiddenByFeedback).toBe(1);
    expect(r.hiddenDismissed).toBe(1);
    expect(r.byDemand.get("d1")?.shown).toBe(1);
    expect(r.pairs.every((p) => p.score >= MATCH_SHOW_MIN)).toBe(true);
  });
  it("includeHidden gizlenenleri işaretli döndürür ama özet saymaz", () => {
    const r = scoreDemandMatches({ demands: [md], properties, customerOf: () => "c1", states: [st("c", "dismissed")], includeHidden: true });
    expect(r.pairs.find((p) => p.property.id === "c")?.hiddenBy).toBe("dismissed");
    expect(r.byDemand.get("d1")?.shown).toBe(2);
  });
  it("beğenilen portföy bonus alır", () => {
    const base = scoreDemandMatches({ demands: [md], properties: [mp("a", { status: "draft" })], customerOf: () => "c1" }).pairs[0]!.score;
    const liked = scoreDemandMatches({
      demands: [md],
      properties: [mp("a", { status: "draft" })],
      customerOf: () => "c1",
      feedback: [{ customer_id: "c1", property_id: "a", verdict: "liked" }],
    }).pairs[0]!;
    expect(liked.score).toBe(Math.min(100, base + MATCH_LIKED_BONUS));
    expect(liked.likedByCustomer).toBe(true);
  });
});

describe("sözleşme: portföyü eşleşme için okuyan tek yer match-candidates (CRM-G3)", () => {
  const surfaces = [
    "src/app/app/talepler/[id]/page.tsx",
    "src/app/app/talepler/matching-view.tsx",
    "src/app/app/talepler/demands-view.tsx",
    "src/app/app/musteriler/[id]/sections.tsx",
    "src/app/app/musteriler/[id]/matched-properties-widget.tsx",
  ];
  it.each(surfaces)("%s kendi aday sorgusunu/eşiğini kurmaz", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/from\("properties"\)/);
    expect(src).not.toMatch(/SALE_VARIANTS|RENT_VARIANTS/);
    expect(src).not.toMatch(/score (>=|<) (35|45|60)\b/);
    expect(src).not.toMatch(/scoreDemandProperty\(/);
  });
  it("yüzeyler tek okuyucuyu kullanır", () => {
    for (const file of surfaces.filter((f) => !f.endsWith("widget.tsx"))) {
      expect(readFileSync(file, "utf8"), file).toContain("loadDemandMatches(");
    }
  });
});
