import { z } from "zod";
import type { Issue } from "@/lib/site-menu/schema-core";
import { CONTENT_TOKENS } from "@/lib/site-content/schema-core";
import { PRICING_LIMITS, PRICING_TOKENS, type PricingPageContent } from "./schema-core";

export * from "./schema-core";

/**
 * /fiyatlar metin şeması (SAF; sunucu ve istemci ortak). Yalnız DÜZ METİN; bilinmeyen değişken HATADIR (sayfada
 * "{xyz}" görünmesin). Fiyat/limit/kapsam alanı YOKTUR (tek kaynak plan editörü ve sayfa kilitleri).
 */

const text = (max: number, label: string) => z.string().trim().max(max, `${label} en fazla ${max} karakter olabilir.`);
const req = (max: number, label: string) => text(max, label).min(1, `${label} boş olamaz.`);
const note = z.strictObject({ title: req(PRICING_LIMITS.noteTitle, "Kart başlığı"), text: req(PRICING_LIMITS.noteText, "Kart metni") });

export const pricingPageSchema = z.strictObject({
  hero: z.strictObject({
    eyebrow: text(PRICING_LIMITS.eyebrow, "Üst başlık"),
    title: req(PRICING_LIMITS.title, "Başlık"),
    lead: text(PRICING_LIMITS.lead, "Açıklama"),
  }),
  ctaPrimaryLabel: req(PRICING_LIMITS.label, "Birincil düğme"),
  compareLabel: req(PRICING_LIMITS.label, "Karşılaştır düğmesi"),
  notes: z.tuple([note, note, note]),
  sections: z.strictObject({
    compare: z.strictObject({ title: req(PRICING_LIMITS.sectionTitle, "Başlık"), lead: text(PRICING_LIMITS.sectionLead, "Açıklama") }),
    analiz: z.strictObject({ title: req(PRICING_LIMITS.sectionTitle, "Başlık") }),
    roi: z.strictObject({ title: req(PRICING_LIMITS.sectionTitle, "Başlık"), lead: text(PRICING_LIMITS.sectionLead, "Açıklama") }),
    faq: z.strictObject({ title: req(PRICING_LIMITS.sectionTitle, "Başlık") }),
    final: z.strictObject({
      title: req(PRICING_LIMITS.sectionTitle, "Başlık"),
      text: text(PRICING_LIMITS.sectionLead, "Metin"),
      primaryLabel: req(PRICING_LIMITS.label, "Düğme metni"),
    }),
  }),
  efText: z.strictObject({
    leadLive: text(PRICING_LIMITS.efText, "Açıklama (canlı)"),
    leadPlanned: text(PRICING_LIMITS.efText, "Açıklama (planlanan)"),
    creditsNote: text(PRICING_LIMITS.efText, "Bakiye notu"),
    packsNote: text(PRICING_LIMITS.efText, "Ek paket notu"),
  }),
  faq: z
    .array(z.strictObject({ q: req(PRICING_LIMITS.question, "Soru"), a: req(PRICING_LIMITS.answer, "Cevap") }))
    .max(PRICING_LIMITS.maxFaq, `En fazla ${PRICING_LIMITS.maxFaq} soru olabilir.`),
});

export function parsePricingPage(value: unknown): PricingPageContent | null {
  const r = pricingPageSchema.safeParse(value);
  return r.success ? (r.data as PricingPageContent) : null;
}

const TOKEN_RE = /\{([a-z_]+)\}/g;
const KNOWN = new Set<string>([...PRICING_TOKENS, ...CONTENT_TOKENS]);
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function walk(node: unknown, path: string, out: Array<{ path: string; value: string }>) {
  if (typeof node === "string") out.push({ path, value: node });
  else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}.${i}`, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, out);
}

/** Tam doğrulama: şema, bilinmeyen değişken ve denetim karakteri (hata); HTML etiketi (uyarı: düz yazı görünür). */
export function validatePricingPage(input: unknown): { config: PricingPageContent | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const parsed = pricingPageSchema.safeParse(input);
  if (!parsed.success) {
    for (const i of parsed.error.issues) issues.push({ level: "error", path: i.path.join("."), message: i.message });
    return { config: null, issues };
  }
  const config = parsed.data as PricingPageContent;
  const strings: Array<{ path: string; value: string }> = [];
  walk(config, "", strings);
  for (const s of strings) {
    if (CONTROL_RE.test(s.value)) issues.push({ level: "error", path: s.path, message: "Görünmez denetim karakteri var; metni yeniden yazın." });
    for (const m of s.value.matchAll(TOKEN_RE)) {
      if (!KNOWN.has(m[1]!)) issues.push({ level: "error", path: s.path, message: `Bilinmeyen değişken: {${m[1]}}` });
    }
    if (/<\s*\/?\s*[a-z!]/i.test(s.value)) issues.push({ level: "warn", path: s.path, message: "HTML etiketi işlenmez; metin olduğu gibi (düz yazı) görünür." });
  }
  const bytes = new TextEncoder().encode(JSON.stringify(config)).length;
  if (bytes > PRICING_LIMITS.jsonBytes) issues.push({ level: "error", path: "", message: "Metinler çok uzun; kısaltın." });
  return { config, issues };
}
