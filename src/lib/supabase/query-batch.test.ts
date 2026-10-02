import { describe, expect, it } from "vitest";
import {
  assertQueryBatchSucceeded,
  failedQueryResults,
} from "@/lib/supabase/query-batch";

describe("Supabase query batch", () => {
  it("accepts successful and intentionally skipped query results", () => {
    const results = [{ data: [] }, { count: 0 }, { data: null }];
    expect(failedQueryResults(results, ["a", "b", "c"])).toEqual([]);
    expect(() => assertQueryBatchSucceeded(results, ["a", "b", "c"], "Panel")).not.toThrow();
  });

  it("turns returned errors into a hard failure instead of false zeroes", () => {
    const secretMessage = "relation customer_private_secret does not exist";
    const results = [
      { data: [{ id: 1 }], error: null },
      { data: null, error: { code: "42P01", message: secretMessage } },
    ];

    expect(failedQueryResults(results, ["customers", "metrics"])).toEqual([
      { index: 1, label: "metrics", code: "42P01" },
    ]);
    expect(() => assertQueryBatchSucceeded(results, ["customers", "metrics"], "Ana panel"))
      .toThrow("Ana panel verileri eksik yüklendi (metrics:42P01).");

    try {
      assertQueryBatchSucceeded(results, ["customers", "metrics"], "Ana panel");
    } catch (error) {
      expect((error as Error).message).not.toContain(secretMessage);
    }
  });

  it("fails closed when labels drift away from the batch", () => {
    expect(() => failedQueryResults([{ data: [] }], [])).toThrow(
      "Sorgu sonucu ve etiket sayısı eşleşmiyor.",
    );
  });
});
