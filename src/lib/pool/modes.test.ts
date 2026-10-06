import { describe, expect, it } from "vitest";
import { bulkPoolDecision, decidePoolAction } from "./modes";
import type { PoolSuggestion } from "./score";

const s = (profileId: string, score: number, excluded = false) =>
  ({ profileId, score, excluded }) as unknown as PoolSuggestion;

describe("bulkPoolDecision (içe aktarma)", () => {
  it("otomatik atama toplu girişte yönetici onayına çevrilir", () => {
    const d = decidePoolAction({ mode: "auto", suggestions: [s("a", 90)], minScore: 60, slaMinutes: null, nowMs: 0 });
    expect(d.kind).toBe("auto_assign");
    expect(bulkPoolDecision(d)).toEqual({ kind: "await_owner", reason: "semi_auto" });
  });

  it("sahiplenme ve bekleme kararları değişmez", () => {
    const claim = decidePoolAction({ mode: "claim", suggestions: [s("a", 50)], minScore: null, slaMinutes: 10, nowMs: 1000 });
    expect(bulkPoolDecision(claim)).toEqual(claim);
    const none = decidePoolAction({ mode: "auto", suggestions: [s("a", 90, true)], minScore: 60, slaMinutes: null, nowMs: 0 });
    expect(bulkPoolDecision(none)).toEqual({ kind: "await_owner", reason: "no_candidates" });
  });
});
