import { trialCtaMobileLabel } from "@/lib/marketing-copy";
import { defaultSiteContent } from "./defaults";
import { heroMobileLead, type SiteContent } from "./schema";
import { resolveTokens, tx, type TokenContext } from "./tokens";

/**
 * Mobil (< 768 px) hero metinleri. Saf modül.
 *
 * Kural: kısa varyant YALNIZ yönetimdeki metin varsayılan haldeyken kullanılır; yönetici bir metni değiştirdiyse telefonda da
 * onun yazdığı görünür (kod, yöneticinin metnini sessizce ezmez).
 *  - açıklama: `hero.mobileLead` (boşsa uzun açıklamanın ilk cümlesi)
 *  - birincil düğme: etiket `{deneme_dene}` ise `trialCtaMobileLabel` ("Ücretsiz dene — 14 gün")
 *  - ikinci düğme: varsayılan "Paketleri ve fiyatları gör" ise "Paketleri gör" (metin bağlantısı olarak çizilir)
 *  - güven maddeleri: varsayılan metindeki üç madde "Kartsız · Tüm özellikler · Taahhüt yok"
 */
export const HERO_MOBILE_SHORT = {
  secondary: "Paketleri gör",
  checks: { kart: "Kartsız", ozellik: "Tüm özellikler", taahhut: "Taahhüt yok" } as Record<string, string>,
} as const;

export type HeroMobileCopy = {
  lead: string;
  primary: string;
  secondary: string;
  /** Görünür maddeler: `text` masaüstü metni, `short` mobil metni (aynıysa tek metin çizilir). */
  checks: Array<{ id: string; text: string; short: string }>;
};

export function heroMobileCopy(hero: SiteContent["hero"], ctx: TokenContext): HeroMobileCopy {
  const base = defaultSiteContent().hero;
  const defaultCheck = new Map(base.checks.map((c) => [c.id, c.text]));
  const secondaryIsDefault = hero.secondary.label.trim() === base.secondary.label && hero.secondary.href.trim() === base.secondary.href;
  return {
    lead: tx(heroMobileLead(hero), ctx),
    primary: hero.primary.label.trim() === "{deneme_dene}" ? trialCtaMobileLabel(ctx.trialDays) : tx(hero.primary.label, ctx),
    secondary: secondaryIsDefault ? HERO_MOBILE_SHORT.secondary : tx(hero.secondary.label, ctx),
    checks: hero.checks
      .filter((c) => !c.hidden)
      .map((c) => ({ id: c.id, ...resolveTokens(c.text, ctx), raw: c.text }))
      .filter((c) => !c.missing)
      .map((c) => {
        const short = defaultCheck.get(c.id) === c.raw.trim() ? HERO_MOBILE_SHORT.checks[c.id] : undefined;
        return { id: c.id, text: c.text, short: short ?? c.text };
      }),
  };
}
