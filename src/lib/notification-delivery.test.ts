import { describe, expect, it } from "vitest";
import { inQuietHours, parsePushChannel, parseQuietHours, pushAllowed, trMinuteOfDay } from "./notification-delivery";

/** Türkiye saatiyle verilen saat:dakikaya denk gelen UTC anı (TR = UTC+3). */
const tr = (h: number, m = 0) => Date.UTC(2026, 9, 18, h - 3, m);

describe("quiet hours (GA-09)", () => {
  it("TR minute of day is UTC+3", () => {
    expect(trMinuteOfDay(tr(21, 30))).toBe(21 * 60 + 30);
  });

  it("default 21:00–08:00 window wraps midnight", () => {
    const q = parseQuietHours(null);
    expect(inQuietHours(q, tr(22))).toBe(true);
    expect(inQuietHours(q, tr(7, 59))).toBe(true);
    expect(inQuietHours(q, tr(8))).toBe(false);
    expect(inQuietHours(q, tr(12))).toBe(false);
    expect(inQuietHours({ ...q, on: false }, tr(23))).toBe(false);
    expect(inQuietHours({ ...q, from: "13:00", to: "14:00" }, tr(13, 30))).toBe(true);
  });

  it("bad values fall back to defaults", () => {
    expect(parseQuietHours({ on: "x", from: "25:00", to: "8" })).toEqual({ on: true, from: "21:00", to: "08:00", urgent: true });
    expect(parsePushChannel({ task: false, "bad key": false, x: 1 })).toEqual({ task: false });
  });
});

describe("pushAllowed", () => {
  it("channel off blocks push only for that type", () => {
    const prefs = { push: { task: false }, quiet: { on: false } };
    expect(pushAllowed({ prefs, prefKey: "task", nowMs: tr(12) })).toBe(false);
    expect(pushAllowed({ prefs, prefKey: "appointment", nowMs: tr(12) })).toBe(true);
  });

  it("quiet hours block push except urgent (danger) when allowed", () => {
    expect(pushAllowed({ prefs: null, kind: "info", nowMs: tr(23) })).toBe(false);
    expect(pushAllowed({ prefs: null, kind: "danger", nowMs: tr(23) })).toBe(true);
    expect(pushAllowed({ prefs: { quiet: { urgent: false } }, kind: "danger", nowMs: tr(23) })).toBe(false);
    expect(pushAllowed({ prefs: null, kind: "info", nowMs: tr(10) })).toBe(true);
  });
});
