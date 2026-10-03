import { describe, expect, it } from "vitest";
import {
  dueDateOf,
  evreOf,
  matchesRentalFilters,
  nextAnniversaryOf,
  nextMonthOf,
  type EvreContext,
} from "./rental-list-logic";

const ctx: EvreContext = { today: "2026-10-03", in30: "2026-11-02", yeni90: "2026-07-05", renewalIds: new Set(["r-yen"]) };
const base = { start_date: "2025-01-01", end_date: null as string | null };

describe("kiralama liste mantığı", () => {
  it("evre öncelik sırası: bitti > bitiyor > yenileme > yeni > devam", () => {
    expect(evreOf({ id: "a", status: "ended", ...base }, ctx)).toBe("bitti");
    expect(evreOf({ id: "a", status: "active", start_date: "2025-01-01", end_date: "2026-10-20" }, ctx)).toBe("bitiyor");
    expect(evreOf({ id: "r-yen", status: "active", ...base }, ctx)).toBe("yenileme");
    expect(evreOf({ id: "a", status: "active", start_date: "2026-09-01", end_date: null }, ctx)).toBe("yeni");
    expect(evreOf({ id: "a", status: "active", ...base }, ctx)).toBe("devam");
  });
  it("tarih yardımcıları", () => {
    expect(dueDateOf("2026-10", 5)).toBe("2026-10-05");
    expect(nextMonthOf("2026-12")).toBe("2027-01");
    expect(nextMonthOf("2026-03")).toBe("2026-04");
    expect(nextAnniversaryOf("2025-12-01", "2026-10-03")).toBe("2026-12-01");
    expect(nextAnniversaryOf("2026-12-01", "2026-10-03")).toBeNull(); // ilk yıl dolmadan yıldönümü yok
    expect(nextAnniversaryOf("2026-02-01", "2026-10-03")).toBe("2027-02-01");
    expect(nextAnniversaryOf("2024-02-29", "2026-10-03")).toBe("2027-02-28");
  });
  it("filtreler: arama, arıza, geciken, bu ay tahsil", () => {
    const fctx = {
      evreOf: () => "devam" as const,
      openMaintRentals: new Set(["m"]),
      overdueRentals: new Set(["o"]),
      curMonthStatus: (id: string) => (id === "p" ? "paid" : id === "w" ? "pending" : undefined),
    };
    const row = (id: string, text = "ev ahmet") => ({ id, status: "active", ...base, text });
    const none = { evre: "" as const, ariza: false, durum: "" as const, q: "" };
    expect(matchesRentalFilters(row("x"), none, fctx)).toBe(true);
    expect(matchesRentalFilters(row("x"), { ...none, q: "AHMET" }, fctx)).toBe(true);
    expect(matchesRentalFilters(row("x"), { ...none, q: "mehmet" }, fctx)).toBe(false);
    expect(matchesRentalFilters(row("m"), { ...none, ariza: true }, fctx)).toBe(true);
    expect(matchesRentalFilters(row("x"), { ...none, ariza: true }, fctx)).toBe(false);
    expect(matchesRentalFilters(row("o"), { ...none, durum: "overdue" }, fctx)).toBe(true);
    expect(matchesRentalFilters(row("p"), { ...none, durum: "paid" }, fctx)).toBe(true);
    expect(matchesRentalFilters(row("w"), { ...none, durum: "paid" }, fctx)).toBe(false);
    expect(matchesRentalFilters(row("w"), { ...none, durum: "pending" }, fctx)).toBe(true);
    expect(matchesRentalFilters(row("x"), { ...none, evre: "yeni" }, fctx)).toBe(false);
  });
});
