import { describe, expect, it } from "vitest";
import {
  AUTOMATION_PAGE_SIZE,
  chunkArray,
  firedIdsFromLogs,
  isLastPage,
  nextCursor,
  pageInfoOf,
  splitFired,
} from "@/lib/automation-paging";

describe("automation sayfalama", () => {
  it("tam sayfa imleç üretir, kısa sayfa üretmez", () => {
    const full = Array.from({ length: AUTOMATION_PAGE_SIZE }, (_, i) => ({ id: `id-${String(i).padStart(4, "0")}` }));
    expect(nextCursor(pageInfoOf(full))).toBe(`id-${String(AUTOMATION_PAGE_SIZE - 1).padStart(4, "0")}`);
    expect(nextCursor(pageInfoOf(full.slice(0, 10)))).toBeNull();
    expect(isLastPage(0)).toBe(true);
    expect(nextCursor(pageInfoOf([]))).toBeNull();
  });

  it("201+ aday: ilk sayfa tamamen loglanmış olsa da ikinci sayfa işlenir", () => {
    // 450 aday id'ye göre sıralı; ilk 200'ü zaten loglanmış.
    const all = Array.from({ length: 450 }, (_, i) => ({ id: `c${String(i).padStart(4, "0")}` }));
    const fired = new Set(all.slice(0, 200).map((r) => r.id));
    const fresh: string[] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const rows = all.filter((r) => after === null || r.id > after).slice(0, AUTOMATION_PAGE_SIZE);
      const split = splitFired(rows.map((r) => ({ entityId: r.id })), fired);
      fresh.push(...split.fresh.map((f) => f.entityId));
      after = nextCursor(pageInfoOf(rows));
      if (after === null) break;
    }
    expect(fresh).toHaveLength(250);
    expect(fresh[0]).toBe("c0200");
  });

  it("splitFired büyük/küçük harf duyarsız eşler ve atlananı sayar", () => {
    const { fresh, skipped } = splitFired(
      [{ entityId: "AAA" }, { entityId: "bbb" }, { entityId: "ccc" }],
      new Set(["aaa", "ccc"]),
    );
    expect(fresh.map((f) => f.entityId)).toEqual(["bbb"]);
    expect(skipped).toBe(2);
  });

  it("firedIdsFromLogs 'error' sonuçları dedupe'a katmaz", () => {
    const set = firedIdsFromLogs([
      { entity_id: "A", result: "ok" },
      { entity_id: "B", result: "error" },
      { entity_id: "C", result: "skip" },
      { entity_id: null, result: "ok" },
    ]);
    expect([...set].sort()).toEqual(["a", "c"]);
  });

  it("chunkArray parçalar", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkArray([], 2)).toEqual([]);
  });
});
