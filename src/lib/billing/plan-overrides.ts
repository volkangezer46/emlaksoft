import { PLANS, type PlanDef, type PlanId, type PlanLimits } from "@/lib/billing/plans";

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
} as const;

export type PlanOverride = {
  name?: string;
  monthlyTry?: number;
  blurb?: string;
  eyebrow?: string;
  popular?: boolean;
  features?: string[];
  limits?: Partial<PlanLimits>;
};

export type PlanOverrides = Partial<Record<PlanId, PlanOverride>>;

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

export function parsePlanOverrides(raw: string | null | undefined): PlanOverrides {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { plans?: Record<string, unknown> };
    const out: PlanOverrides = {};
    for (const plan of PLANS) {
      const o = sanitizePlanOverride(parsed?.plans?.[plan.id]);
      if (Object.keys(o).length > 0) out[plan.id] = o;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializePlanOverrides(overrides: PlanOverrides): string {
  return JSON.stringify({ v: 1, plans: overrides });
}

/** plans.ts varsayılanı + düzenleme = etkin tanımlar. Aynı anda en fazla bir "popüler" paket kalır. */
export function applyPlanOverrides(overrides: PlanOverrides, base: readonly PlanDef[] = PLANS): PlanDef[] {
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
    return next;
  });
  let seen = false;
  return merged.map((plan) => {
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
  const limits: Partial<PlanLimits> = {};
  for (const key of ["seats", "customers", "activeProperties", "branches"] as const) {
    if (edited.limits[key] !== plan.limits[key]) (limits as Record<string, number | null>)[key] = edited.limits[key];
  }
  if (Object.keys(limits).length > 0) o.limits = limits;
  return o;
}
