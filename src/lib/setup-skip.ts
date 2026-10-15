import { ONBOARDING_STEP_IDS, isOnboardingStepId, type OnboardingStepId } from "@/lib/onboarding-steps";
import { isUiStateKey, type UiState } from "@/lib/ui-state";

/**
 * Kurulum sihirbazında "sonra yaparım" denen adımlar.
 *
 * KALICI kaynak profildir (`profiles.ui_state`, yazma yalnız `markUiState` → `profile_ui_state_mark`; YD5 deseni,
 * cihazlar arası). İşaret yazılınca değişmez (RPC aynı anahtarı ezmez); bu yüzden her değişiklik yeni bir SAYAÇLI anahtar
 * yazar: `nudge:kurulum-<adım>-<n>`. Adımın en büyük `n`'i TEK ise adım atlanmış, ÇİFT ise atlama geri alınmıştır.
 * Çerez (eski kayıt) yalnız profilde hiç kurulum işareti yokken (eski tercih / sütun yok) yedek olarak okunur.
 */
export const SETUP_SKIP_COOKIE_PREFIX = "es_kurulum_atla_";
export const WELCOME_DONE_COOKIE_PREFIX = "es_hosgeldin_";
export const SETUP_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Profil işaret öneki (`nudge:` ad alanı; desen `ui-state.ts` ile aynı). */
export const SETUP_SKIP_UI_PREFIX = "nudge:kurulum-";

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

/** Adımın profildeki en büyük sayaç değeri (hiç işaret yoksa 0). */
function skipCounter(state: UiState, id: OnboardingStepId): number {
  const prefix = `${SETUP_SKIP_UI_PREFIX}${id}-`;
  let max = 0;
  for (const key of Object.keys(state)) {
    if (!key.startsWith(prefix)) continue;
    const n = Number(key.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}

/**
 * Geçerli "sonra yaparım" listesi, adım adım: profilde işareti olan adımda profil (en büyük sayaç tek mi), olmayan adımda
 * çerez (eski kayıt) geçerlidir. Profil okunamazsa (`null`) yalnız çerez.
 */
export function resolveSkipped(state: UiState | null, cookieSkipped: readonly OnboardingStepId[]): OnboardingStepId[] {
  return ONBOARDING_STEP_IDS.filter((id) => {
    const counter = state ? skipCounter(state, id) : 0;
    return counter > 0 ? counter % 2 === 1 : cookieSkipped.includes(id);
  });
}

/**
 * Tercihi profile yazmak için sıradaki işaret anahtarı; adım zaten istenen durumdaysa null (yazma gerekmez).
 * `cookieSkipped`: profilde kayıt yokken çerezde atlanmış adımın geri alınması da sayaçla yazılır.
 */
export function nextSkipUiKey(
  state: UiState | null,
  id: OnboardingStepId,
  skip: boolean,
  cookieSkipped: readonly OnboardingStepId[] = [],
): string | null {
  const counter = state ? skipCounter(state, id) : 0;
  const current = counter > 0 ? counter % 2 === 1 : cookieSkipped.includes(id);
  if (current === skip) {
    // Profilde kayıt yokken çerezdeki tercih profile ilk kez taşınır (aynı durumda bile tek işaret).
    if (counter > 0 || !skip) return null;
  }
  // Sayaç: atlandı = tek, geri alındı = çift.
  let n = counter + 1;
  if ((n % 2 === 1) !== skip) n += 1;
  const key = `${SETUP_SKIP_UI_PREFIX}${id}-${n}`;
  return isUiStateKey(key) ? key : null;
}
