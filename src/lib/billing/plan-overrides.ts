import {
  BUSINESS_PLAN_TEMPLATE,
  PLANS,
  type PlanDef,
  type PlanId,
  type PlanLimits,
  type SeatRounding,
  type SeatTier,
} from "@/lib/billing/plans";

/**
 * Panelden düzenlenen paket tanımlarının saf (sunucu bağımsız) katmanı: doğrulama,
 * serileştirme ve plans.ts varsayılanı üzerine bindirme. Depo: `platform_settings`
 * anahtarı `billing.plan_definitions` (şema gerekmez). Kayıt yoksa/bozuksa varsayılan döner.
 */
export const PLAN_DEFINITIONS_SETTING_KEY = "billing.plan_definitions";

export const PLAN_FIELD_LIMITS = {
  nameMax: 40,
  blurbMax: 80,
  eyebrowMax: 30,
  featureMax: 140,
  featuresMax: 12,
  priceMax: 1_000_000,
  limitMax: 10_000_000,
  quotaMax: 100_000_000,
  seatTiersMax: 12,
  maxSeatsMax: 100_000,
  orderMax: 1000,
  campaignNameMax: 60,
  trialDaysMin: 1,
  trialDaysMax: 90,
} as const;

/** Veritabanında plan kimliği kısıtı olan (satılabilir) kimlikler; business migration ister. */
export const ALL_PLAN_IDS: readonly PlanId[] = ["advisor", "office", "professional", "business", "enterprise"];

export type PlanOverride = {
  name?: string;
  monthlyTry?: number;
  blurb?: string;
  eyebrow?: string;
  popular?: boolean;
  features?: string[];
  limits?: Partial<PlanLimits>;
  yearlyPaidMonths?: number;
  extraSeatMonthlyTry?: number | null;
  extraSeatTiers?: SeatTier[] | null;
  maxSeats?: number | null;
  seatRounding?: SeatRounding | null;
  aiCreditsMonthly?: number | null;
  valuationReportsMonthly?: number | null;
  customPricing?: boolean;
  hidden?: boolean;
  order?: number;
  campaignMonthlyTry?: number | null;
};

export type PlanOverrides = Partial<Record<PlanId, PlanOverride>>;

/** Kampanya (Founders) genel ayarı; plan başına indirimli fiyat PlanDef.campaignMonthlyTry'dedir. */
export type PlanCampaignSettings = {
  name: string;
  /** Kampanya kotası (ör. ilk 1000 müşteri). Kalan hak gerçek abonelik sayımından hesaplanır. */
  quota: number;
  active: boolean;
  /** true: indirimli fiyat abonelik sürdükçe korunur (kilitli fiyat abonelik kaydına yazılır; şema ister). */
  lockPrice: boolean;
};

export const DEFAULT_CAMPAIGN: PlanCampaignSettings = { name: "Founders", quota: 1000, active: false, lockPrice: true };

export type PlanCatalogSettings = {
  overrides: PlanOverrides;
  campaign: PlanCampaignSettings;
};

function isInt(n: unknown, min: number, max: number): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length >= 1 && t.length <= max ? t : null;
}

function cleanLimit(v: unknown, allowNull: boolean): number | null | undefined {
  if (v === null) return allowNull ? null : undefined;
  return isInt(v, 1, PLAN_FIELD_LIMITS.limitMax) ? v : undefined;
}

function cleanNullableInt(v: unknown, min: number, max: number): number | null | undefined {
  if (v === null) return null;
  return isInt(v, min, max) ? v : undefined;
}

/**
 * Kademe dizisinin YAPISAL temizliği (tam sayı, sıra, üst sınır). Anlamsal doğrulama (boşluk, monotonluk,
 * yuvarlama) seat-pricing.ts `validateSeatTiers` işidir. Yapısal olarak bozuksa undefined döner.
 * null = kademeleri temizle.
 */
export function sanitizeSeatTiers(raw: unknown): SeatTier[] | null | undefined {
  if (raw === null) return null;
  if (!Array.isArray(raw)) return undefined;
  if (raw.length === 0) return null;
  if (raw.length > PLAN_FIELD_LIMITS.seatTiersMax) return undefined;
  const out: SeatTier[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return undefined;
    const t = item as Record<string, unknown>;
    if (!isInt(t.fromSeat, 1, PLAN_FIELD_LIMITS.maxSeatsMax)) return undefined;
    const to = t.toSeat === null || t.toSeat === undefined ? null : t.toSeat;
    if (to !== null && !isInt(to, 1, PLAN_FIELD_LIMITS.maxSeatsMax)) return undefined;
    if (!isInt(t.monthlyTry, 1, PLAN_FIELD_LIMITS.priceMax)) return undefined;
    out.push({ fromSeat: t.fromSeat, toSeat: to, monthlyTry: t.monthlyTry });
  }
  return out;
}

const SEAT_ROUNDINGS: readonly SeatRounding[] = ["none", "x9", "x0"];

/** Güvensiz girdiyi (JSON/form) doğrulanmış tek paket düzenlemesine çevirir; geçersiz alanı sessizce atar. */
export function sanitizePlanOverride(raw: unknown): PlanOverride {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: PlanOverride = {};
  const name = cleanText(r.name, PLAN_FIELD_LIMITS.nameMax);
  if (name) out.name = name;
  if (isInt(r.monthlyTry, 1, PLAN_FIELD_LIMITS.priceMax)) out.monthlyTry = r.monthlyTry;
  const blurb = cleanText(r.blurb, PLAN_FIELD_LIMITS.blurbMax);
  if (blurb) out.blurb = blurb;
  const eyebrow = cleanText(r.eyebrow, PLAN_FIELD_LIMITS.eyebrowMax);
  if (eyebrow) out.eyebrow = eyebrow;
  if (typeof r.popular === "boolean") out.popular = r.popular;
  if (typeof r.customPricing === "boolean") out.customPricing = r.customPricing;
  if (typeof r.hidden === "boolean") out.hidden = r.hidden;
  if (isInt(r.yearlyPaidMonths, 1, 12)) out.yearlyPaidMonths = r.yearlyPaidMonths;
  if (isInt(r.order, 0, PLAN_FIELD_LIMITS.orderMax)) out.order = r.order;
  const seatPrice = cleanNullableInt(r.extraSeatMonthlyTry, 1, PLAN_FIELD_LIMITS.priceMax);
  if (seatPrice !== undefined) out.extraSeatMonthlyTry = seatPrice;
  const tiers = sanitizeSeatTiers(r.extraSeatTiers);
  if (tiers !== undefined) out.extraSeatTiers = tiers;
  const maxSeats = cleanNullableInt(r.maxSeats, 1, PLAN_FIELD_LIMITS.maxSeatsMax);
  if (maxSeats !== undefined) out.maxSeats = maxSeats;
  if (r.seatRounding === null) out.seatRounding = null;
  else if (typeof r.seatRounding === "string" && (SEAT_ROUNDINGS as readonly string[]).includes(r.seatRounding)) {
    out.seatRounding = r.seatRounding as SeatRounding;
  }
  const campaignPrice = cleanNullableInt(r.campaignMonthlyTry, 1, PLAN_FIELD_LIMITS.priceMax);
  if (campaignPrice !== undefined) out.campaignMonthlyTry = campaignPrice;
  const ai = cleanNullableInt(r.aiCreditsMonthly, 0, PLAN_FIELD_LIMITS.quotaMax);
  if (ai !== undefined) out.aiCreditsMonthly = ai;
  const valuation = cleanNullableInt(r.valuationReportsMonthly, 0, PLAN_FIELD_LIMITS.quotaMax);
  if (valuation !== undefined) out.valuationReportsMonthly = valuation;
  if (Array.isArray(r.features)) {
    const features = r.features
      .map((f) => cleanText(f, PLAN_FIELD_LIMITS.featureMax))
      .filter((f): f is string => !!f)
      .slice(0, PLAN_FIELD_LIMITS.featuresMax);
    if (features.length > 0) out.features = features;
  }
  if (r.limits && typeof r.limits === "object") {
    const l = r.limits as Record<string, unknown>;
    const limits: Partial<PlanLimits> = {};
    const seats = cleanLimit(l.seats, false);
    if (seats !== undefined && seats !== null) limits.seats = seats;
    for (const key of ["customers", "activeProperties", "branches"] as const) {
      const v = cleanLimit(l[key], true);
      if (v !== undefined) limits[key] = v;
    }
    if (Object.keys(limits).length > 0) out.limits = limits;
  }
  return out;
}

export function sanitizeCampaign(raw: unknown): PlanCampaignSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_CAMPAIGN;
  const r = raw as Record<string, unknown>;
  return {
    name: cleanText(r.name, PLAN_FIELD_LIMITS.campaignNameMax) ?? DEFAULT_CAMPAIGN.name,
    quota: isInt(r.quota, 1, PLAN_FIELD_LIMITS.limitMax) ? r.quota : DEFAULT_CAMPAIGN.quota,
    active: r.active === true,
    lockPrice: r.lockPrice !== false,
  };
}

export function parsePlanCatalogSettings(raw: string | null | undefined): PlanCatalogSettings {
  const empty: PlanCatalogSettings = { overrides: {}, campaign: DEFAULT_CAMPAIGN };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as { plans?: Record<string, unknown>; campaign?: unknown };
    const overrides: PlanOverrides = {};
    for (const id of ALL_PLAN_IDS) {
      const o = sanitizePlanOverride(parsed?.plans?.[id]);
      if (Object.keys(o).length > 0) overrides[id] = o;
    }
    return { overrides, campaign: sanitizeCampaign(parsed?.campaign) };
  } catch {
    return empty;
  }
}

/** Eski çağıranlar için: yalnız plan düzenlemeleri. */
export function parsePlanOverrides(raw: string | null | undefined): PlanOverrides {
  return parsePlanCatalogSettings(raw).overrides;
}

export function serializePlanCatalogSettings(settings: PlanCatalogSettings): string {
  return JSON.stringify({ v: 2, plans: settings.overrides, campaign: settings.campaign });
}

export function serializePlanOverrides(overrides: PlanOverrides): string {
  return serializePlanCatalogSettings({ overrides, campaign: DEFAULT_CAMPAIGN });
}

/** Varsayılan katalog: veritabanı sözleşmeli PLANS + gizli Business şablonu. */
export const BASE_CATALOG: readonly PlanDef[] = [...PLANS, BUSINESS_PLAN_TEMPLATE];

function orderKey(def: PlanDef, index: number): number {
  return def.order ?? (index + 1) * 10;
}

function nullable<T>(override: T | null | undefined, base: T | null | undefined): T | null | undefined {
  return override !== undefined ? override : base;
}

/** plans.ts varsayılanı + düzenleme = etkin tanımlar. Aynı anda en fazla bir "popüler" paket kalır; sıraya göre dizilir. */
export function applyPlanOverrides(overrides: PlanOverrides, base: readonly PlanDef[] = BASE_CATALOG): PlanDef[] {
  const merged = base.map((plan): PlanDef => {
    const o = overrides[plan.id];
    if (!o) return plan;
    const next: PlanDef = {
      ...plan,
      name: o.name ?? plan.name,
      monthlyTry: o.monthlyTry ?? plan.monthlyTry,
      blurb: o.blurb ?? plan.blurb,
      eyebrow: o.eyebrow ?? plan.eyebrow,
      features: o.features ?? plan.features,
      limits: { ...plan.limits, ...(o.limits ?? {}) },
    };
    const popular = o.popular ?? plan.popular;
    if (popular) next.popular = true;
    else delete next.popular;
    if (o.yearlyPaidMonths !== undefined) next.yearlyPaidMonths = o.yearlyPaidMonths;
    const seat = nullable(o.extraSeatMonthlyTry, plan.extraSeatMonthlyTry);
    if (seat !== undefined) next.extraSeatMonthlyTry = seat;
    const tiers = nullable(o.extraSeatTiers, plan.extraSeatTiers);
    if (tiers !== undefined) next.extraSeatTiers = tiers;
    const maxSeats = nullable(o.maxSeats, plan.maxSeats);
    if (maxSeats !== undefined) next.maxSeats = maxSeats;
    const rounding = nullable(o.seatRounding, plan.seatRounding);
    if (rounding !== undefined) next.seatRounding = rounding;
    const ai = nullable(o.aiCreditsMonthly, plan.aiCreditsMonthly);
    if (ai !== undefined) next.aiCreditsMonthly = ai;
    const valuation = nullable(o.valuationReportsMonthly, plan.valuationReportsMonthly);
    if (valuation !== undefined) next.valuationReportsMonthly = valuation;
    const campaign = nullable(o.campaignMonthlyTry, plan.campaignMonthlyTry);
    if (campaign !== undefined) next.campaignMonthlyTry = campaign;
    if (o.customPricing !== undefined) next.customPricing = o.customPricing;
    if (o.hidden !== undefined) next.hidden = o.hidden;
    if (o.order !== undefined) next.order = o.order;
    return next;
  });
  const sorted = merged
    .map((plan, i) => ({ plan, key: orderKey(plan, i), i }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map(({ plan }) => plan);
  let seen = false;
  return sorted.map((plan) => {
    if (!plan.popular) return plan;
    if (seen) {
      const rest: PlanDef = { ...plan };
      delete rest.popular;
      return rest;
    }
    seen = true;
    return plan;
  });
}

/** Düzenleme, varsayılanla aynıysa kaydedilmez (kayıt şişmesin, varsayılan değişirse izlensin). */
export function diffAgainstDefault(plan: PlanDef, edited: PlanDef): PlanOverride {
  const o: PlanOverride = {};
  if (edited.name !== plan.name) o.name = edited.name;
  if (edited.monthlyTry !== plan.monthlyTry) o.monthlyTry = edited.monthlyTry;
  if (edited.blurb !== plan.blurb) o.blurb = edited.blurb;
  if (edited.eyebrow !== plan.eyebrow) o.eyebrow = edited.eyebrow;
  if (Boolean(edited.popular) !== Boolean(plan.popular)) o.popular = Boolean(edited.popular);
  if (JSON.stringify(edited.features) !== JSON.stringify(plan.features)) o.features = edited.features;
  if (edited.yearlyPaidMonths !== plan.yearlyPaidMonths) o.yearlyPaidMonths = edited.yearlyPaidMonths;
  if ((edited.extraSeatMonthlyTry ?? null) !== (plan.extraSeatMonthlyTry ?? null)) o.extraSeatMonthlyTry = edited.extraSeatMonthlyTry ?? null;
  if (JSON.stringify(edited.extraSeatTiers ?? null) !== JSON.stringify(plan.extraSeatTiers ?? null)) {
    o.extraSeatTiers = edited.extraSeatTiers ?? null;
  }
  if ((edited.maxSeats ?? null) !== (plan.maxSeats ?? null)) o.maxSeats = edited.maxSeats ?? null;
  if ((edited.seatRounding ?? null) !== (plan.seatRounding ?? null)) o.seatRounding = edited.seatRounding ?? null;
  if ((edited.aiCreditsMonthly ?? null) !== (plan.aiCreditsMonthly ?? null)) o.aiCreditsMonthly = edited.aiCreditsMonthly ?? null;
  if ((edited.valuationReportsMonthly ?? null) !== (plan.valuationReportsMonthly ?? null)) {
    o.valuationReportsMonthly = edited.valuationReportsMonthly ?? null;
  }
  if ((edited.campaignMonthlyTry ?? null) !== (plan.campaignMonthlyTry ?? null)) o.campaignMonthlyTry = edited.campaignMonthlyTry ?? null;
  if (Boolean(edited.customPricing) !== Boolean(plan.customPricing)) o.customPricing = Boolean(edited.customPricing);
  if (Boolean(edited.hidden) !== Boolean(plan.hidden)) o.hidden = Boolean(edited.hidden);
  if (edited.order !== plan.order) {
    if (edited.order !== undefined) o.order = edited.order;
  }
  const limits: Partial<PlanLimits> = {};
  for (const key of ["seats", "customers", "activeProperties", "branches"] as const) {
    if (edited.limits[key] !== plan.limits[key]) (limits as Record<string, number | null>)[key] = edited.limits[key];
  }
  if (Object.keys(limits).length > 0) o.limits = limits;
  return o;
}

/**
 * Önerilen katalog ön ayarı (sahibin fiyatlandırma kararı): panelde tek tıkla uygulanır.
 * Yalnız mevcut sözleşmeli alanları değiştirir; ÖZELLİK listelerine yeni vaat eklenmez.
 * Mevcut abonelik kayıtları kendi tutarını korur; ön ayar yeni ödemeleri etkiler.
 * Not: veritabanı sınırları (plan_entitlements) paneldeki kayıt sırasında senkronlanır.
 */
export const RECOMMENDED_CATALOG_OVERRIDES: PlanOverrides = {
  advisor: { monthlyTry: 749 },
  office: {
    extraSeatMonthlyTry: 399,
    extraSeatTiers: [
      { fromSeat: 1, toSeat: 5, monthlyTry: 399 },
      { fromSeat: 6, toSeat: 15, monthlyTry: 349 },
      { fromSeat: 16, toSeat: null, monthlyTry: 299 },
    ],
    maxSeats: 20,
    seatRounding: "x9",
  },
  professional: {
    monthlyTry: 4990,
    extraSeatMonthlyTry: 349,
    extraSeatTiers: [
      { fromSeat: 1, toSeat: 10, monthlyTry: 349 },
      { fromSeat: 11, toSeat: null, monthlyTry: 299 },
    ],
    maxSeats: 40,
    seatRounding: "x9",
    limits: { seats: 15 },
    features: [
      "15 kullanıcıya kadar · 10 şube",
      "Kayıp-kaçak komisyon motoru",
      "Danışman KPI, lig ve hedefler",
      "Otomasyon, iş akışı ve onay akışları",
      "KVKK uyum ve ofisler arası ağ",
      "Öncelikli destek",
    ],
  },
  business: { monthlyTry: 8990, limits: { seats: 40 } },
  enterprise: { customPricing: true },
};

/** Kampanya aktifse ve plan için indirimli fiyat tanımlıysa o aylık fiyat; değilse liste fiyatı. */
export function effectiveMonthlyTry(def: PlanDef, campaign: Pick<PlanCampaignSettings, "active">, campaignOpen = true): number {
  if (campaign.active && campaignOpen && def.campaignMonthlyTry && def.campaignMonthlyTry > 0 && def.campaignMonthlyTry < def.monthlyTry) {
    return def.campaignMonthlyTry;
  }
  return def.monthlyTry;
}
