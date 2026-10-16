import { describe, expect, it } from "vitest";
import { defaultAppointmentSlot } from "./appointment-default-slot";

/** Ofis saati (+03:00) → epoch ms. */
const at = (iso: string) => Date.parse(`${iso}+03:00`);

describe("defaultAppointmentSlot (C17: bir sonraki boş tam saat, 09–19)", () => {
  it("gece 05:00'te bugün 09:00 önerir", () => {
    expect(defaultAppointmentSlot({ nowMs: at("2026-10-16T05:00:00") })).toEqual({ date: "2026-10-16", time: "09:00" });
  });

  it("gün içinde bir sonraki tam saati önerir", () => {
    expect(defaultAppointmentSlot({ nowMs: at("2026-10-16T10:20:00") })).toEqual({ date: "2026-10-16", time: "11:00" });
    expect(defaultAppointmentSlot({ nowMs: at("2026-10-16T11:00:00") })).toEqual({ date: "2026-10-16", time: "12:00" });
  });

  it("18:30'da 19:00, 19:10'da ertesi gün 09:00", () => {
    expect(defaultAppointmentSlot({ nowMs: at("2026-10-16T18:30:00") })).toEqual({ date: "2026-10-16", time: "19:00" });
    expect(defaultAppointmentSlot({ nowMs: at("2026-10-16T19:10:00") })).toEqual({ date: "2026-10-17", time: "09:00" });
    expect(defaultAppointmentSlot({ nowMs: at("2026-10-16T23:50:00") })).toEqual({ date: "2026-10-17", time: "09:00" });
  });

  it("dolu saati atlar", () => {
    const busy = [{ startMs: at("2026-10-16T11:00:00"), endMs: at("2026-10-16T12:00:00") }];
    expect(defaultAppointmentSlot({ nowMs: at("2026-10-16T10:20:00"), busy })).toEqual({ date: "2026-10-16", time: "12:00" });
  });

  it("her saat 09–19 arasında kalır", () => {
    for (let h = 0; h < 24; h++) {
      const { time } = defaultAppointmentSlot({ nowMs: at(`2026-10-16T${String(h).padStart(2, "0")}:15:00`) });
      const hour = Number(time.slice(0, 2));
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThanOrEqual(19);
      expect(time.endsWith(":00")).toBe(true);
    }
  });
});
