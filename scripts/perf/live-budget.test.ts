import { describe, expect, it } from "vitest";
import { LIVE_BUDGETS, evaluateBudgets, median, percentile, quietServerReason, watchdogDecision } from "./live-budget";

describe("canlı bütçe yardımcıları (SK1/B181)", () => {
  it("percentile en yakın sıra; gelmeyen olay (Infinity) en sona düşer", () => {
    expect(percentile([], 95)).toBeNull();
    expect(median([30, 10, 20])).toBe(20);
    const twenty = Array.from({ length: 20 }, (_, i) => (i + 1) * 10);
    expect(percentile(twenty, 95)).toBe(190);
    expect(percentile([...twenty.slice(0, 19), Number.POSITIVE_INFINITY], 95)).toBe(190);
    expect(percentile([...twenty.slice(0, 18), Infinity, Infinity], 95)).toBe(Infinity);
  });

  it("sakin sunucu: load1 <4 ve kapı koşmuyor; load okunamıyorsa yalnız kapı belirler", () => {
    expect(quietServerReason({ load1: 1.2, gateRunning: false })).toBeNull();
    expect(quietServerReason({ load1: 4, gateRunning: false })).toMatch(/load1/);
    expect(quietServerReason({ load1: 0.5, gateRunning: true })).toMatch(/kapı/);
    expect(quietServerReason({ load1: null, gateRunning: false })).toBeNull();
  });

  it("TTFB p50 bütçesi: /app ≤60, /admin ≤70; yetersiz örnek aşım sayılmaz", () => {
    const ok = evaluateBudgets([
      { kind: "ttfb", path: "/app", values: Array(20).fill(55) },
      { kind: "ttfb", path: "/admin", values: Array(20).fill(70) },
    ]);
    expect(ok.ok).toBe(true);
    const over = evaluateBudgets([{ kind: "ttfb", path: "/app", values: Array(20).fill(61) }]);
    expect(over.ok).toBe(false);
    expect(over.violations[0]).toMatch(/\/app: p50 61 ms > 60 ms/);
    const few = evaluateBudgets([{ kind: "ttfb", path: "/app", values: [500, 500] }]);
    expect(few.ok).toBe(true);
    expect(few.lines[0]).toMatch(/yetersiz örnek/);
    expect(evaluateBudgets([{ kind: "ttfb", path: "/app/lig", values: Array(5).fill(900) }]).ok).toBe(true);
  });

  it("realtime p95 <1000 ms (20 örnek); gelmeyen olaylar aşım", () => {
    expect(evaluateBudgets([{ kind: "realtime", values: Array(20).fill(400) }]).ok).toBe(true);
    const lost = evaluateBudgets([{ kind: "realtime", values: [...Array(18).fill(300), Infinity, Infinity] }]);
    expect(lost.ok).toBe(false);
    expect(lost.lines[0]).toMatch(/olay gelmedi/);
    expect(evaluateBudgets([{ kind: "realtime", values: Array(20).fill(1000) }]).ok).toBe(false);
    expect(evaluateBudgets([{ kind: "realtime", values: Array(5).fill(5000) }]).ok).toBe(true);
  });

  it("DCL p50 bütçesi", () => {
    expect(evaluateBudgets([{ kind: "dcl", path: "/app", values: Array(5).fill(900) }]).ok).toBe(true);
    expect(evaluateBudgets([{ kind: "dcl", path: "/app", values: Array(5).fill(LIVE_BUDGETS.dclP50Ms + 1) }]).ok).toBe(false);
  });

  it("bekçi: 3 ardışık yeşile kadar kırmızı yalnız uyarı; sonra geri dönüş; yeşil seriyi artırır", () => {
    expect(watchdogDecision(0, true)).toEqual({ nextStreak: 1, action: "ok" });
    expect(watchdogDecision(2, false)).toEqual({ nextStreak: 0, action: "warn" });
    expect(watchdogDecision(3, false)).toEqual({ nextStreak: 0, action: "rollback" });
    expect(LIVE_BUDGETS.consecutiveGreensBeforeRollback).toBe(3);
  });
});
