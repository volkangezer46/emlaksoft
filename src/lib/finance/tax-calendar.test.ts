import { describe, expect, it } from "vitest";
import { filingDueDate, nextBusinessDay, nextFiling } from "./tax-calendar";

describe("vergi takvimi", () => {
  it("hafta sonu ilk iş gününe kayar", () => {
    expect(nextBusinessDay("2026-11-28")).toBe("2026-11-30"); // Cumartesi
    expect(nextBusinessDay("2026-06-28")).toBe("2026-06-29"); // Pazar
    expect(nextBusinessDay("2026-10-28")).toBe("2026-10-28"); // Çarşamba
  });

  it("KDV izleyen ayın 28'i, muhtasar 26'sı; yıl geçişi", () => {
    expect(filingDueDate("kdv", "2026-09")).toBe("2026-10-28");
    expect(filingDueDate("muhtasar", "2026-09")).toBe("2026-10-26");
    expect(filingDueDate("kdv", "2026-12")).toBe("2027-01-28");
  });

  it("sıradaki beyan: geçen ayınki süresindeyse o, geçtiyse bu ayınki", () => {
    expect(nextFiling("kdv", "2026-10-15")).toEqual({ kind: "kdv", periodMonth: "2026-09", dueDate: "2026-10-28", daysLeft: 13 });
    expect(nextFiling("kdv", "2026-10-28").daysLeft).toBe(0);
    expect(nextFiling("kdv", "2026-10-29")).toMatchObject({ periodMonth: "2026-10", dueDate: "2026-11-30" });
    expect(nextFiling("muhtasar", "2026-10-27")).toMatchObject({ periodMonth: "2026-10", dueDate: "2026-11-26" });
  });
});
