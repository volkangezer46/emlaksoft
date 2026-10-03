import { isOnboardingStepId, type OnboardingStepId } from "@/lib/onboarding-checklist";

/**
 * Kurulum sihirbazında "sonra yaparım" denen adımlar — kullanıcı tercihi çerezi (yeni şema yok).
 * Çerez adı kullanıcıya özeldir; değer virgülle ayrılmış adım kimlikleridir.
 */
export const SETUP_SKIP_COOKIE_PREFIX = "es_kurulum_atla_";
export const WELCOME_DONE_COOKIE_PREFIX = "es_hosgeldin_";
export const SETUP_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function setupSkipCookieName(userId: string): string {
  return `${SETUP_SKIP_COOKIE_PREFIX}${userId}`;
}

export function welcomeDoneCookieName(userId: string): string {
  return `${WELCOME_DONE_COOKIE_PREFIX}${userId}`;
}

export function parseSkipped(raw: string | null | undefined): OnboardingStepId[] {
  if (!raw) return [];
  const out: OnboardingStepId[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (isOnboardingStepId(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

export function serializeSkipped(ids: readonly OnboardingStepId[]): string {
  return [...new Set(ids)].join(",");
}

export function toggleSkipped(
  current: readonly OnboardingStepId[],
  id: OnboardingStepId,
  skip: boolean,
): OnboardingStepId[] {
  const without = current.filter((x) => x !== id);
  return skip ? [...without, id] : without;
}
