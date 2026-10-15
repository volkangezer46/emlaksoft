import { describe, expect, it } from "vitest";
import { activeSlotsAt, balancedFill, onDutyIds, weekDays, weekStartOf } from "./logic";

describe("nöbet çizelgesi (OA7)", () => {
  it("dilimler TR saatine göre", () => {
    expect(activeSlotsAt(9)).toEqual(["tam", "sabah"]);
    expect(activeSlotsAt(13)).toEqual(["tam", "ogle"]);
    expect(activeSlotsAt(22)).toEqual(["tam"]);
    const shifts = [
      { profile_id: "a", duty_date: "2026-10-15", slot: "sabah" },
      { profile_id: "b", duty_date: "2026-10-15", slot: "ogle" },
      { profile_id: "c", duty_date: "2026-10-15", slot: "tam" },
      { profile_id: "d", duty_date: "2026-10-16", slot: "tam" },
    ];
    expect(onDutyIds(shifts, "2026-10-15", 10)).toEqual(["a", "c"]);
    expect(onDutyIds(shifts, "2026-10-15", 15)).toEqual(["b", "c"]);
    expect(onDutyIds(shifts, "2026-10-15", 21)).toEqual(["c"]);
  });

  it("hafta pazartesiden başlar", () => {
    expect(weekStartOf("2026-10-15", "2026-01-01")).toBe("2026-10-12");
    expect(weekStartOf("2026-10-18", "2026-01-01")).toBe("2026-10-12");
    expect(weekStartOf("bozuk", "2026-10-19")).toBe("2026-10-19");
    expect(weekDays("2026-10-12")).toHaveLength(7);
  });

  it("dengeli dağıtım: pazar boş, izinli atlanır, dolu gün korunur, art arda aynı kişi yok", () => {
    const days = weekDays("2026-10-12");
    const out = balancedFill({
      days,
      members: ["a", "b", "c"],
      existing: [{ profile_id: "a", duty_date: "2026-10-12", slot: "tam" }],
      isOnLeave: (m, d) => m === "b" && d === "2026-10-13",
    });
    expect(out.map((x) => x.duty_date)).toEqual(days.slice(1, 6));
    expect(out.find((x) => x.duty_date === "2026-10-13")?.profile_id).toBe("c");
    for (let i = 1; i < out.length; i++) expect(out[i]!.profile_id).not.toBe(out[i - 1]!.profile_id);
    const counts = ["a", "b", "c"].map((m) => out.filter((x) => x.profile_id === m).length + (m === "a" ? 1 : 0));
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });
});
