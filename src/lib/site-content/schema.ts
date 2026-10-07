import { z } from "zod";
import { checkHref } from "@/lib/site-menu/schema";
import type { Issue } from "@/lib/site-menu/schema";
import { HOME_ANCHORS } from "@/lib/site-menu/known-routes";
import { defaultSiteContent } from "./defaults";

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
  mobileLead: 140,
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
  maxTour: 7,
  maxBento: 8,
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

/** Paket rozeti yolu: boş (rozet yok) veya /app altındaki sayfa yolu (rozet sayfa kilidinden `gateBadge` ile üretilir). */
const gate = z.string().trim().max(80).regex(/^$|^\/app(\/[a-z0-9-]+)*$/, "Paket rozeti yolu boş ya da /app/... biçiminde olmalı.");
const pointSchema = z.strictObject({ id, text: text(LIMITS.cardText, "Madde"), gate, hidden: z.boolean() });

/** Ürün turu ekranları: kimlik ekran çizimini seçer (sabit küme; eklenip silinmez, sıralanır/gizlenir). */
export const TOUR_SCREEN_IDS = ["bugun", "musteriler", "portfoy", "anlasmalar", "komisyon", "raporlar", "otomasyon"] as const;
/** Özellik ızgarası kartları: kimlik illüstrasyonu, ızgara yerleşimini ve paket rozetini seçer (sabit küme). */
export const BENTO_TILE_IDS = ["kayip-kacak", "emsal-degerleme", "otomasyon", "ai-asistan", "portal-kontrol", "imza", "vitrin", "performans"] as const;

/**
 * Ana sayfa bölüm düzeni (hero her zaman ilk; sırası/görünürlüğü yönetilmez). Kimlik = bölüm. Eski yayınlarda eksik
 * kalan kimlik `parseSiteContent` ile sona eklenir (yeni bölüm sessizce kaybolmaz).
 */
export const LANDING_SECTIONS = [
  { id: "deger", label: "Değer kartları (hero altı)" },
  { id: "guven", label: "Güven şeridi" },
  { id: "tur", label: "Ürün turu" },
  { id: "ozellikler", label: "Özellik ızgarası (bento)" },
  { id: "degerleme", label: "Değerleme (EmlakFiyati)" },
  { id: "emlakfiyati", label: "EmlakFiyati kontör bölümü" },
  { id: "diger", label: "Ayrıntılar" },
  { id: "neden", label: "Neden EmlakSoft (karşılaştırma)" },
  { id: "nasil", label: "Nasıl çalışır" },
  { id: "guvenlik", label: "Güvenlik ve KVKK" },
  { id: "fiyat", label: "Fiyatlar" },
  { id: "sss", label: "Sık sorulan sorular" },
  { id: "son", label: "Son çağrı" },
] as const;
export type LandingSectionId = (typeof LANDING_SECTIONS)[number]["id"];
const LANDING_IDS = LANDING_SECTIONS.map((s) => s.id) as [LandingSectionId, ...LandingSectionId[]];

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
    /** Mobil (< 768 px) tek cümle açıklama; boşsa `lead`in ilk cümlesi (`heroMobileLead`). Tek satır alan. */
    mobileLead: text(LIMITS.mobileLead, "Mobil açıklama"),
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
  /** Ürün turu sekmeleri (kimlik = ekran çizimi). */
  tour: z
    .array(
      z.strictObject({
        id: z.enum(TOUR_SCREEN_IDS),
        label: text(30, "Sekme adı"),
        text: text(LIMITS.cardText, "Açıklama"),
        points: z.array(pointSchema).max(LIMITS.maxChecks),
        hidden: z.boolean(),
      }),
    )
    .max(LIMITS.maxTour),
  /** Özellik ızgarası kartları (kimlik = illüstrasyon + yerleşim + paket rozeti). */
  bento: z.strictObject({
    tiles: z
      .array(
        z.strictObject({
          id: z.enum(BENTO_TILE_IDS),
          eyebrow: text(LIMITS.eyebrow, "Üst başlık"),
          title: text(LIMITS.title, "Başlık"),
          text: text(LIMITS.text, "Açıklama"),
          points: z.array(checkSchema).max(LIMITS.maxChecks),
          hidden: z.boolean(),
        }),
      )
      .max(LIMITS.maxBento),
    note: text(LIMITS.note, "Dipnot"),
  }),
  /** "Neden EmlakSoft" karşılaştırma tablosu (rakip adı yazılmaz). */
  why: z.strictObject({
    oldLabel: text(LIMITS.cardTitle, "Eski yöntem sütunu"),
    newLabel: text(LIMITS.cardTitle, "EmlakSoft sütunu"),
    rows: z
      .array(
        z.strictObject({
          id,
          topic: text(LIMITS.cardTitle, "Konu"),
          old: text(LIMITS.cardText, "Eski yöntem"),
          now: text(LIMITS.cardText, "EmlakSoft ile"),
          gate,
          hidden: z.boolean(),
        }),
      )
      .max(LIMITS.maxList),
    note: text(LIMITS.note, "Dipnot"),
  }),
  /** EmlakFiyati kontör bölümü metinleri (sayılar plan/tarife/paket kataloğundan gelir; burada sayı yazılmaz). */
  efSection: z.strictObject({
    eyebrow: text(LIMITS.eyebrow, "Üst başlık"),
    title: text(LIMITS.title, "Başlık"),
    em: text(LIMITS.em, "Vurgulu kısım"),
    tail: text(LIMITS.tail, "Başlık sonu"),
    liveText: text(LIMITS.lead, "Canlıyken açıklama"),
    soonText: text(LIMITS.lead, "Canlı değilken açıklama"),
    steps: z.array(itemSchema).max(LIMITS.maxChecks),
    plansTitle: text(LIMITS.title, "Paket kontörü başlığı"),
    plansNote: text(LIMITS.note, "Paket kontörü dipnotu"),
    packsTitle: text(LIMITS.title, "Ek paket başlığı"),
    packsText: text(LIMITS.text, "Ek paket açıklaması"),
    packsEmpty: text(LIMITS.text, "Paket yokken metin"),
    detailLink: ctaSchema,
    note: text(LIMITS.note, "Dipnot"),
  }),
  /** Bölüm sırası ve görünürlüğü (hero sabit, ilk). */
  layout: z.array(z.strictObject({ id: z.enum(LANDING_IDS), hidden: z.boolean() })).max(LANDING_SECTIONS.length),
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

export type TourItem = SiteContent["tour"][number];
export type BentoTile = SiteContent["bento"]["tiles"][number];
export type WhyRow = SiteContent["why"]["rows"][number];
export type LayoutItem = SiteContent["layout"][number];

/** Sonradan eklenen üst düzey anahtarlar: eski yayında yoksa varsayılandan doldurulur (yayın kaybolmaz). */
const LATER_KEYS = ["tour", "bento", "why", "efSection", "layout"] as const;

/** Düzen listesi: bilinmeyen/yinelenen kimlik atılır, eksik bölüm sona (görünür) eklenir. Saf. */
export function normalizeLayout(list: ReadonlyArray<{ id?: unknown; hidden?: unknown }>): LayoutItem[] {
  const seen = new Set<string>();
  const out: LayoutItem[] = [];
  for (const it of list) {
    const k = typeof it?.id === "string" ? it.id : "";
    if (!(LANDING_IDS as readonly string[]).includes(k) || seen.has(k)) continue;
    seen.add(k);
    out.push({ id: k as LandingSectionId, hidden: it.hidden === true });
  }
  for (const k of LANDING_IDS) if (!seen.has(k)) out.push({ id: k, hidden: false });
  return out;
}

/**
 * Eski yayınları yükseltir: eksik yeni anahtarlar varsayılandan gelir, düzen listesi normalize edilir.
 * Saf; girdiyi değiştirmez. Böylece şema genişlediğinde mevcut canlı içerik varsayılana düşmez.
 */
export function upgradeSiteContent(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  let defaults: SiteContent | null = null;
  for (const k of LATER_KEYS) {
    if (out[k] === undefined) {
      defaults ??= defaultSiteContent();
      out[k] = defaults[k];
    }
  }
  if (Array.isArray(out.layout)) out.layout = normalizeLayout(out.layout as Array<{ id?: unknown; hidden?: unknown }>);
  // Sonradan eklenen hero alanı: eski yayında yoksa boş (boş = uzun açıklamanın ilk cümlesi).
  if (out.hero && typeof out.hero === "object" && !Array.isArray(out.hero) && (out.hero as Record<string, unknown>).mobileLead === undefined) {
    out.hero = { ...(out.hero as Record<string, unknown>), mobileLead: "" };
  }
  return out;
}

/** Metnin ilk cümlesi (satır sonları boşluk sayılır; nokta/ünlem/soru/üç nokta ile biten ilk parça; yoksa metnin tamamı). Saf. */
export function firstSentence(value: string): string {
  const t = value.replace(/\s+/g, " ").trim();
  const m = /^(.+?[.!?…])(?=\s|$)/.exec(t);
  return (m ? m[1]! : t).trim();
}

/** Mobil hero açıklaması: yönetimden yazılan tek cümle; boşsa uzun açıklamanın ilk cümlesi (değişkenler çağıranda çözülür). */
export function heroMobileLead(hero: Pick<SiteContent["hero"], "lead" | "mobileLead">): string {
  return hero.mobileLead.trim() || firstSentence(hero.lead);
}

export function parseSiteContent(value: unknown): SiteContent | null {
  const r = siteContentSchema.safeParse(upgradeSiteContent(value));
  return r.success ? r.data : null;
}

/** Görünür bölümler, yayın sırasıyla. Değerleme için ayrıca `valuation.hidden` uygulanır (ikisi aynı anahtar gibi davranır). */
export function visibleSections(cfg: Pick<SiteContent, "layout" | "valuation">): LandingSectionId[] {
  return normalizeLayout(cfg.layout)
    .filter((s) => !s.hidden && !(s.id === "degerleme" && cfg.valuation.hidden))
    .map((s) => s.id);
}

// ---------------------------------------------------------------------------
// Anlamsal doğrulama: düz metin, bağlantılar, bilinmeyen değişkenler, riskli kelime uyarıları
// ---------------------------------------------------------------------------

/** Metin içinde kullanılabilen değişkenler ({deneme} gibi); değerleri sunucuda paket tanımlarından üretilir. */
export const CONTENT_TOKENS = ["gorev", "deneme", "deneme_dene", "deneme_gun", "deneme_uzun", "yillik", "yillik_cumle", "yillik_metin", "ef_hak"] as const;

export const TOKEN_HELP: Record<(typeof CONTENT_TOKENS)[number], string> = {
  gorev: "Otomatik (zamanlanmış) görev sayısı; cron envanterinden gelir, elle yazılmaz",
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
      if (key === "gate" || (key === "id" && /^\.?layout\./.test(path))) return; // yapısal alan: şemada doğrulanır, metin değil
      out.push({ path, value: node, link: key === "href", multiline: ["lead", "text", "a", "panelText", "note"].includes(key) });
    } else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}.${i}`));
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) if (k !== "v") walk(v, path ? `${path}.${k}` : k);
  };
  walk(cfg, "");
  return out.map((o) => ({ ...o, path: o.path.replace(/^\./, "") }));
}

const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function validateSiteContent(input: unknown): { config: SiteContent | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const parsed = siteContentSchema.safeParse(upgradeSiteContent(input));
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
  dupCheck(cfg.tour, "tour");
  cfg.tour.forEach((t, i) => dupCheck(t.points, `tour.${i}.points`));
  dupCheck(cfg.bento.tiles, "bento.tiles");
  cfg.bento.tiles.forEach((t, i) => dupCheck(t.points, `bento.tiles.${i}.points`));
  dupCheck(cfg.why.rows, "why.rows");
  dupCheck(cfg.efSection.steps, "efSection.steps");
  dupCheck(cfg.layout, "layout");

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
  cfg.tour.forEach((t, i) => {
    if (!t.hidden && !t.label) issues.push({ level: "error", path: `tour.${i}.label`, message: "Sekme adı boş olamaz." });
  });
  cfg.bento.tiles.forEach((t, i) => {
    if (t.hidden && (HOME_ANCHORS as readonly string[]).includes(t.id)) {
      issues.push({ level: "warn", path: `bento.tiles.${i}`, message: `Bu kart gizliyken /#${t.id} bağlantısı (site menüsü) bölüme inmez.` });
    }
  });
  if (cfg.tour.length > 0 && !cfg.tour.some((t) => !t.hidden)) issues.push({ level: "warn", path: "tour", message: "Hiç görünen ekran yok; ürün turu bölümü çizilmez." });
  if (!visibleSections(cfg).length) issues.push({ level: "warn", path: "layout", message: "Tüm bölümler gizli; ana sayfada yalnız ana başlık kalır." });
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
