import type { PlanDef, PlanLimits, SeatTier } from "@/lib/billing/plans";
import { PLAN_FIELD_LIMITS, sanitizeSeatTiers } from "@/lib/billing/plan-overrides";
import { validateSeatTiers } from "@/lib/billing/seat-pricing";

type Fields = Record<string, string | undefined>;

function trim(v: string | undefined): string {
  return (v ?? "").replace(/\s+/g, " ").trim();
}

function intField(
  raw: string | undefined,
  label: string,
  opts: { min: number; max: number; nullable: boolean },
): { value: number | null } | { error: string } {
  const t = trim(raw);
  if (!t) return opts.nullable ? { value: null } : { error: `${label} zorunlu.` };
  if (!/^\d+$/.test(t)) return { error: `${label} pozitif tam sayı olmalı.` };
  const n = Number(t);
  if (n < opts.min || n > opts.max) return { error: `${label} ${opts.min}-${opts.max} arasında olmalı.` };
  return { value: n };
}

/**
 * Panel formunu doğrulanmış PlanDef'e çevirir. Sessizce atmaz: geçersiz alan hata döner
 * (negatif/aşırı/ondalık fiyat ve limit reddedilir).
 */
export function parsePlanForm(base: PlanDef, f: Fields): { plan: PlanDef } | { error: string } {
  const name = trim(f.name);
  if (!name || name.length > PLAN_FIELD_LIMITS.nameMax) return { error: `Ad 1-${PLAN_FIELD_LIMITS.nameMax} karakter olmalı.` };
  const blurb = trim(f.blurb);
  if (!blurb || blurb.length > PLAN_FIELD_LIMITS.blurbMax) return { error: `Kısa açıklama 1-${PLAN_FIELD_LIMITS.blurbMax} karakter olmalı.` };
  const eyebrow = trim(f.eyebrow);
  if (!eyebrow || eyebrow.length > PLAN_FIELD_LIMITS.eyebrowMax) return { error: `Üst etiket 1-${PLAN_FIELD_LIMITS.eyebrowMax} karakter olmalı.` };

  const customPricing = f.custom_pricing === "on";
  const price = intField(f.monthly_try, "Aylık fiyat", { min: 1, max: PLAN_FIELD_LIMITS.priceMax, nullable: false });
  if ("error" in price) return price;
  const months = intField(f.yearly_paid_months, "Yıllık ödenen ay", { min: 1, max: 12, nullable: false });
  if ("error" in months) return months;
  const seatPrice = intField(f.extra_seat_monthly_try, "Ek kullanıcı fiyatı", { min: 1, max: PLAN_FIELD_LIMITS.priceMax, nullable: true });
  if ("error" in seatPrice) return seatPrice;
  const campaignPrice = intField(f.campaign_monthly_try, "Kampanya fiyatı", { min: 1, max: PLAN_FIELD_LIMITS.priceMax, nullable: true });
  if ("error" in campaignPrice) return campaignPrice;
  if (campaignPrice.value !== null && campaignPrice.value >= (price.value as number)) return { error: "Kampanya fiyatı liste fiyatından düşük olmalı." };
  const maxSeats = intField(f.max_seats, "Azami kullanıcı (boş = kademelere göre)", { min: 1, max: PLAN_FIELD_LIMITS.maxSeatsMax, nullable: true });
  if ("error" in maxSeats) return maxSeats;
  const roundingRaw = trim(f.seat_rounding) || "none";
  if (roundingRaw !== "none" && roundingRaw !== "x9" && roundingRaw !== "x0") return { error: "Yuvarlama düzeni geçersiz." };
  let seatTiers: SeatTier[] | null = null;
  const tiersRaw = (f.seat_tiers_json ?? "").trim();
  if (tiersRaw) {
    let parsedTiers: unknown;
    try {
      parsedTiers = JSON.parse(tiersRaw);
    } catch {
      return { error: "Kademe verisi okunamadı." };
    }
    const clean = sanitizeSeatTiers(parsedTiers);
    if (clean === undefined) return { error: "Kademeler geçersiz (tam sayı, en fazla 12 kademe)." };
    seatTiers = clean;
  }
  const ai = intField(f.ai_credits_monthly, "AI kredi kotası", { min: 0, max: PLAN_FIELD_LIMITS.quotaMax, nullable: true });
  if ("error" in ai) return ai;
  const valuation = intField(f.valuation_reports_monthly, "Değerleme raporu kotası", { min: 0, max: PLAN_FIELD_LIMITS.quotaMax, nullable: true });
  if ("error" in valuation) return valuation;
  const order = intField(f.order, "Sıra", { min: 0, max: PLAN_FIELD_LIMITS.orderMax, nullable: true });
  if ("error" in order) return order;

  const seats = intField(f.seats, "Kullanıcı limiti", { min: 1, max: PLAN_FIELD_LIMITS.limitMax, nullable: false });
  if ("error" in seats) return seats;
  const customers = intField(f.customers, "Müşteri limiti (boş = sınırsız)", { min: 1, max: PLAN_FIELD_LIMITS.limitMax, nullable: true });
  if ("error" in customers) return customers;
  const properties = intField(f.active_properties, "Portföy limiti (boş = sınırsız)", { min: 1, max: PLAN_FIELD_LIMITS.limitMax, nullable: true });
  if ("error" in properties) return properties;
  const branches = intField(f.branches, "Şube limiti (boş = sınırsız)", { min: 1, max: PLAN_FIELD_LIMITS.limitMax, nullable: true });
  if ("error" in branches) return branches;

  const features = (f.features ?? "")
    .split(/\r?\n/)
    .map((l) => trim(l))
    .filter(Boolean);
  if (features.length === 0 || features.length > PLAN_FIELD_LIMITS.featuresMax) {
    return { error: `Özellik listesi 1-${PLAN_FIELD_LIMITS.featuresMax} satır olmalı.` };
  }
  if (features.some((l) => l.length > PLAN_FIELD_LIMITS.featureMax)) {
    return { error: `Her özellik satırı en fazla ${PLAN_FIELD_LIMITS.featureMax} karakter olmalı.` };
  }

  const limits: PlanLimits = {
    seats: seats.value as number,
    customers: customers.value,
    activeProperties: properties.value,
    branches: branches.value,
  };
  const plan: PlanDef = {
    ...base,
    name,
    blurb,
    eyebrow,
    monthlyTry: price.value as number,
    yearlyPaidMonths: months.value as number,
    extraSeatMonthlyTry: seatPrice.value,
    extraSeatTiers: seatTiers,
    maxSeats: maxSeats.value,
    seatRounding: roundingRaw === "none" ? null : roundingRaw,
    campaignMonthlyTry: campaignPrice.value,
    aiCreditsMonthly: ai.value,
    valuationReportsMonthly: valuation.value,
    features,
    limits,
    customPricing,
    hidden: f.hidden === "on",
  };
  const seatErrors = validateSeatTiers({ ...plan, limits });
  if (seatErrors.length > 0) return { error: seatErrors[0]! };
  if (f.popular === "on") plan.popular = true;
  else delete plan.popular;
  if (order.value !== null) plan.order = order.value;
  else delete plan.order;
  return { plan };
}
