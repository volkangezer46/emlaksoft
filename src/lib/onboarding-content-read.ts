import { cache } from "react";
import { getSetting } from "@/lib/settings/read";
import { EMPTY_ONBOARDING_CONTENT, ONBOARDING_CONTENT_KEY, parseOnboardingContent, type OnboardingContent } from "@/lib/onboarding-content";

/**
 * Adminden düzenlenen tur/kurulum içeriğinin SUNUCU okuyucusu (ayar defteri platform anlık görüntüsü: 30 sn önbellek,
 * yazımda etiket tazelenir). Okuma hatası ya da bozuk değer = boş içerik → koddaki varsayılanlar (asla fırlatmaz).
 */
export const loadOnboardingContent = cache(async (): Promise<OnboardingContent> => {
  try {
    return parseOnboardingContent(await getSetting<string>(ONBOARDING_CONTENT_KEY));
  } catch {
    return EMPTY_ONBOARDING_CONTENT;
  }
});
