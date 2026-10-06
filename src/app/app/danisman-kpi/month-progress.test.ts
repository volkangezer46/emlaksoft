import { describe, expect, it } from "vitest";
import { monthElapsedPct, paceGauge, paceVerdict } from "./month-progress";

describe("month-progress", () => {
  it("ay ilerlemesi orantılı ve 0-100'e kırpılır", () => {
    expect(monthElapsedPct(50, 0, 100)).toBe(50);
    expect(monthElapsedPct(-10, 0, 100)).toBe(0);
    expect(monthElapsedPct(500, 0, 100)).toBe(100);
  });
  it("geçersiz aralıkta null", () => {
    expect(monthElapsedPct(5, 10, 10)).toBeNull();
    expect(monthElapsedPct(NaN, 0, 10)).toBeNull();
  });
  it("paceGauge geçen ay 0 iken null", () => {
    expect(paceGauge(10, 0)).toBeNull();
    expect(paceGauge(NaN, 5)).toBeNull();
  });
  it("paceGauge taşmada max = bu ay, hedef = geçen ay", () => {
    expect(paceGauge(150, 100)).toEqual({ value: 150, max: 150, target: 100, ratioPct: 150 });
    expect(paceGauge(40, 100)).toEqual({ value: 40, max: 100, target: 100, ratioPct: 40 });
  });
  it("tempo yorumu", () => {
    expect(paceVerdict(60, 100, 50)).toBe("ahead");
    expect(paceVerdict(46, 100, 50)).toBe("on-track");
    expect(paceVerdict(20, 100, 50)).toBe("behind");
    expect(paceVerdict(20, 0, 50)).toBeNull();
    expect(paceVerdict(20, 100, null)).toBeNull();
  });
});
