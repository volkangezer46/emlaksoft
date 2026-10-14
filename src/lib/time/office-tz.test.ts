import { describe, expect, it } from "vitest";
import { formatOfficeTime, nextHalfHourOffice, officeDayWindow, OFFICE_TIME_ZONE } from "./office-tz";

describe("office-tz", () => {
  it("ofis saat dilimi Europe/Istanbul", () => {
    expect(OFFICE_TIME_ZONE).toBe("Europe/Istanbul");
  });

  it("UTC 07:00 anını ofis saatiyle 10:00 gösterir (sunucu UTC'de olsa da)", () => {
    expect(formatOfficeTime("2026-10-14T07:00:00.000Z")).toBe("10:00");
    expect(formatOfficeTime(new Date("2026-10-14T21:30:00.000Z"))).toBe("00:30");
    expect(formatOfficeTime("geçersiz")).toBe("");
  });

  it("gün penceresi ofis gece yarısına hizalı (±1 gün)", () => {
    // 14 Ekim 01:00 TR = 13 Ekim 22:00 UTC; ofis günü 13 Ekim 21:00 UTC'de başlar.
    const { start, end } = officeDayWindow("2026-10-13T22:00:00.000Z", 1);
    expect(start.toISOString()).toBe("2026-10-12T21:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-15T21:00:00.000Z");
  });

  it("şimdiden sonraki ilk yarım saat (ofis saati), gece yarısında ertesi gün", () => {
    expect(nextHalfHourOffice(Date.parse("2026-10-14T07:07:00.000Z"))).toEqual({ date: "2026-10-14", time: "10:30" });
    expect(nextHalfHourOffice(Date.parse("2026-10-14T07:30:00.000Z"))).toEqual({ date: "2026-10-14", time: "11:00" });
    expect(nextHalfHourOffice(Date.parse("2026-10-14T20:45:00.000Z"))).toEqual({ date: "2026-10-15", time: "00:00" });
  });

  it("varsayılan saat hiçbir zaman geçmişte değil", () => {
    const nowMs = Date.parse("2026-10-14T09:59:59.000Z");
    const { date, time } = nextHalfHourOffice(nowMs);
    expect(Date.parse(`${date}T${time}:00+03:00`)).toBeGreaterThan(nowMs);
  });
});
