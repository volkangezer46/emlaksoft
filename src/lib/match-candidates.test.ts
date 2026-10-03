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
