import { describe, expect, it } from "vitest";
import { isSameSlot, movedStart, nudgedStart, resizedDuration, snapMinutes, trDateTimeFields } from "./week-drag";

const grid = { hourPx: 48, hourStart: 7, hourEnd: 21 };
// 14:00 TR
const START = "2026-10-15T11:00:00.000Z";

describe("takvim sürükle-bırak hesabı (GA-02)", () => {
  it("15 dk'ya yaslar", () => {
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(-22)).toBe(-15);
  });

  it("dikey: 1 saat aşağı (48 px) → 15:00; yatay: +2 gün", () => {
    expect(trDateTimeFields(movedStart(START, 48, 0, grid, 60))).toEqual({ date: "2026-10-15", time: "15:00" });
    expect(trDateTimeFields(movedStart(START, 10, 2, grid, 60))).toEqual({ date: "2026-10-17", time: "14:15" });
  });

  it("ızgara sınırına kırpılır", () => {
    expect(trDateTimeFields(movedStart(START, -48 * 20, 0, grid, 60)).time).toBe("07:00");
    expect(trDateTimeFields(movedStart(START, 48 * 20, 0, grid, 60)).time).toBe("20:45");
  });

  it("alt kenar süresi: en az 15, en çok 12 saat", () => {
    expect(resizedDuration(60, 24, grid)).toBe(90);
    expect(resizedDuration(30, -200, grid)).toBe(15);
    expect(resizedDuration(null, 48 * 30, grid)).toBe(720);
  });

  it("klavye kaydırması ve aynı yer denetimi", () => {
    expect(trDateTimeFields(nudgedStart(START, 1, grid, 60)).time).toBe("14:15");
    expect(trDateTimeFields(nudgedStart(START, -1, grid, 60)).time).toBe("13:45");
    expect(isSameSlot({ start: START, duration: null }, { start: "2026-10-15T14:00:00+03:00", duration: 60 })).toBe(true);
  });
});
