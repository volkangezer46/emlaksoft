import { describe, expect, it } from "vitest";
import {
  calendarDateToTrIso,
  formatTrTime,
  parseTrLocalDateTime,
  toTrLocalInput,
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

describe("datetime-local ↔ Türkiye saati", () => {
  it("saat dilimsiz değeri Türkiye saati (+03:00) olarak yorumlar", () => {
    expect(parseTrLocalDateTime("2026-10-03T14:00")?.toISOString()).toBe("2026-10-03T11:00:00.000Z");
    expect(parseTrLocalDateTime("2026-10-03T14:00:30")?.toISOString()).toBe("2026-10-03T11:00:30.000Z");
    // gece yarısı sınırı: TR 00:30 = önceki gün 21:30 UTC
    expect(parseTrLocalDateTime("2026-10-04T00:30")?.toISOString()).toBe("2026-10-03T21:30:00.000Z");
  });

  it("saat dilimi taşıyan girdiyi değiştirmez; geçersiz ve boş girdi null döner", () => {
    expect(parseTrLocalDateTime("2026-10-03T14:00:00Z")?.toISOString()).toBe("2026-10-03T14:00:00.000Z");
    expect(parseTrLocalDateTime("2026-10-03T14:00:00+02:00")?.toISOString()).toBe("2026-10-03T12:00:00.000Z");
    expect(parseTrLocalDateTime("")).toBeNull();
    expect(parseTrLocalDateTime("yarın")).toBeNull();
  });

  it("toTrLocalInput ile gidiş-dönüş tutarlıdır", () => {
    const iso = parseTrLocalDateTime("2026-10-03T14:00")!.toISOString();
    expect(toTrLocalInput(iso)).toBe("2026-10-03T14:00");
    expect(toTrLocalInput("2026-10-03T21:30:00.000Z")).toBe("2026-10-04T00:30");
    expect(toTrLocalInput("geçersiz")).toBe("");
  });
});
