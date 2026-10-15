import { describe, expect, it } from "vitest";
import {
  activeSubscriptionCount,
  exactArr,
  exactMrr,
  exactTrendMrr,
  missingSubscriptionCount,
  priceMapOf,
  type PlatformPlanStat,
  type PlatformReportingAggregate,
} from "./platform";

const stat = (plan: PlatformPlanStat["plan"], active: number, subs: number, mrr: number): PlatformPlanStat => ({
  plan,
  tenant_count: active,
  active_count: active,
  subscription_count: subs,
  subscription_mrr: mrr,
});

describe("platform MRR = aktif aboneliklerin amount_try toplamı (katalog yedeği yok)", () => {
  it("aboneliği olmayan aktif ofis MRR'a 0 ekler (eskiden katalog fiyatı eklenirdi)", () => {
    // professional: 2 aktif ofis, 1 aktif abonelik (5.990) → MRR 5.990, eksik abonelik 1
    const stats = [stat("professional", 2, 1, 5990), stat("office", 0, 0, 0)];
    const prices = priceMapOf([{ id: "professional", monthlyTry: 5490 }]);
    expect(exactMrr(stats)).toBe(5990);
    expect(exactMrr(stats, prices)).toBe(5990);
  });

  it("iç ofis RPC kapsamında yoktur: yalnız gerçek abonelik tutarları toplanır (canlı 2026-10: 17.470 → 5.990)", () => {
    // 20261016060500 sonrası plan_stats iç ofisleri (e2e-test, demo-ofis, admin) içermez.
    expect(exactMrr([stat("professional", 1, 1, 5990), stat("office", 0, 0, 0), stat("advisor", 0, 0, 0)])).toBe(5990);
  });

  it("kayıtlı tutar yeniden hesaplanmaz, bozuk değer 0 sayılır, ARR = MRR × 12", () => {
    const bad = { ...stat("office", 1, 1, 0), subscription_mrr: Number.NaN };
    expect(exactMrr([stat("office", 3, 3, 4990.4), bad])).toBe(4990);
    expect(exactArr(5990)).toBe(71880);
  });

  it("ay satırı yalnız anlık görüntü toplamını verir", () => {
    const row = {
      month_start: "2026-09-30T21:00:00+00:00",
      ym: "2026-10",
      subscription_mrr: 5990,
      advisor_count: 0,
      advisor_subscription_count: 0,
      office_count: 3,
      office_subscription_count: 0,
      professional_count: 1,
      professional_subscription_count: 1,
      enterprise_count: 0,
      enterprise_subscription_count: 0,
    };
    expect(exactTrendMrr(row)).toBe(5990);
  });
});

describe("aboneliği eksik ofis uyarı sayacı ve aktif abonelik sayısı", () => {
  const base = { summary: {} as PlatformReportingAggregate["summary"] };
  it("RPC alanı varsa onu kullanır", () => {
    expect(missingSubscriptionCount({ ...base, summary: { ...base.summary, missing_subscription_count: 2 }, plan_stats: [] })).toBe(2);
  });
  it("migration öncesi yanıtta plan satırlarından türetir", () => {
    expect(missingSubscriptionCount({ ...base, plan_stats: [stat("professional", 2, 1, 5990), stat("office", 1, 1, 2490)] })).toBe(1);
  });
  it("aktif abonelik sayısı MRR ile aynı kümeden", () => {
    expect(activeSubscriptionCount([stat("professional", 2, 1, 5990), stat("office", 1, 1, 2490)])).toBe(2);
  });
});
