import { describe, expect, it } from "vitest";
import { monthBoundsOf } from "./management-fee-card";

describe("monthBoundsOf (Muhasebe > Yönetim ücretleri kartı)", () => {
  it("ayın ilk günü ve sonraki ayın ilk günü; yıl sonunda yıl atlar", () => {
    expect(monthBoundsOf("2026-10-13")).toEqual({ from: "2026-10-01", toExclusive: "2026-11-01" });
    expect(monthBoundsOf("2026-12-31")).toEqual({ from: "2026-12-01", toExclusive: "2027-01-01" });
    expect(monthBoundsOf("2026-01-05")).toEqual({ from: "2026-01-01", toExclusive: "2026-02-01" });
  });
});
