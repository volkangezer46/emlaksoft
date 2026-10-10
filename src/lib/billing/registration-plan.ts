import {
  normalizePlanId,
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

/**
 * Keeps an intentional higher-tier pricing selection, but never provisions a
 * plan below the capacity implied by the registration team-size answer.
 */
export function registrationPlanForTeamSize(
  requestedPlan: string | null | undefined,
  teamSize: RegistrationTeamSize,
): PlanId {
  const minimumPlan = minimumPlanForTeamSize(teamSize);
  const normalizedPlan = normalizePlanId(requestedPlan, minimumPlan);

  return PLAN_RANK[normalizedPlan] >= PLAN_RANK[minimumPlan]
    ? normalizedPlan
    : minimumPlan;
}

export function defaultTeamSizeForPlan(planId: PlanId): RegistrationTeamSize {
  // Gizli Business (40 kullanıcıya kadar) Profesyonel ile Kurumsal arasındadır: taban "10-50" (Profesyonel).
  if (planId === "business") return "10-50";
  return (
    Object.entries(MINIMUM_PLAN_BY_TEAM_SIZE).find(([, plan]) => plan === planId)?.[0] as
      | RegistrationTeamSize
      | undefined
  ) ?? DEFAULT_TEAM_SIZE;
}
