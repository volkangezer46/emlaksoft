import { describe, expect, it } from "vitest";
import { canCoach, daysSince, parseCommitments, sanitizeSnapshot } from "./logic";

describe("birebir görüşme (OA8)", () => {
  it("yalnız yönetim rolleri görüşme açar", () => {
    expect(canCoach("owner")).toBe(true);
    expect(canCoach("branch_manager")).toBe(true);
    expect(canCoach("team_lead")).toBe(false);
    expect(canCoach("advisor")).toBe(false);
  });

  it("anlık görüntü yalnız bilinen tam sayı alanlarını alır", () => {
    expect(sanitizeSnapshot('{"deals":3,"offers":"2","x":5,"calls":-1,"month":"2026-10","appointments":1.5}')).toEqual({ deals: 3, offers: 2, month: "2026-10" });
    expect(sanitizeSnapshot("bozuk")).toEqual({});
    expect(sanitizeSnapshot(null)).toEqual({});
  });

  it("taahhüt satırları: boş atlanır, tarih doğrulanır, görev bayrağı", () => {
    expect(parseCommitments(["  Haftada 5 yer gösterme ", "", "Fiyat güncelle"], ["2026-10-20", "", "yarın"], ["1", "", ""])).toEqual([
      { body: "Haftada 5 yer gösterme", dueOn: "2026-10-20", asTask: true },
      { body: "Fiyat güncelle", dueOn: null, asTask: false },
    ]);
    expect(parseCommitments(Array.from({ length: 15 }, (_, i) => `t${i}`), [], [])).toHaveLength(10);
  });

  it("gün farkı", () => {
    expect(daysSince("2026-10-01T00:00:00Z", Date.parse("2026-10-22T12:00:00Z"))).toBe(21);
    expect(daysSince(null, 0)).toBeNull();
  });
});
