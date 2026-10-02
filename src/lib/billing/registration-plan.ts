import {
  normalizePlanId,
  type PlanId,
} from "@/lib/billing/plans";

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
  enterprise: 3,
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
  return (
    Object.entries(MINIMUM_PLAN_BY_TEAM_SIZE).find(([, plan]) => plan === planId)?.[0] as
      | RegistrationTeamSize
      | undefined
  ) ?? DEFAULT_TEAM_SIZE;
}
