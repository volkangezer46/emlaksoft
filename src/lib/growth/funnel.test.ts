import { describe, expect, it } from "vitest";
import { inviteFunnel, stageRates } from "./funnel";

describe("inviteFunnel", () => {
  it("aşamalar: deneme iptali hariç tutar, ödedi = bekleme + ödül", () => {
    const f = inviteFunnel({ clicks: 100, signups: 20, trial: 8, waiting: 3, paid: 5, cancelled: 4 });
    expect(f.stages.map((s) => s.value)).toEqual([100, 20, 16, 8, 5]);
    expect(f.ardisik).toBe(true);
    expect(f.cancelled).toBe(4);
  });

  it("tıklamadan fazla kayıt (doğrudan kayıt) = ardışık değil", () => {
    const f = inviteFunnel({ clicks: 2, signups: 5, trial: 5, waiting: 0, paid: 0, cancelled: 0 });
    expect(f.ardisik).toBe(false);
  });

  it("negatif/NaN sıfıra düşer", () => {
    const f = inviteFunnel({ clicks: Number.NaN, signups: -3, trial: 0, waiting: 0, paid: 0, cancelled: 0 });
    expect(f.stages.every((s) => s.value === 0)).toBe(true);
  });

  it("stageRates: önceki 0 ise null", () => {
    const f = inviteFunnel({ clicks: 10, signups: 5, trial: 2, waiting: 1, paid: 0, cancelled: 0 });
    expect(stageRates(f.stages)).toEqual([null, 50, 60, 33, 0]);
    expect(stageRates([{ key: "click", value: 0 }, { key: "signup", value: 0 }])).toEqual([null, null]);
  });
});
