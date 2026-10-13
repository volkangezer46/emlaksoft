import { describe, expect, it } from "vitest";
import {
  computeTenantMrr,
  isExpiredActive,
  monthEndCandidateDays,
  mrrMonthEndSeries,
  periodChurn,
  sumSnapshotDays,
} from "./platform-metrics";

const NOW = Date.parse("2026-10-13T09:00:00Z"); // 12:00 TR
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const PRICES = new Map([
  ["advisor", 749],
  ["office", 2490],
  ["professional", 5990],
]);

describe("computeTenantMrr (exactMrr ile aynı kural, ofis bazında)", () => {
  it("aktif abonelik: kayıtlı tutar (katalog fiyatı DEĞİL)", () => {
    expect(computeTenantMrr({ tenantStatus: "active", tenantPlan: "professional", sub: { status: "active", amount_try: "4990.50" } }, PRICES)).toBe(4990.5);
  });
  it("aboneliği aktif olmayan aktif ofis: katalog fiyatı", () => {
    expect(computeTenantMrr({ tenantStatus: "active", tenantPlan: "office", sub: null }, PRICES)).toBe(2490);
    expect(computeTenantMrr({ tenantStatus: "active", tenantPlan: "office", sub: { status: "trialing", amount_try: 749 } }, PRICES)).toBe(2490);
  });
  it("deneme / gecikmiş / askı / iptal ofis gelir sayılmaz", () => {
    for (const tenantStatus of ["trial", "past_due", "suspended", "cancelled"]) {
      expect(computeTenantMrr({ tenantStatus, tenantPlan: "office", sub: { status: "paused", amount_try: 2490 } }, PRICES)).toBe(0);
    }
  });
  it("bilinmeyen plan ve bozuk tutar 0", () => {
    expect(computeTenantMrr({ tenantStatus: "active", tenantPlan: "yok", sub: null }, PRICES)).toBe(0);
    expect(computeTenantMrr({ tenantStatus: "active", tenantPlan: "office", sub: { status: "active", amount_try: "abc" } }, PRICES)).toBe(0);
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
  it("yalnız status=active ve dönem sonu geçmiş", () => {
    expect(isExpiredActive({ status: "active", current_period_end: iso(NOW - DAY) }, NOW)).toBe(true);
    expect(isExpiredActive({ status: "active", current_period_end: iso(NOW + DAY) }, NOW)).toBe(false);
    expect(isExpiredActive({ status: "past_due", current_period_end: iso(NOW - DAY) }, NOW)).toBe(false);
    expect(isExpiredActive({ status: "active", current_period_end: null }, NOW)).toBe(false);
    expect(isExpiredActive(null, NOW)).toBe(false);
  });
});
