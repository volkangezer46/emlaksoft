import { CONTENT_TOKENS, TOKEN_HELP } from "@/lib/site-content/schema-core";

/**
 * /fiyatlar metinleri: zod'suz çekirdek (istemci editörü içe aktarır; şema/doğrulayıcı schema.ts'te).
 * Fiyat SAYILARI burada YOK: tutar, limit ve paket kapsamı plan editöründen (/admin/billing/planlar) gelmeye devam eder.
 * Metinlerde değişken kullanılır; değerler sunucuda paket tanımlarından üretilir (copy.ts).
 */

export const PRICING_LIMITS = {
  eyebrow: 40,
  title: 120,
  lead: 400,
  label: 60,
  noteTitle: 80,
  noteText: 300,
  sectionTitle: 120,
  sectionLead: 400,
  efText: 600,
  question: 160,
  answer: 900,
  maxFaq: 20,
  /** Serileştirilmiş yapılandırma üst sınırı (bayt). */
  jsonBytes: 60 * 1024,
} as const;

export type PricingNote = { title: string; text: string };
export type PricingFaqItem = { q: string; a: string };

export type PricingPageContent = {
  hero: { eyebrow: string; title: string; lead: string };
  /** Üst banttaki birincil düğme. */
  ctaPrimaryLabel: string;
  /** "Paketleri karşılaştır" düğmesi (üst bant ve son çağrı). */
  compareLabel: string;
  /** "Bilmeniz gerekenler" üç kartı (simgeler sabit: deneme, imza, kayıp-kaçak). */
  notes: [PricingNote, PricingNote, PricingNote];
  sections: {
    compare: { title: string; lead: string };
    analiz: { title: string };
    roi: { title: string; lead: string };
    faq: { title: string };
    final: { title: string; text: string; primaryLabel: string };
  };
  /** EmlakFiyati analiz bakiyesi bölümü metinleri (canlı / planlanan durum ayrı). */
  efText: { leadLive: string; leadPlanned: string; creditsNote: string; packsNote: string };
  faq: PricingFaqItem[];
};

/** Yalnız /fiyatlar'a özgü değişkenler (ana sayfa değişkenleri de kullanılabilir: {deneme} {yillik} {ef_hak} ...). */
export const PRICING_TOKENS = ["deneme_ifade", "baslat", "indirim", "indirim_cumle", "kayip_paket", "sozlesme_paket"] as const;
export type PricingToken = (typeof PRICING_TOKENS)[number];

export const PRICING_TOKEN_HELP: Record<PricingToken, string> = {
  deneme_ifade: "“14 gün ücretsiz deneme” (gün bilinmiyorsa “Ücretsiz deneme”)",
  baslat: "“14 gün ücretsiz başla” (gün bilinmiyorsa “Ücretsiz başla”)",
  indirim: "Yıllık indirim oranı, ör. “%17” (paketler farklıysa “en az %17”; indirim yoksa SSS maddesi gizlenir)",
  indirim_cumle: "“; yıllık ödemede %17 indirim uygulanır (10 öde 12 kullan).” (indirim yoksa yalnız “.”)",
  kayip_paket: "Kayıp-kaçak motorunun asgari paketi (sayfa kilidinden)",
  sozlesme_paket: "Sözleşme özelliğinin asgari paketi (sayfa kilidinden)",
};

/** Editörde gösterilecek tüm değişkenler: /fiyatlar'a özgü olanlar + ana sayfa değişkenleri. */
export const ALL_PRICING_TOKENS: ReadonlyArray<{ name: string; help: string }> = [
  ...PRICING_TOKENS.map((name) => ({ name, help: PRICING_TOKEN_HELP[name] })),
  ...CONTENT_TOKENS.map((name) => ({ name, help: TOKEN_HELP[name] })),
];

export function samePricing(a: PricingPageContent | null, b: PricingPageContent | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
