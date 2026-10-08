import { describe, expect, it } from "vitest";
import {
  BASE_CATALOG,
  DEFAULT_CAMPAIGN,
  applyPlanOverrides,
  diffAgainstDefault,
  parsePlanCatalogSettings,
  sanitizePlanOverride,
  serializePlanCatalogSettings,
} from "@/lib/billing/plan-overrides";
import { parsePlanForm } from "@/lib/billing/plan-form";
import { validateSeatCatalog } from "@/lib/billing/seat-pricing";
import type { PlanDef } from "@/lib/billing/plans";

const office = BASE_CATALOG.find((p) => p.id === "office")!;

function formOf(plan: PlanDef, over: Record<string, string> = {}): Record<string, string> {
  return {
    name: plan.name,
    blurb: plan.blurb,
    eyebrow: plan.eyebrow,
    monthly_try: String(plan.monthlyTry),
    yearly_paid_months: String(plan.yearlyPaidMonths ?? 10),
    extra_seat_monthly_try: plan.extraSeatMonthlyTry ? String(plan.extraSeatMonthlyTry) : "",
    seat_tiers_json: plan.extraSeatTiers ? JSON.stringify(plan.extraSeatTiers) : "",
    max_seats: plan.maxSeats ? String(plan.maxSeats) : "",
    seat_rounding: plan.seatRounding ?? "none",
    seats: String(plan.limits.seats),
    customers: plan.limits.customers ? String(plan.limits.customers) : "",
    active_properties: plan.limits.activeProperties ? String(plan.limits.activeProperties) : "",
    branches: plan.limits.branches ? String(plan.limits.branches) : "",
    features: plan.features.join("\n"),
    ef_credits_monthly: plan.efCreditsMonthly ? String(plan.efCreditsMonthly) : "",
    ...over,
  };
}

describe("efCreditsMonthly plan alanı", () => {
  it("form gidiş-dönüş: değer, boş (= yok) ve 0", () => {
    const ok = parsePlanForm(office, formOf(office, { ef_credits_monthly: "55" }));
    expect("plan" in ok && ok.plan.efCreditsMonthly).toBe(55);
    const empty = parsePlanForm(office, formOf(office, { ef_credits_monthly: "" }));
    expect("plan" in empty && empty.plan.efCreditsMonthly).toBeNull();
    const zero = parsePlanForm(office, formOf(office, { ef_credits_monthly: "0" }));
    expect("plan" in zero && zero.plan.efCreditsMonthly).toBe(0);
  });
  it("form doğrulama: negatif, ondalık, aşırı büyük reddedilir", () => {
    for (const v of ["-1", "1.5", "abc", "100001"]) {
      expect("error" in parsePlanForm(office, formOf(office, { ef_credits_monthly: v })), v).toBe(true);
    }
  });
  it("override: sanitize, uygulama, kayıt gidiş-dönüş ve fark", () => {
    expect(sanitizePlanOverride({ efCreditsMonthly: 25 }).efCreditsMonthly).toBe(25);
    expect(sanitizePlanOverride({ efCreditsMonthly: null }).efCreditsMonthly).toBeNull();
    expect(sanitizePlanOverride({ efCreditsMonthly: -4 }).efCreditsMonthly).toBeUndefined();
    expect(sanitizePlanOverride({ efCreditsMonthly: "7" }).efCreditsMonthly).toBeUndefined();
    const saved = serializePlanCatalogSettings({
      overrides: { office: { efCreditsMonthly: 25 }, advisor: { efCreditsMonthly: null } },
      campaign: DEFAULT_CAMPAIGN,
    });
    const defs = applyPlanOverrides(parsePlanCatalogSettings(saved).overrides);
    expect(defs.find((p) => p.id === "office")!.efCreditsMonthly).toBe(25);
    expect(defs.find((p) => p.id === "advisor")!.efCreditsMonthly).toBeNull();
    expect(defs.find((p) => p.id === "professional")!.efCreditsMonthly).toBe(2100);
    expect(diffAgainstDefault(office, { ...office, efCreditsMonthly: 25 })).toEqual({ efCreditsMonthly: 25 });
    expect(diffAgainstDefault(office, office)).toEqual({});
  });
  it("kontör alanı koltuk kataloğu doğrulamasını bozmaz", () => {
    const defs = applyPlanOverrides({ office: { efCreditsMonthly: 99 } });
    expect(validateSeatCatalog(defs).errors).toEqual([]);
  });
});
