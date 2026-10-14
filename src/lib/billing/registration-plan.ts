import {
  isPlanId,
  normalizePlanId,
  planTierOf,
  type CatalogPlanId,
  type PlanDef,
  type PlanId,
} from "@/lib/billing/plans";

/**
 * Ekip büyüklüğü bandı = ÖDEME PLANININ TABANI (kayıt RPC'si ve DB CHECK'i bu dört değeri sabitler; değerler değişmez).
 * Bant paketin ÜST sınırı değildir: paketler ek kullanıcıyla kendi tavanına kadar büyür (plans.ts PLAN_USER_CAPS: 3/15/50/500);
 * bu yüzden kayıt eylemi seçilen planı yalnız bandın tabanının ALTINA düşürmez, üstünü korur.
 *   "1"     -> Danışman (1 kullanıcı dahil)
 *   "2-10"  -> Ofis (5 dahil, en fazla 15)
 *   "10-50" -> Profesyonel (15 dahil, en fazla 50); hesaplayıcı 50'ye yaklaşınca Kurumsal'ı (50 dahil) daha ucuzsa önerir
 *   "50+"   -> Kurumsal Operasyon (50 kullanıcı dahil taban, 500'e kadar)
 * Hesaplayıcı önerisi (seat-calculator-model.computeSeatCalc) her zaman bandın tabanından düşük olmayan plandır.
 */
export const REGISTRATION_TEAM_SIZES = ["1", "2-10", "10-50", "50+"] as const;

export type RegistrationTeamSize = (typeof REGISTRATION_TEAM_SIZES)[number];

const DEFAULT_TEAM_SIZE: RegistrationTeamSize = "2-10";

const MINIMUM_PLAN_BY_TEAM_SIZE: Record<RegistrationTeamSize, PlanId> = {
  "1": "advisor",
  "2-10": "office",
  "10-50": "professional",
  "50+": "enterprise",
};

const PLAN_RANK: Record<PlanId, number> = {
  advisor: 0,
  office: 1,
  professional: 2,
  business: 3,
  enterprise: 4,
};

export function normalizeRegistrationTeamSize(value: string): RegistrationTeamSize {
  return REGISTRATION_TEAM_SIZES.includes(value as RegistrationTeamSize)
    ? (value as RegistrationTeamSize)
    : DEFAULT_TEAM_SIZE;
}

export function minimumPlanForTeamSize(teamSize: RegistrationTeamSize): PlanId {
  return MINIMUM_PLAN_BY_TEAM_SIZE[teamSize];
}

/** Kayıtta seçilebilir katalog paketi (eklenen paket için): gizli/arşivli olmayan, kademesi bilinen. */
export type RegistrationCatalogPlan = Pick<PlanDef, "id" | "tier" | "custom" | "hidden" | "archived">;

/**
 * Keeps an intentional higher-tier pricing selection, but never provisions a
 * plan below the capacity implied by the registration team-size answer.
 * Adminden eklenen paket (`catalog` verilirse) yayında ve kademesi bandın tabanından düşük değilse korunur.
 */
export function registrationPlanForTeamSize(
  requestedPlan: string | null | undefined,
  teamSize: RegistrationTeamSize,
  catalog: readonly RegistrationCatalogPlan[] = [],
): CatalogPlanId {
  const minimumPlan = minimumPlanForTeamSize(teamSize);
  if (requestedPlan && !isPlanId(requestedPlan)) {
    const def = catalog.find((p) => p.id === requestedPlan && p.custom && !p.hidden && !p.archived);
    if (def) return PLAN_RANK[planTierOf(def)] >= PLAN_RANK[minimumPlan] ? def.id : minimumPlan;
  }
  const normalizedPlan = normalizePlanId(requestedPlan, minimumPlan);

  return PLAN_RANK[normalizedPlan] >= PLAN_RANK[minimumPlan]
    ? normalizedPlan
    : minimumPlan;
}

/** Paketin kayıt bandı; eklenen pakette (taban olmayan kimlik) `tier` kademesinin bandı. */
export function defaultTeamSizeForPlan(planId: CatalogPlanId, tier?: PlanId | null): RegistrationTeamSize {
  const base: PlanId = isPlanId(planId) ? planId : (tier ?? "office");
  // Gizli Business (40 kullanıcıya kadar) Profesyonel ile Kurumsal arasındadır: taban "10-50" (Profesyonel).
  if (base === "business") return "10-50";
  return (
    Object.entries(MINIMUM_PLAN_BY_TEAM_SIZE).find(([, plan]) => plan === base)?.[0] as
      | RegistrationTeamSize
      | undefined
  ) ?? DEFAULT_TEAM_SIZE;
}
