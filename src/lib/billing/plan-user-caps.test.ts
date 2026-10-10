import { describe, expect, it } from "vitest";
import { PLAN_USER_CAPS, PLANS, BUSINESS_PLAN_TEMPLATE } from "@/lib/billing/plans";
import { RECOMMENDED_CATALOG_OVERRIDES, applyPlanOverrides } from "@/lib/billing/plan-overrides";
import { maxTotalSeats } from "@/lib/billing/seat-pricing";
import { isEmailVerified } from "@/lib/auth/email-verification";

describe("paket kullanıcı tavanları (sahip kararı 2026-10-10)", () => {
  it("tavanlar: Danışman 3, Ofis 15, Profesyonel 50, Kurumsal 500, Business 100", () => {
    expect(PLAN_USER_CAPS).toEqual({ advisor: 3, office: 15, professional: 50, business: 100, enterprise: 500 });
    for (const p of [...PLANS, BUSINESS_PLAN_TEMPLATE]) expect(p.maxSeats).toBe(PLAN_USER_CAPS[p.id]);
  });

  it("panel kaydı tavanı yükseltemez; düşürebilir", () => {
    const up = applyPlanOverrides({ ...RECOMMENDED_CATALOG_OVERRIDES, office: { ...RECOMMENDED_CATALOG_OVERRIDES.office, maxSeats: 400 } });
    expect(up.find((p) => p.id === "office")!.maxSeats).toBe(15);
    const cleared = applyPlanOverrides({ office: { maxSeats: null } });
    expect(cleared.find((p) => p.id === "office")!.maxSeats).toBe(15);
    const down = applyPlanOverrides({ office: { maxSeats: 8 } });
    expect(down.find((p) => p.id === "office")!.maxSeats).toBe(8);
  });

  it("satılabilir toplam kullanıcı tavana göre sınırlanır", () => {
    const defs = applyPlanOverrides(RECOMMENDED_CATALOG_OVERRIDES);
    const cap = (id: string) => maxTotalSeats(defs.find((p) => p.id === id)!);
    expect(cap("advisor")).toBe(3);
    expect(cap("office")).toBe(15);
    expect(cap("professional")).toBe(50);
    expect(cap("enterprise")).toBe(500);
  });
});

describe("e-posta doğrulama işareti", () => {
  it("işaret yoksa doğrulanmamış; işaret veya Google varsa doğrulanmış", () => {
    expect(isEmailVerified({ app_metadata: {}, user_metadata: {} })).toBe(false);
    expect(isEmailVerified({ app_metadata: {}, user_metadata: { email_verified_at: "2026-10-10T10:00:00Z" } })).toBe(true);
    expect(isEmailVerified({ app_metadata: { provider: "google" }, user_metadata: {} })).toBe(true);
    expect(isEmailVerified(null)).toBe(true);
  });
});
