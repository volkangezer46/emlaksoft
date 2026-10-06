import { describe, expect, it } from "vitest";
import { classifyCron, countByStatus, geoCoverage, schemaGauge } from "./cron-strip-model";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("cron strip model", () => {
  it("kayıt yoksa ya da tarih bozuksa hiç çalışmadı", () => {
    expect(classifyCron(undefined, 90, NOW)).toBe("never");
    expect(classifyCron({ last_run_at: null, last_status: "ok" }, 90, NOW)).toBe("never");
    expect(classifyCron({ last_run_at: "bozuk", last_status: "ok" }, 90, NOW)).toBe("never");
  });
  it("pencere aşıldıysa bayat (hata olsa bile)", () => {
    expect(classifyCron({ last_run_at: ago(120), last_status: "error" }, 90, NOW)).toBe("stale");
  });
  it("pencere içinde hata ve sağlıklı", () => {
    expect(classifyCron({ last_run_at: ago(10), last_status: "error" }, 90, NOW)).toBe("error");
    expect(classifyCron({ last_run_at: ago(10), last_status: "ok" }, 90, NOW)).toBe("ok");
    expect(classifyCron({ last_run_at: ago(90), last_status: "ok" }, 90, NOW)).toBe("ok");
  });
  it("sayım", () => {
    expect(countByStatus(["ok", "ok", "error", "never"])).toEqual({ ok: 2, error: 1, stale: 0, never: 1 });
  });
  it("şema gauge: kontrol yoksa null", () => {
    expect(schemaGauge([])).toBeNull();
    expect(schemaGauge([{ ok: true }, { ok: false }])).toEqual({ ok: 1, total: 2 });
  });
  it("geo kapsamı kırpılır", () => {
    expect(geoCoverage(81, 81)).toBe(100);
    expect(geoCoverage(null, 81)).toBe(0);
    expect(geoCoverage(100, 81)).toBe(100);
    expect(geoCoverage(10, 0)).toBe(0);
  });
});
