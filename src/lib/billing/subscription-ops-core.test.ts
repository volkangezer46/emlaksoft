import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/clock";
import { RECOMMENDED_CATALOG_OVERRIDES, applyPlanOverrides } from "@/lib/billing/plan-overrides";
import { evaluatePlanChange } from "@/lib/billing/plan-change-core";
import {
  buildPaymentAttempts,
  cancelReasonText,
  isCancelReasonCode,
  lockedMonthlyAmount,
  parseDealInput,
  parseExpiryDate,
  previewAdminPlanChange,
  providerErrorText,
  type AdminPlanState,
} from "./subscription-ops-core";

const plans = applyPlanOverrides(RECOMMENDED_CATALOG_OVERRIDES);
const office = plans.find((p) => p.id === "office")!;
const pro = plans.find((p) => p.id === "professional")!;

const NOW = Date.UTC(2026, 9, 13, 9, 0, 0);
const state: AdminPlanState = {
  planId: "office",
  status: "active",
  cycle: "monthly",
  periodStartMs: NOW - 15 * DAY_MS,
  periodEndMs: NOW + 15 * DAY_MS,
  lockedMonthlyTry: null,
  pendingPlan: null,
  paused: false,
};
const base = { plans, state, nowMs: NOW };

describe("yönetici paket değişikliği önizlemesi", () => {
  it("hemen + kıst hesapla (yükseltme): kullanıcı akışıyla AYNI formül, fark faturası net tutarı", () => {
    const p = previewAdminPlanChange({ ...base, toPlanId: "professional", timing: "now", proration: "prorate" });
    const ev = evaluatePlanChange({ plans, fromPlanId: "office", toPlanId: "professional", cycle: "monthly", periodStartMs: state.periodStartMs, periodEndMs: state.periodEndMs, nowMs: NOW });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.kind).toBe("immediate");
    expect(p.invoiceNetTry).toBe(ev.chargeNetTry);
    expect(p.invoiceNetTry).toBeCloseTo((pro.monthlyTry - office.monthlyTry) * 0.5, 1);
    expect(p.message).toContain("fark faturası");
  });

  it("hemen + hesaplama: fatura yok", () => {
    const p = previewAdminPlanChange({ ...base, toPlanId: "professional", timing: "now", proration: "none" });
    expect(p).toMatchObject({ ok: true, kind: "immediate", invoiceNetTry: 0 });
  });

  it("dönem sonunda: planlı değişiklik (bekleyen plan), kıst yok; dönemsiz abonelikte reddedilir", () => {
    const p = previewAdminPlanChange({ ...base, toPlanId: "advisor", timing: "period_end", proration: "prorate" });
    expect(p).toMatchObject({ ok: true, kind: "schedule", effectiveAtMs: state.periodEndMs, invoiceNetTry: 0 });
    const none = previewAdminPlanChange({ ...base, state: { ...state, periodEndMs: NOW - 1 }, toPlanId: "advisor", timing: "period_end", proration: "none" });
    expect(none.ok).toBe(false);
    const dup = previewAdminPlanChange({ ...base, state: { ...state, pendingPlan: "advisor" }, toPlanId: "advisor", timing: "period_end", proration: "none" });
    expect(dup.ok).toBe(false);
  });

  it("hemen düşürme + kıst: fatura yok, kalan süre farkı yalnız bilgi (otomatik iade yok)", () => {
    const p = previewAdminPlanChange({ ...base, toPlanId: "advisor", timing: "now", proration: "prorate", usedSeats: 1 });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.invoiceNetTry).toBe(0);
    expect(p.downgradeCreditInfoTry).toBeGreaterThan(0);
  });

  it("aynı paket, duraklatılmış abonelik ve kapasite aşımı reddedilir", () => {
    expect(previewAdminPlanChange({ ...base, toPlanId: "office", timing: "now", proration: "none" }).ok).toBe(false);
    expect(previewAdminPlanChange({ ...base, state: { ...state, paused: true }, toPlanId: "professional", timing: "now", proration: "none" }).ok).toBe(false);
    const over = previewAdminPlanChange({ ...base, toPlanId: "advisor", timing: "now", proration: "prorate", usedSeats: 4 });
    expect(over.ok).toBe(false);
  });

  it("dönemsiz (deneme) abonelikte kıst seçilse de fatura çıkmaz", () => {
    const p = previewAdminPlanChange({ ...base, state: { ...state, periodStartMs: null, periodEndMs: null }, toPlanId: "professional", timing: "now", proration: "prorate" });
    expect(p).toMatchObject({ ok: true, invoiceNetTry: 0 });
  });
});

describe("iptal nedeni", () => {
  it("raporda gruplanabilir etiket; not ayrı sütun yoksa etikete eklenir", () => {
    expect(isCancelReasonCode("fiyat")).toBe(true);
    expect(isCancelReasonCode("yok")).toBe(false);
    expect(cancelReasonText("fiyat", "Rakip daha ucuz teklif verdi", true)).toBe("Fiyat yüksek");
    expect(cancelReasonText("fiyat", "Rakip daha ucuz teklif verdi", false)).toBe("Fiyat yüksek: Rakip daha ucuz teklif verdi");
  });
});

describe("tahsil denemeleri", () => {
  const inv = (i: number, extra: Record<string, unknown> = {}) => ({
    id: `inv-${i}`,
    invoice_no: `ES-${i}`,
    status: "draft",
    checkout_status: "initialization_failed",
    total_try: 100,
    created_at: new Date(NOW - i * DAY_MS).toISOString(),
    meta: { source: "auto_renew" },
    ...extra,
  });

  it("son 10 deneme, en yeni önce; hata metni sağlayıcı → mutabakat → durum sırasıyla", () => {
    const rows = Array.from({ length: 12 }, (_, i) => inv(i));
    rows[0] = inv(0, { checkout_error: "10051: Yetersiz bakiye" });
    rows[1] = inv(1, { status: "paid", checkout_status: "fulfilled" });
    rows[2] = inv(2, { checkout_status: "captured_pending" });
    const list = buildPaymentAttempts(rows, [
      { id: "c", invoice_id: "inv-2", status: "manual_review", attempt_count: 3, last_error_code: "P0001", captured_at: null, amount_try: 100 },
    ]);
    expect(list).toHaveLength(10);
    expect(list[0]).toMatchObject({ invoiceNo: "ES-0", outcome: "Başarısız", source: "Otomatik yenileme" });
    expect(list[0]!.errorText).toContain("yetersiz bakiye");
    expect(list[0]!.errorText).toContain("10051");
    expect(list[1]).toMatchObject({ outcome: "Başarılı", errorText: null });
    expect(list[2]!.errorText).toContain("elle inceleme");
    expect(list[3]!.errorText).toContain("banka reddetti");
  });

  it("checkout'u olmayan fatura deneme sayılmaz; bilinmeyen kod olduğu gibi gösterilir", () => {
    expect(buildPaymentAttempts([inv(1, { checkout_status: null })], [])).toHaveLength(0);
    expect(providerErrorText("99999: Bilinmeyen")).toBe("99999: Bilinmeyen");
    expect(providerErrorText("")).toBeNull();
  });
});

describe("özel anlaşma ve bitiş tarihi", () => {
  it("boş alan = kaldır; tutar ve tarih doğrulanır", () => {
    expect(parseDealInput({ priceLock: "", seatBase: "", commitmentDate: "" }, NOW)).toEqual({ ok: true, priceLockTry: null, seatBaseTry: null, commitmentEndIso: null });
    const ok = parseDealInput({ priceLock: "1.990", seatBase: "399,50", commitmentDate: "2027-10-13" }, NOW);
    expect(ok).toMatchObject({ ok: true, priceLockTry: 1990, seatBaseTry: 399.5 });
    expect(parseDealInput({ priceLock: "-5", seatBase: "", commitmentDate: "" }, NOW).ok).toBe(false);
    expect(parseDealInput({ priceLock: "", seatBase: "", commitmentDate: "2026-10-01" }, NOW).ok).toBe(false);
    expect(parseDealInput({ priceLock: "", seatBase: "", commitmentDate: "2040-01-01" }, NOW).ok).toBe(false);
  });

  it("fiyat kilidi liste fiyatını aşamaz", () => {
    expect(lockedMonthlyAmount(2790, 1990)).toBe(1990);
    expect(lockedMonthlyAmount(2790, 5000)).toBe(2790);
    expect(lockedMonthlyAmount(2790, null)).toBe(2790);
  });

  it("istisna bitişi: boş süresiz, geçmiş reddedilir", () => {
    expect(parseExpiryDate("", NOW)).toEqual({ ok: true, iso: null });
    expect(parseExpiryDate("2026-10-20", NOW).ok).toBe(true);
    expect(parseExpiryDate("2026-10-12", NOW).ok).toBe(false);
  });
});
