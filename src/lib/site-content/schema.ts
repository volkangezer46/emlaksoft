import { z } from "zod";
import { checkHref } from "@/lib/site-menu/schema";
import type { Issue } from "@/lib/site-menu/schema";

/**
 * Site içeriği (ana sayfa ve genel pazarlama metinleri): tür, sınırlar ve doğrulama.
 * Saf modül (sunucu ve istemci ortak). Yalnız DÜZ METİN: HTML/script girilemez; sınırlı biçim = satır sonu.
 * Fiyat, paket, kontor ve SEO meta alanları BURADA YOK (tek kaynakları /admin/billing/planlar ve /admin/seo).
 * Bağlantılar site menüsünün doğrulayıcısını (`checkHref`) kullanır: yalnız var olan yol, /#bölüm, http(s), mailto, tel.
 */

export const LIMITS = {
  eyebrow: 40,
  title: 90,
  em: 60,
  tail: 60,
  lead: 400,
  text: 320,
  badge: 60,
  cta: 40,
  href: 300,
  cardTitle: 60,
  cardText: 160,
  question: 160,
  answer: 900,
  chip: 40,
  note: 300,
  maxFaq: 20,
  maxList: 8,
  maxChecks: 6,
  /** Serileştirilmiş yapılandırma üst sınırı (bayt). */
  jsonBytes: 60 * 1024,
} as const;

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,29}$/, "Geçersiz kimlik.");
const text = (max: number, msg: string) => z.string().trim().max(max, `${msg} en fazla ${max} karakter olabilir.`);
const href = z.string().trim().max(LIMITS.href, "Bağlantı çok uzun.");

const headingSchema = z.strictObject({
  eyebrow: text(LIMITS.eyebrow, "Üst başlık"),
  title: text(LIMITS.title, "Başlık"),
  /** Renk geçişli vurgulu kısım (başlığın 1-3 kelimesi). */
  em: text(LIMITS.em, "Vurgulu kısım"),
  /** Vurgulu kısımdan sonra gelen metin. */
  tail: text(LIMITS.tail, "Başlık sonu"),
  text: text(LIMITS.lead, "Açıklama"),
});

const ctaSchema = z.strictObject({ label: text(LIMITS.cta, "Düğme metni"), href });
const checkSchema = z.strictObject({ id, text: text(LIMITS.cardText, "Madde"), hidden: z.boolean() });
const cardSchema = z.strictObject({ id, title: text(LIMITS.cardTitle, "Başlık"), text: text(LIMITS.cardText, "Açıklama"), href, hidden: z.boolean() });
const trustSchema = z.strictObject({ id, label: text(LIMITS.cardTitle, "Etiket"), href, hidden: z.boolean() });
const itemSchema = z.strictObject({ id, title: text(LIMITS.title, "Başlık"), text: text(LIMITS.text, "Açıklama"), hidden: z.boolean() });
const faqSchema = z.strictObject({ id, q: text(LIMITS.question, "Soru"), a: text(LIMITS.answer, "Cevap"), hidden: z.boolean() });

export const SECTION_KEYS = ["tur", "ozellikler", "diger", "neden", "nasil", "fiyat", "sss", "guvenlik"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

const sectionsShape = Object.fromEntries(SECTION_KEYS.map((k) => [k, headingSchema])) as Record<SectionKey, typeof headingSchema>;

export const siteContentSchema = z.strictObject({
  v: z.literal(1),
  hero: z.strictObject({
    badge: text(LIMITS.badge, "Rozet"),
    title: text(LIMITS.title, "Başlık"),
    em: text(LIMITS.em, "Vurgulu kısım"),
    tail: text(LIMITS.tail, "Başlık sonu"),
    lead: text(LIMITS.lead, "Açıklama"),
    primary: ctaSchema,
    secondary: ctaSchema,
    checks: z.array(checkSchema).max(LIMITS.maxChecks, `En fazla ${LIMITS.maxChecks} madde olabilir.`),
    /** EmlakFiyati entegrasyonu rozeti ve vurgu satırı (boş bırakılırsa gösterilmez). */
    integrationBadge: text(LIMITS.badge, "Entegrasyon rozeti"),
    integrationLine: text(240, "Vurgu satırı"),
  }),
  sections: z.strictObject(sectionsShape),
  valueCards: z.array(cardSchema).max(LIMITS.maxList),
  trust: z.array(trustSchema).max(LIMITS.maxList),
  highlights: z.array(itemSchema).max(LIMITS.maxList),
  steps: z.array(itemSchema).max(LIMITS.maxList),
  security: z.strictObject({
    chips: z.array(z.strictObject({ id, text: text(LIMITS.chip, "Etiket"), hidden: z.boolean() })).max(LIMITS.maxList),
    items: z.array(itemSchema).max(LIMITS.maxList),
    note: text(LIMITS.note, "Dipnot"),
  }),
  faq: z.array(faqSchema).max(LIMITS.maxFaq, `En fazla ${LIMITS.maxFaq} soru olabilir.`),
  finalCta: z.strictObject({
    title: text(LIMITS.title, "Başlık"),
    em: text(LIMITS.em, "Vurgulu kısım"),
    tail: text(LIMITS.tail, "Başlık sonu"),
    text: text(LIMITS.lead, "Açıklama"),
    primary: ctaSchema,
    secondary: ctaSchema,
    checks: z.array(checkSchema).max(LIMITS.maxChecks),
  }),
  valuation: z.strictObject({
    hidden: z.boolean(),
    eyebrow: text(LIMITS.eyebrow, "Üst başlık"),
    title: text(LIMITS.title, "Başlık"),
    em: text(LIMITS.em, "Vurgulu kısım"),
    tail: text(LIMITS.tail, "Başlık sonu"),
    text: text(LIMITS.lead, "Açıklama"),
    /** Somut, doğrulanabilir tanım (her zaman gösterilir). */
    claimConcrete: text(200, "Somut tanım"),
    /** "İlk ve tek" iddiası: ayrı cümle; KANITLANABİLİR OLMALI, tek tıkla kapatılabilir. */
    claim: z.strictObject({ text: text(80, "İddia"), hidden: z.boolean() }),
    points: z.array(itemSchema).max(LIMITS.maxList),
    compare: z.strictObject({
      beforeTitle: text(LIMITS.cardTitle, "Başlık"),
      before: z.array(checkSchema).max(LIMITS.maxChecks),
      afterTitle: text(LIMITS.cardTitle, "Başlık"),
      after: z.array(checkSchema).max(LIMITS.maxChecks),
    }),
    liveBadge: text(30, "Rozet"),
    soonBadge: text(30, "Rozet"),
    liveCta: ctaSchema,
    soonCta: ctaSchema,
    note: text(LIMITS.note, "Dipnot"),
  }),
  demo: z.strictObject({ title: text(LIMITS.title, "Başlık"), text: text(LIMITS.text, "Açıklama") }),
  register: z.strictObject({ title: text(LIMITS.title, "Başlık"), text: text(LIMITS.text, "Alt metin"), panelText: text(LIMITS.lead, "Yan panel metni") }),
});

export type SiteContent = z.infer<typeof siteContentSchema>;
export type Heading = z.infer<typeof headingSchema>;
export type Cta = z.infer<typeof ctaSchema>;
export type CheckItem = z.infer<typeof checkSchema>;
export type CardItem = z.infer<typeof cardSchema>;
export type TrustItem = z.infer<typeof trustSchema>;
export type TextItem = z.infer<typeof itemSchema>;
export type FaqItem = z.infer<typeof faqSchema>;

export function parseSiteContent(value: unknown): SiteContent | null {
  const r = siteContentSchema.safeParse(value);
  return r.success ? r.data : null;
}

// ---------------------------------------------------------------------------
// Anlamsal doğrulama: düz metin, bağlantılar, bilinmeyen değişkenler, riskli kelime uyarıları
// ---------------------------------------------------------------------------

/** Metin içinde kullanılabilen değişkenler ({deneme} gibi); değerleri sunucuda paket tanımlarından üretilir. */
export const CONTENT_TOKENS = ["deneme", "deneme_dene", "deneme_gun", "deneme_uzun", "yillik", "yillik_cumle", "yillik_metin", "ef_hak"] as const;

export const TOKEN_HELP: Record<(typeof CONTENT_TOKENS)[number], string> = {
  deneme: "“30 gün ücretsiz” (gün bilinmiyorsa “Ücretsiz”)",
  deneme_dene: "“30 gün ücretsiz dene”",
  deneme_gun: "“30 gün ” (gün bilinmiyorsa boş)",
  deneme_uzun: "“30 gün ücretsiz” (gün bilinmiyorsa “Ücretsiz deneme”)",
  yillik: "Yıllık teklif etiketi, ör. “10 öde 12 kullan” (teklif yoksa satır gizlenir)",
  yillik_cumle: "“Yıllık ödemede … .” cümlesi (teklif yoksa boş)",
  yillik_metin: "Yıllık teklif cümlesi (teklif yoksa genel bir cümle)",
  ef_hak: "Paket başına aylık değerleme sorgu hakkı, ör. “Ofis 20 · Profesyonel 50” (plan tanımından; yoksa satır gizlenir)",
};

const TOKEN_RE = /\{([a-z_]+)\}/g;

/** Riskli/abartılı vaat kelimeleri: UYARI verir, engellemez. Yerel küçük harfle (tr) karşılaştırılır. */
export const RISKY_WORDS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /ücretsiz/, label: "ücretsiz" },
  { re: /bedava/, label: "bedava" },
  { re: /%\s?100|yüzde yüz/, label: "%100" },
  { re: /garanti/, label: "garanti" },
  { re: /risk\s?siz/, label: "risksiz" },
  { re: /kesin(likle)?\b/, label: "kesin" },
  { re: /\ben iyi\b|\bbir numara|\b1 numara|\bbir numaralı/, label: "en iyi / bir numara" },
  { re: /sınırsız/, label: "sınırsız" },
  { re: /\bilk ve tek\b|türkiye.?de ilk|türkiye.?nin ilk|\btek sistem/, label: "ilk ve tek (kanıt gerekir)" },
  { re: /hiç(bir)? (risk|masraf|maliyet)/, label: "hiç risk/maliyet" },
];

export function riskyWordsIn(value: string): string[] {
  const t = value.replace(TOKEN_RE, " ").toLocaleLowerCase("tr");
  return RISKY_WORDS.filter((w) => w.re.test(t)).map((w) => w.label);
}

/** Tüm metin alanlarını (yol, değer) olarak dolaşır; bağlantı alanları ayrıca işaretlenir. */
export function collectStrings(cfg: SiteContent): Array<{ path: string; value: string; link: boolean; multiline: boolean }> {
  const out: Array<{ path: string; value: string; link: boolean; multiline: boolean }> = [];
  const walk = (node: unknown, path: string) => {
    if (typeof node === "string") {
      const key = path.split(".").pop() ?? "";
      out.push({ path, value: node, link: key === "href", multiline: ["lead", "text", "a", "panelText", "note"].includes(key) });
    } else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}.${i}`));
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) if (k !== "v") walk(v, path ? `${path}.${k}` : k);
  };
  walk(cfg, "");
  return out.map((o) => ({ ...o, path: o.path.replace(/^\./, "") }));
}

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function validateSiteContent(input: unknown): { config: SiteContent | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const parsed = siteContentSchema.safeParse(input);
  if (!parsed.success) {
    for (const i of parsed.error.issues) issues.push({ level: "error", path: i.path.join("."), message: i.message });
    return { config: null, issues };
  }
  const cfg = parsed.data;
  if (new TextEncoder().encode(JSON.stringify(cfg)).length > LIMITS.jsonBytes) {
    issues.push({ level: "error", path: "", message: "İçerik çok büyük; bazı metinleri kısaltın." });
  }

  const dupCheck = (list: Array<{ id: string }>, name: string) => {
    const s = new Set<string>();
    list.forEach((it, i) => {
      if (s.has(it.id)) issues.push({ level: "error", path: `${name}.${i}.id`, message: "Kimlik yinelendi; sayfayı yenileyip tekrar deneyin." });
      s.add(it.id);
    });
  };
  dupCheck(cfg.hero.checks, "hero.checks");
  dupCheck(cfg.valueCards, "valueCards");
  dupCheck(cfg.trust, "trust");
  dupCheck(cfg.highlights, "highlights");
  dupCheck(cfg.steps, "steps");
  dupCheck(cfg.security.chips, "security.chips");
  dupCheck(cfg.security.items, "security.items");
  dupCheck(cfg.faq, "faq");
  dupCheck(cfg.finalCta.checks, "finalCta.checks");
  dupCheck(cfg.valuation.points, "valuation.points");
  dupCheck(cfg.valuation.compare.before, "valuation.compare.before");
  dupCheck(cfg.valuation.compare.after, "valuation.compare.after");

  for (const s of collectStrings(cfg)) {
    if (s.link) {
      if (!s.value) {
        issues.push({ level: "error", path: s.path, message: "Bağlantı boş olamaz." });
        continue;
      }
      const r = checkHref(s.value);
      if (!r.ok) issues.push({ level: "error", path: s.path, message: r.message });
      else if (r.warn) issues.push({ level: "warn", path: s.path, message: r.warn });
      continue;
    }
    if (/[<>]/.test(s.value)) {
      issues.push({ level: "error", path: s.path, message: "HTML ve etiket girilemez; yalnız düz metin yazın (< ve > kullanılamaz)." });
      continue;
    }
    if (CONTROL_RE.test(s.value) || (!s.multiline && /[\r\n]/.test(s.value))) {
      issues.push({ level: "error", path: s.path, message: s.multiline ? "Geçersiz karakter var." : "Bu alanda satır sonu olamaz." });
      continue;
    }
    for (const m of s.value.matchAll(TOKEN_RE)) {
      if (!(CONTENT_TOKENS as readonly string[]).includes(m[1]!)) {
        issues.push({ level: "error", path: s.path, message: `Bilinmeyen değişken {${m[1]}}. Kullanılabilir: ${CONTENT_TOKENS.map((t) => `{${t}}`).join(" ")}` });
      }
    }
    const risky = riskyWordsIn(s.value);
    if (risky.length) issues.push({ level: "warn", path: s.path, message: `Riskli ifade: “${risky.join("”, “")}”. Mevcut paket ve koşullarla birebir doğru mu, kontrol edin (yayını engellemez).` });
  }

  if (!cfg.hero.title && !cfg.hero.em) issues.push({ level: "error", path: "hero.title", message: "Ana başlık boş olamaz." });
  if (!cfg.valuation.hidden && !cfg.valuation.title && !cfg.valuation.em) issues.push({ level: "error", path: "valuation.title", message: "Bölüm başlığı boş olamaz." });
  if (!cfg.valuation.liveCta.label) issues.push({ level: "error", path: "valuation.liveCta.label", message: "Düğme metni boş olamaz." });
  if (!cfg.valuation.soonCta.label) issues.push({ level: "error", path: "valuation.soonCta.label", message: "Düğme metni boş olamaz." });
  if (!cfg.hero.primary.label) issues.push({ level: "error", path: "hero.primary.label", message: "Düğme metni boş olamaz." });
  if (!cfg.hero.secondary.label) issues.push({ level: "error", path: "hero.secondary.label", message: "Düğme metni boş olamaz." });
  if (!cfg.finalCta.primary.label) issues.push({ level: "error", path: "finalCta.primary.label", message: "Düğme metni boş olamaz." });
  if (!cfg.finalCta.secondary.label) issues.push({ level: "error", path: "finalCta.secondary.label", message: "Düğme metni boş olamaz." });
  cfg.faq.forEach((f, i) => {
    if (!f.q) issues.push({ level: "error", path: `faq.${i}.q`, message: "Soru boş olamaz." });
    if (!f.a) issues.push({ level: "error", path: `faq.${i}.a`, message: "Cevap boş olamaz." });
  });
  if (cfg.faq.length > 0 && !cfg.faq.some((f) => !f.hidden)) issues.push({ level: "warn", path: "faq", message: "Hiç görünen soru yok; SSS bölümü boş kalır." });
  return { config: cfg, issues };
}

export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((i) => i.level === "error");
}

/** Taslak/canlı karşılaştırması (alan sırası değişmez: iki taraf da aynı şemadan gelir). */
export function sameContent(a: SiteContent | null, b: SiteContent | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
