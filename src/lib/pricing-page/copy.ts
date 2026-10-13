import { yearlyOfferLabel, type PlanDef } from "@/lib/billing/plans";
import { buildFaq, contractPlanName, lostCommissionPlanName, trialPhrase, uniformYearlyDiscount, yearlyDiscountPercent, type FaqItem } from "@/lib/pricing-page-model";
import { resolveTokens } from "@/lib/site-content/tokens";
import { PRICING_TOKENS, type PricingPageContent, type PricingToken } from "./schema-core";

/**
 * /fiyatlar metinlerini değişkenlerden çözer (SAF). Önce /fiyatlar'a özgü değişkenler ({indirim}, {kayip_paket} ...),
 * sonra ana sayfanın değişken çözücüsü (site-content/tokens: {deneme} {yillik} {ef_hak} ...). Değerler yalnız paket
 * tanımlarından ve sayfa kilitlerinden gelir; burada gün/oran/tutar yazılmaz.
 *
 * Metin PARÇA listesi olarak da döner: sayfa, değişkenli metni eskiden JSX'te `{değer} metin` diye bastığı yerlerde
 * aynı metin düğümlerini üretir; yayın yokken /fiyatlar HTML'i birebir aynı kalır.
 */

export type PricingCopyContext = { trialDays?: number; plans: readonly PlanDef[]; efLive?: boolean };

const TOKEN_SPLIT = /(\{[a-z_]+\})/;
const SENTINEL = "\u0001";

export function pricingTokenValues(ctx: PricingCopyContext): Record<PricingToken, string | null> {
  const discount = yearlyDiscountPercent(ctx.plans);
  const first = ctx.plans[0];
  return {
    deneme_ifade: trialPhrase(ctx.trialDays),
    baslat: ctx.trialDays ? `${ctx.trialDays} gün ücretsiz başla` : "Ücretsiz başla",
    indirim: discount > 0 ? (uniformYearlyDiscount(ctx.plans) ? `%${discount}` : `en az %${discount}`) : null,
    indirim_cumle: discount > 0 && first ? `; yıllık ödemede %${discount} indirim uygulanır (${yearlyOfferLabel(first)}).` : ".",
    kayip_paket: lostCommissionPlanName(),
    sozlesme_paket: contractPlanName(),
  };
}

/** Tek değişkenin değeri: undefined = bilinmeyen (olduğu gibi kalır), null = şu an değeri yok. */
function tokenValue(name: string, ctx: PricingCopyContext, own: Record<PricingToken, string | null>): string | null | undefined {
  if ((PRICING_TOKENS as readonly string[]).includes(name)) return own[name as PricingToken];
  // Ana sayfa çözücüsü sonucu kırpar; değerin kendi boşluğu ("14 gün ") korunsun diye sınır işaretiyle çözülür.
  const r = resolveTokens(`${SENTINEL}{${name}}${SENTINEL}`, ctx);
  const v = r.text.split(SENTINEL).join("");
  if (r.missing) return null;
  return v === `{${name}}` ? undefined : v;
}

export type Resolved = { parts: string[]; text: string; missing: boolean };

/** Metni çözer: boş olmayan parçalar (değişken değerleri ayrı parça) ve birleşik metin. */
export function resolvePricingText(template: string, ctx: PricingCopyContext, own = pricingTokenValues(ctx)): Resolved {
  let missing = false;
  const parts: string[] = [];
  for (const seg of template.split(TOKEN_SPLIT)) {
    if (!seg) continue;
    const m = /^\{([a-z_]+)\}$/.exec(seg);
    if (!m) {
      parts.push(seg);
      continue;
    }
    const v = tokenValue(m[1]!, ctx, own);
    if (v === undefined) parts.push(seg);
    else if (v === null) missing = true;
    else if (v) parts.push(v);
  }
  return { parts, text: parts.join(""), missing };
}

export type PricingCopy = {
  hero: { eyebrow: string; title: string; lead: string[] };
  ctaPrimaryLabel: string[];
  compareLabel: string;
  notes: Array<{ title: string; text: string[] }>;
  sections: {
    compare: { title: string; lead: string };
    analiz: { title: string };
    roi: { title: string; lead: string };
    faq: { title: string };
    final: { title: string; text: string[]; primaryLabel: string };
  };
  efText: { leadLive: string; leadPlanned: string; creditsNote: string; packsNote: string };
  faq: FaqItem[];
};

/** SSS: değişkeni şu an değersiz olan madde (ör. indirim yokken indirim sorusu) gizlenir. */
export function resolvePricingFaq(items: PricingPageContent["faq"], ctx: PricingCopyContext): FaqItem[] {
  const own = pricingTokenValues(ctx);
  const out: FaqItem[] = [];
  for (const it of items) {
    const q = resolvePricingText(it.q, ctx, own);
    const a = resolvePricingText(it.a, ctx, own);
    if (q.missing || a.missing || !q.text || !a.text) continue;
    out.push({ q: q.text, a: a.text });
  }
  return out;
}

/**
 * Sayfada basılacak metinler. `content` null ise (hiç yayın yok) bugünkü varsayılan metinler kullanılır ve SSS
 * doğrudan `buildFaq` ile üretilir: yayın yokken /fiyatlar çıktısı eskisiyle birebir aynıdır.
 */
export function pricingCopy(content: PricingPageContent, ctx: PricingCopyContext, opts: { faqFromCode?: boolean } = {}): PricingCopy {
  const own = pricingTokenValues(ctx);
  const r = (t: string) => resolvePricingText(t, ctx, own);
  const s = content.sections;
  return {
    hero: { eyebrow: r(content.hero.eyebrow).text, title: r(content.hero.title).text, lead: r(content.hero.lead).parts },
    ctaPrimaryLabel: r(content.ctaPrimaryLabel).parts,
    compareLabel: r(content.compareLabel).text,
    notes: content.notes.map((n) => ({ title: r(n.title).text, text: r(n.text).parts })),
    sections: {
      compare: { title: r(s.compare.title).text, lead: r(s.compare.lead).text },
      analiz: { title: r(s.analiz.title).text },
      roi: { title: r(s.roi.title).text, lead: r(s.roi.lead).text },
      faq: { title: r(s.faq.title).text },
      final: { title: r(s.final.title).text, text: r(s.final.text).parts, primaryLabel: r(s.final.primaryLabel).text },
    },
    efText: {
      leadLive: r(content.efText.leadLive).text,
      leadPlanned: r(content.efText.leadPlanned).text,
      creditsNote: r(content.efText.creditsNote).text,
      packsNote: r(content.efText.packsNote).text,
    },
    faq: opts.faqFromCode ? buildFaq({ trialDays: ctx.trialDays, plans: ctx.plans }) : resolvePricingFaq(content.faq, ctx),
  };
}
