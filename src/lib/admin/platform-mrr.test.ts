import { describe, expect, it } from "vitest";
import {
  computeTenantMrr,
  isExpiredActive,
  isMissingSubscription,
  monthEndCandidateDays,
  mrrMonthEndSeries,
  periodChurn,
  sumSnapshotDays,
} from "./platform-metrics";

const NOW = Date.parse("2026-10-13T09:00:00Z"); // 12:00 TR
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
describe("computeTenantMrr (exactMrr ile aynı kural, ofis bazında; katalog yedeği yok)", () => {
  it("aktif abonelik: kayıtlı tutar (katalog fiyatı DEĞİL)", () => {
    expect(computeTenantMrr({ tenantStatus: "active", tenantPlan: "professional", sub: { status: "active", amount_try: "4990.50" } })).toBe(4990.5);
  });
  it("aboneliği olmayan ya da aktif olmayan aktif ofis MRR'a 0 ekler ve uyarı sayacına gider", () => {
    const noSub = { tenantStatus: "active", tenantPlan: "office", sub: null };
    const trialSub = { tenantStatus: "active", tenantPlan: "office", sub: { status: "trialing", amount_try: 749 } };
    expect(computeTenantMrr(noSub)).toBe(0);
    expect(computeTenantMrr(trialSub)).toBe(0);
    expect(isMissingSubscription(noSub)).toBe(true);
    expect(isMissingSubscription(trialSub)).toBe(true);
  });
  it("iç/test/demo ofis (is_internal) aktif aboneliği olsa da 0 ve uyarıya girmez", () => {
    const demo = { tenantStatus: "active", tenantPlan: "professional", sub: { status: "active", amount_try: 5990 }, internal: true };
    const e2e = { tenantStatus: "active", tenantPlan: "professional", sub: null, internal: true };
    expect(computeTenantMrr(demo)).toBe(0);
    expect(computeTenantMrr(e2e)).toBe(0);
    expect(isMissingSubscription(e2e)).toBe(false);
  });
  it("deneme / gecikmiş / askı / iptal abonelik gelir sayılmaz", () => {
    for (const status of ["trialing", "past_due", "paused", "cancelled"]) {
      expect(computeTenantMrr({ tenantStatus: "active", tenantPlan: "office", sub: { status, amount_try: 2490 } })).toBe(0);
    }
  });
  it("bozuk tutar 0", () => {
    expect(computeTenantMrr({ tenantStatus: "active", tenantPlan: "office", sub: { status: "active", amount_try: "abc" } })).toBe(0);
  });
});

describe("periodChurn (dönemsel; payda 0 → null)", () => {
  it("payda 0 ise oran null (veri yok)", () => {
    expect(periodChurn([], NOW)).toEqual({ cancelled: 0, base: 0, rate: null });
    // Hepsi son 30 günde açılmış: dönem başında aktif ofis yok.
    const fresh = [{ tenant_id: "a", status: "active", created_at: iso(NOW - 5 * DAY), cancelled_at: null }];
    expect(periodChurn(fresh, NOW).rate).toBeNull();
  });
  it("son 30 günde iptal / 30 gün önce aktif", () => {
    const rows = [
      { tenant_id: "a", status: "active", created_at: iso(NOW - 90 * DAY), cancelled_at: null },
      { tenant_id: "b", status: "cancelled", created_at: iso(NOW - 90 * DAY), cancelled_at: iso(NOW - 3 * DAY) },
      { tenant_id: "c", status: "past_due", created_at: iso(NOW - 60 * DAY), cancelled_at: null },
      // 30 günden ÖNCE iptal: paydaya da paya da girmez.
      { tenant_id: "d", status: "cancelled", created_at: iso(NOW - 200 * DAY), cancelled_at: iso(NOW - 45 * DAY) },
      // Dönem içinde açılıp iptal: paya girmez (oran %100'ü aşmaz).
      { tenant_id: "e", status: "cancelled", created_at: iso(NOW - 10 * DAY), cancelled_at: iso(NOW - 2 * DAY) },
      // Deneme aboneliği dönem başı aktif ofis sayılmaz.
      { tenant_id: "f", status: "trialing", created_at: iso(NOW - 40 * DAY), cancelled_at: null },
    ];
    expect(periodChurn(rows, NOW)).toEqual({ cancelled: 1, base: 3, rate: 33.3 });
  });
});

describe("MRR eğrisi (platform_mrr_daily ay sonu)", () => {
  it("anlık görüntü öncesi aylar null, her ayın SON günü kullanılır", () => {
    const days = sumSnapshotDays([
      { day: "2026-09-28", mrr_try: 1000 },
      { day: "2026-09-28", mrr_try: "500" },
      { day: "2026-09-30", mrr_try: 2000 },
      { day: "2026-10-12", mrr_try: 2500 },
    ]);
    const s = mrrMonthEndSeries(days, NOW, 4);
    expect(s.map((p) => p.key)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(s.map((p) => p.value)).toEqual([null, null, 2000, 2500]);
    expect(s[2]!.day).toBe("2026-09-30");
    expect(s[0]!.label).toBe("Tem");
  });
  it("hiç anlık görüntü yoksa tüm aylar null (sıfır çizilmez)", () => {
    expect(mrrMonthEndSeries([], NOW, 3).every((p) => p.value === null)).toBe(true);
  });
  it("aday günler: geçmiş ayların son 7 günü + bu ayın bugüne kadarki son 7 günü, gelecek yok", () => {
    const days = monthEndCandidateDays(NOW, 2, 7);
    expect(days).toContain("2026-09-24");
    expect(days).toContain("2026-09-30");
    expect(days).not.toContain("2026-09-23");
    expect(days).toContain("2026-10-07");
    expect(days).toContain("2026-10-13");
    expect(days).not.toContain("2026-10-14");
    expect(days).not.toContain("2026-10-31");
    expect(new Set(days).size).toBe(days.length);
  });
});

describe("isExpiredActive", () => {
  const sub = (status: string, end: string | null, extra: { pause_started_at?: string | null; cancel_at_period_end?: boolean } = {}) => ({
    status,
    current_period_end: end,
    pause_started_at: extra.pause_started_at ?? null,
    cancel_at_period_end: extra.cancel_at_period_end ?? false,
  });
  it("yalnız status=active ve dönem sonu geçmiş", () => {
    expect(isExpiredActive(sub("active", iso(NOW - DAY)), NOW)).toBe(true);
    expect(isExpiredActive(sub("active", iso(NOW + DAY)), NOW)).toBe(false);
    expect(isExpiredActive(sub("past_due", iso(NOW - DAY)), NOW)).toBe(false);
    expect(isExpiredActive(sub("active", null), NOW)).toBe(false);
    expect(isExpiredActive(null, NOW)).toBe(false);
  });
  it("duraklatılmış ve dönem sonu iptali bekleyen aday değildir (otomatik adımla aynı tanım)", () => {
    expect(isExpiredActive(sub("active", iso(NOW - DAY), { pause_started_at: iso(NOW - 10 * DAY) }), NOW)).toBe(false);
    expect(isExpiredActive(sub("active", iso(NOW - DAY), { cancel_at_period_end: true }), NOW)).toBe(false);
  });
});
