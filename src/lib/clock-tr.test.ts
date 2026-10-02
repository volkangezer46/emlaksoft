import { describe, expect, it } from "vitest";
import {
  calendarDateToTrIso,
  formatTrTime,
  trDayKey,
  trDayStartIso,
  trParts,
  trTodayCalendarDate,
} from "./clock";

describe("Türkiye saati yardımcıları", () => {
  it("UTC 21:30 → TR ertesi gün 00:30", () => {
    const t = "2026-10-02T21:30:00Z";
    expect(trDayKey(t)).toBe("2026-10-03");
    expect(trParts(t)).toMatchObject({ year: 2026, month: 9, day: 3, hour: 0, minute: 30 });
    expect(formatTrTime(t)).toBe("00:30");
  });

  it("UTC 20:59 hâlâ aynı TR günü", () => {
    expect(trDayKey("2026-10-02T20:59:00Z")).toBe("2026-10-02");
  });

  it("TR gün başı UTC 21:00 önceki gün", () => {
    expect(trDayStartIso("2026-10-02T21:30:00Z")).toBe("2026-10-02T21:00:00.000Z");
    expect(trDayStartIso("2026-10-02T12:00:00Z")).toBe("2026-10-01T21:00:00.000Z");
  });

  it("takvim günü ↔ TR gün başı ISO gidiş dönüş", () => {
    const d = trTodayCalendarDate("2026-10-02T21:30:00Z");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 3]);
    expect(calendarDateToTrIso(d)).toBe("2026-10-02T21:00:00.000Z");
  });
});
