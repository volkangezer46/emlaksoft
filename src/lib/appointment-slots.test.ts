import { describe, expect, it } from "vitest";
import { busyFromAppointments, freeAppointmentSlots, officeSlotMs } from "./appointment-slots";

const DAY = "2026-10-20";
const at = (t: string) => officeSlotMs(DAY, t)!;
const EARLY = Date.parse("2026-10-19T12:00:00+03:00");

describe("freeAppointmentSlots", () => {
  it("boş günde alışılmış çapaları önerir", () => {
    expect(freeAppointmentSlots({ date: DAY, busy: [], nowMs: EARLY })).toEqual(["10:00", "14:00", "17:00"]);
  });

  it("dolu çapanın yerine en erken boş yarım saat gelir", () => {
    const busy = busyFromAppointments([{ scheduled_at: new Date(at("14:00")).toISOString(), duration_min: 60 }]);
    const slots = freeAppointmentSlots({ date: DAY, busy, nowMs: EARLY });
    expect(slots).not.toContain("14:00");
    expect(slots).not.toContain("13:30"); // 13:30-14:30 çakışır
    expect(slots).toEqual(["09:00", "10:00", "17:00"]);
  });

  it("geçmiş ve 30 dk içindeki saatleri önermez", () => {
    const slots = freeAppointmentSlots({ date: DAY, busy: [], nowMs: at("16:45") });
    expect(slots.every((t) => t >= "17:30")).toBe(true);
  });

  it("süresiz randevu 60 dk sayılır; geçersiz tarih boş döner", () => {
    expect(busyFromAppointments([{ scheduled_at: "2026-10-20T07:00:00Z", duration_min: null }])[0]).toEqual({
      startMs: Date.parse("2026-10-20T07:00:00Z"),
      endMs: Date.parse("2026-10-20T08:00:00Z"),
    });
    expect(freeAppointmentSlots({ date: "20.10.2026", busy: [], nowMs: EARLY })).toEqual([]);
  });
});
