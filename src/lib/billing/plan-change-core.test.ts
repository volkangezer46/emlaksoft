import { describe, expect, it } from "vitest";
import { RECOMMENDED_CATALOG_OVERRIDES, applyPlanOverrides } from "@/lib/billing/plan-overrides";
import { evaluatePlanChange, remainingRatio } from "@/lib/billing/plan-change-core";
import { pickPaidCapNetTry } from "@/lib/billing/plan-change-paid-cap";
import { invoiceAmountsTry } from "@/lib/billing/fulfillment";

const plans = applyPlanOverrides(RECOMMENDED_CATALOG_OVERRIDES);
const office = plans.find((p) => p.id === "office")!;
const pro = plans.find((p) => p.id === "professional")!;
const advisor = plans.find((p) => p.id === "advisor")!;

// 30 birimlik dönem: yarısı geçti.
const HALF = { periodStartMs: 0, periodEndMs: 30_000, nowMs: 15_000 };
const base = { plans, fromPlanId: "office", toPlanId: "professional", cycle: "monthly" as const, ...HALF };

describe("oransal paket yükseltme tutarı", () => {
  it("kalan süre oranında fark: (yeni - mevcut) x oran, KDV hariç net", () => {
    const r = evaluatePlanChange(base);
    expect(r.status).toBe("upgrade");
    expect(r.ratio).toBe(0.5);
    expect(r.creditTry).toBe(Math.round(office.monthlyTry * 0.5 * 100) / 100);
    expect(r.newCostTry).toBe(Math.round(pro.monthlyTry * 0.5 * 100) / 100);
    expect(r.chargeNetTry).toBe(Math.round((pro.monthlyTry - office.monthlyTry) * 0.5 * 100) / 100);
    expect(r.effectiveAtPeriodEnd).toBe(false);
  });

  it("fatura KDV'si invoiceAmountsTry ile: net + %20 = toplam", () => {
    const r = evaluatePlanChange(base);
    const inv = invoiceAmountsTry(r.chargeNetTry);
    expect(inv.amountTry).toBe(r.chargeNetTry);
    expect(inv.taxTry).toBe(Math.round(r.chargeNetTry * 0.2 * 100) / 100);
    expect(inv.totalTry).toBe(Math.round((inv.amountTry + inv.taxTry) * 100) / 100);
  });

  it("dönem başında tam fark, dönem sonuna yakın sıfıra yakın (tiny_charge)", () => {
    const start = evaluatePlanChange({ ...base, nowMs: 0 });
    expect(start.ratio).toBe(1);
    expect(start.chargeNetTry).toBe(pro.monthlyTry - office.monthlyTry);
    const end = evaluatePlanChange({ ...base, periodEndMs: 30_000_000_000, periodStartMs: 0, nowMs: 29_999_999_999 });
    expect(end.status).toBe("tiny_charge");
    expect(end.chargeNetTry).toBe(0);
  });

  it("dönem bitmiş ya da yoksa yükseltme yok", () => {
    expect(evaluatePlanChange({ ...base, nowMs: 31_000 }).status).toBe("period_over");
    expect(evaluatePlanChange({ ...base, periodStartMs: null, periodEndMs: null }).status).toBe("no_period");
  });

  it("yıllık dönem: yıllık tutarlar (aylık x ödenen ay) üzerinden oranlanır", () => {
    const r = evaluatePlanChange({ ...base, cycle: "yearly" });
    const months = (d: typeof pro) => d.yearlyPaidMonths ?? 10;
    expect(r.fromPeriodTry).toBe(Math.round(office.monthlyTry * months(office)));
    expect(r.toPeriodTry).toBe(Math.round(pro.monthlyTry * months(pro)));
    expect(r.chargeNetTry).toBe(Math.round((r.toPeriodTry - r.fromPeriodTry) * 0.5 * 100) / 100);
  });

  it("kilitli (Founders) aylık fiyat kredi tabanıdır", () => {
    const locked = evaluatePlanChange({ ...base, lockedMonthlyTry: 1990 });
    const list = evaluatePlanChange(base);
    expect(locked.fromPeriodTry).toBe(1990);
    expect(locked.chargeNetTry).toBeGreaterThan(list.chargeNetTry);
  });

  it("indirimle az ödenmişse kredi ÖDENEN net tutarı aşamaz (fazladan kredi yok)", () => {
    const capped = evaluatePlanChange({ ...base, paidCapNetTry: 1000 });
    expect(capped.creditTry).toBe(500);
    expect(capped.chargeNetTry).toBe(Math.round((pro.monthlyTry * 0.5 - 500) * 100) / 100);
    // Tavan listeden büyükse liste fiyatı geçerli.
    const high = evaluatePlanChange({ ...base, paidCapNetTry: 999_999 });
    expect(high.creditTry).toBe(evaluatePlanChange(base).creditTry);
  });

  it("aynı paket / gizli hedef / bilinmeyen paket reddedilir", () => {
    expect(evaluatePlanChange({ ...base, toPlanId: "office" }).status).toBe("same_plan");
    expect(evaluatePlanChange({ ...base, toPlanId: "yok" }).status).toBe("unknown_plan");
    const hidden = plans.map((p) => (p.id === "professional" ? { ...p, hidden: true } : p));
    expect(evaluatePlanChange({ ...base, plans: hidden }).status).toBe("not_sold");
  });

  it("remainingRatio 0..1 aralığına sıkışır", () => {
    expect(remainingRatio(0, 100, -50)).toBe(1);
    expect(remainingRatio(0, 100, 200)).toBe(0);
    expect(remainingRatio(100, 100, 100)).toBe(0);
  });
});

describe("planlı düşürme (dönem sonunda, iade yok)", () => {
  const down = { ...base, fromPlanId: "professional", toPlanId: "office" };

  it("anında tutar yok, kredi yok; dönem sonunda uygulanır", () => {
    const r = evaluatePlanChange(down);
    expect(r.status).toBe("downgrade");
    expect(r.chargeNetTry).toBe(0);
    expect(r.creditTry).toBe(0);
    expect(r.effectiveAtPeriodEnd).toBe(true);
    expect(r.message).toMatch(/ade ve kredi yoktur/);
    expect(r.message).toMatch(/dönemin sonunda/);
  });

  it("dönem bitmiş olsa da planlanır kararı yenileme akışına bırakılır (period_over)", () => {
    expect(evaluatePlanChange({ ...down, nowMs: 31_000 }).status).toBe("period_over");
  });

  it("hedef paketin kullanıcı sınırını aşan ofis düşüremez (ek koltuk dahil)", () => {
    const small = evaluatePlanChange({ ...down, toPlanId: "advisor", usedSeats: advisor.limits.seats + 3, extraSeats: 1 });
    expect(small.status).toBe("over_capacity");
    expect(small.message).toMatch(/aktif kullanıcınız var/);
    const fits = evaluatePlanChange({ ...down, toPlanId: "advisor", usedSeats: advisor.limits.seats + 1, extraSeats: 1 });
    expect(fits.status).toBe("downgrade");
  });
});

describe("kredi tavanı seçimi (son ödenen düz yenileme)", () => {
  it("koltuk/kontör faturaları atlanır, düz yenilemenin neti alınır", () => {
    expect(
      pickPaidCapNetTry([
        { amount_try: 100, meta: { kind: "extra_seats" } },
        { amount_try: 50, meta: { kind: "credit_pack" } },
        { amount_try: "2490", meta: { plan: "office" } },
      ]),
    ).toBe(2490);
  });

  it("son anlamlı fatura yükseltmeyse tavan yok (liste fiyatı)", () => {
    expect(pickPaidCapNetTry([{ amount_try: 500, meta: { kind: "plan_upgrade" } }, { amount_try: 2490, meta: {} }])).toBeNull();
  });

  it("0 TL (tam kupon) ödenen dönemde tavan 0: ödenmemiş tutar krediye dönmez", () => {
    expect(pickPaidCapNetTry([{ amount_try: 0, meta: { plan: "office" } }])).toBe(0);
  });

  it("fatura yoksa / tutar bozuksa null", () => {
    expect(pickPaidCapNetTry([])).toBeNull();
    expect(pickPaidCapNetTry([{ amount_try: "x", meta: null }])).toBeNull();
  });
});
