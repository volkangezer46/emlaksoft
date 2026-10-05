import { describe, expect, it } from "vitest";
import { CRON_BUDGET_MS, cronDeadline, fetchAllPaged, heartbeatFor, isPastDeadline, remainingOf } from "@/lib/cron-run";

describe("cron çalıştırma yardımcıları", () => {
  it("zaman bütçesi 240 sn ve deadline karşılaştırması", () => {
    expect(CRON_BUDGET_MS).toBe(240_000);
    const d = cronDeadline(1_000);
    expect(d).toBe(241_000);
    expect(isPastDeadline(240_999, d)).toBe(false);
    expect(isPastDeadline(241_000, d)).toBe(true);
  });

  it("fetchAllPaged sıralı sayfaları birleştirir (500+ ofis kaybolmaz)", async () => {
    const all = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    const ranges: Array<[number, number]> = [];
    const { rows, error } = await fetchAllPaged<{ id: number }>(async (from, to) => {
      ranges.push([from, to]);
      return { data: all.slice(from, to + 1), error: null };
    }, 1000);
    expect(error).toBeNull();
    expect(rows).toHaveLength(2500);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("fetchAllPaged hatada o ana kadarki satırlarla birlikte hatayı döndürür", async () => {
    let call = 0;
    const { rows, error } = await fetchAllPaged<{ id: number }>(async () => {
      call += 1;
      if (call === 2) return { data: null, error: { message: "boom" } };
      return { data: Array.from({ length: 10 }, (_, i) => ({ id: i })), error: null };
    }, 10);
    expect(rows).toHaveLength(10);
    expect(error).toBe("boom");
  });

  it("heartbeat yalnız tam başarıda ok; kalan iş sayısı detayda", () => {
    expect(heartbeatFor({ total: 3, processed: 3, failed: 0, timedOut: false, summary: "3 özet" })).toEqual({
      status: "ok",
      detail: "3 özet",
    });
    const partial = heartbeatFor({ total: 10, processed: 4, failed: 0, timedOut: true, summary: "4 özet" });
    expect(partial.status).toBe("error");
    expect(partial.detail).toContain("6 iş kaldı");
    expect(heartbeatFor({ total: 2, processed: 2, failed: 1, timedOut: false, summary: "x" }).status).toBe("error");
    expect(heartbeatFor({ total: 2, processed: 2, failed: 0, timedOut: false, listError: "db", summary: "x" }).status).toBe("error");
    expect(remainingOf({ total: 2, processed: 5 })).toBe(0);
  });
});
