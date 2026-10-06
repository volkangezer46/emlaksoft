import { describe, expect, it } from "vitest";
import { officeStatusOf, usageRatio } from "./office-status";
import type { PlanUsageRow } from "@/lib/nav-badges";

const row = (key: PlanUsageRow["key"], used: number, limit: number): PlanUsageRow => ({ key, label: key, used, limit, href: "/app" });

describe("officeStatusOf (yan menü ofis durumu çipi)", () => {
  it("deneme: kalan gün kısa metinde, düzey en az uyarı; doldu ise tehlike", () => {
    expect(officeStatusOf({ trial: true, trialDaysLeft: 9, usage: [] })).toEqual({ level: "warn", short: "9 gün", ratio: null });
    expect(officeStatusOf({ trial: true, trialDaysLeft: 0, usage: [] }).level).toBe("danger");
    expect(officeStatusOf({ trial: true, trialDaysLeft: 0, usage: [] }).short).toBe("Doldu");
    expect(officeStatusOf({ trial: true, trialDaysLeft: null, usage: [] }).short).toBe("Deneme");
  });

  it("ücretli: en dolu kalemin yüzdesi; eşikler 75/90", () => {
    expect(officeStatusOf({ trial: false, trialDaysLeft: null, usage: [row("seats", 2, 10), row("properties", 82, 100)] })).toEqual({
      level: "warn",
      short: "%82",
      ratio: 0.82,
    });
    expect(officeStatusOf({ trial: false, trialDaysLeft: null, usage: [row("seats", 1, 10)] }).level).toBe("ok");
    expect(officeStatusOf({ trial: false, trialDaysLeft: null, usage: [row("seats", 10, 10)] }).level).toBe("danger");
  });

  it("kalem yoksa uydurma metin/çubuk yok", () => {
    expect(officeStatusOf({ trial: false, trialDaysLeft: null, usage: [] })).toEqual({ level: "ok", short: null, ratio: null });
  });

  it("oran 0..1 aralığında sıkıştırılır; limitsiz (0) kalem 0", () => {
    expect(usageRatio({ used: 150, limit: 100 })).toBe(1);
    expect(usageRatio({ used: 5, limit: 0 })).toBe(0);
  });
});
