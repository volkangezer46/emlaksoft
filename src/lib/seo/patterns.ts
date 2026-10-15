import type { SeoPatternEntity, SeoPatterns } from "./schema";

/**
 * Dinamik SEO kalıpları (SAF — sunucu ve yönetim önizlemesi ortak). Ayar: `seo.patterns` (schema.ts PatternsSchema).
 *
 * Kural: alan boşsa VARSAYILAN kalıp kullanılır ve çıktı bugünkü sabit metinle BİREBİR aynıdır (yalnız değişken
 * yerleştirme; sadeleştirme/kesme yok). Yönetici kalıp kaydederse `renderSeoPattern` uygulanır: bilinmeyen değişken
 * boş kalır, boşluk/ayraç sadeleşir, başlık 70 / açıklama 160 karakterde kelime sınırında kesilir.
 * İSTİSNA (SP7): ilan varsayılanı markalı başlık (60 karakter) ve sadeleşen açıklamadır (`listingDefaultTitle`).
 * Çıktı yalnız metadata'ya gider (Next kaçışlar); JSON-LD'ye kalıp metni EKLENMEZ.
 */

export const SEO_PATTERN_TITLE_MAX = 70;
export const SEO_PATTERN_DESC_MAX = 160;
/** Varsayılan ilan başlığı sınırı (arama sonucunda kesilmeden görünen uzunluk). */
export const LISTING_TITLE_MAX = 60;

export type SeoPatternField = "title" | "description";

export const SEO_PATTERN_VARS = [
  { key: "ofis", label: "Ofis adı", entities: ["office", "listing", "agent"] },
  { key: "ilan_sayisi", label: "Aktif ilan sayısı", entities: ["office"] },
  { key: "ilan_basligi", label: "İlan başlığı", entities: ["listing"] },
  { key: "fiyat", label: "Fiyat", entities: ["listing"] },
  { key: "il", label: "İl", entities: ["listing"] },
  { key: "ilce", label: "İlçe", entities: ["listing"] },
  { key: "konum", label: "Adres, ilçe, il", entities: ["listing"] },
  { key: "islem", label: "Satılık/Kiralık", entities: ["listing"] },
  { key: "tip", label: "Mülk tipi", entities: ["listing"] },
  { key: "oda", label: "Oda sayısı", entities: ["listing"] },
  { key: "metrekare", label: "Alan (m²)", entities: ["listing"] },
  { key: "danisman", label: "Danışman adı", entities: ["agent"] },
  { key: "unvan", label: "Danışman unvanı", entities: ["agent"] },
] as const satisfies readonly { key: string; label: string; entities: readonly SeoPatternEntity[] }[];

/** Varsayılan kalıpların kullandığı iç değişkenler (çip olarak gösterilmez). */
type InternalVar = "unvan_kucuk" | "uzmanlik";
export type SeoPatternVar = (typeof SEO_PATTERN_VARS)[number]["key"] | InternalVar;
export type SeoPatternVars = Partial<Record<SeoPatternVar, string | number | null | undefined>>;

/**
 * Varsayılan kalıplar (vitrin/[slug], vitrin/[slug]/[ilan], danisman/[slug] generateMetadata). Ofis ve danışman bugünkü
 * sabit metindir. İlan (SP7): markalı başlık (60 karakter, marka korunarak kelime sınırında kısalır;
 * `listingDefaultTitle`) ve oda/m²/fiyat/ilçeden açıklama (ham adres alanı KULLANILMAZ).
 */
export const DEFAULT_SEO_PATTERNS: Record<SeoPatternEntity, Record<SeoPatternField, string>> = {
  office: {
    title: "{ofis} | Portföy Vitrini",
    description:
      "{ofis} güncel portföy vitrini — {ilan_sayisi} aktif ilan. Satılık ve kiralık portföyleri inceleyin, yerinde inceleme için talep bırakın.",
  },
  listing: {
    title: "{ilan_basligi} | {ilce} {islem} {tip} – {ofis}",
    description: "{ilce} {islem} {tip} · {oda} · {metrekare} · {fiyat} — {ofis} güvencesiyle.",
  },
  agent: {
    title: "{danisman} — {unvan} | {ofis}",
    description: "{danisman}, {ofis} bünyesinde {unvan_kucuk}. {uzmanlik}Portföyleri görün, tek tıkla arayın veya randevu alın.",
  },
};

const VAR_RE = /\{([a-z_]+)\}/g;

/** Yalnız yerleştirme (varsayılan kalıp yolu): bilinmeyen/boş değişken "" olur, başka hiçbir şey değişmez. */
export function fillSeoPattern(tpl: string, vars: SeoPatternVars): string {
  return tpl.replace(VAR_RE, (_, k: string) => {
    const v = (vars as Record<string, unknown>)[k];
    return v == null ? "" : String(v);
  });
}

const SEPARATORS = "|·•—–\\-,:;";
const EDGE_SEP_RE = new RegExp(`^[\\s${SEPARATORS}]+|[\\s${SEPARATORS}]+$`, "g");
const DUP_SEP_RE = new RegExp(`([${SEPARATORS}])(\\s*[${SEPARATORS}])+`, "g");

function cutAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max + 1);
  const space = head.lastIndexOf(" ");
  // Kelime sınırı çok gerideyse (uzun tek kelime) sert kes.
  const cut = space >= Math.floor(max * 0.6) ? head.slice(0, space) : s.slice(0, max);
  return cut.replace(EDGE_SEP_RE, "");
}

/**
 * Yönetici kalıbını işler: değişkenleri yerleştirir (değerlerdeki < > atılır), bilinmeyen değişkeni boş bırakır,
 * boşlukları ve boş değişkenden kalan ardışık/kenar ayraçları sadeleştirir, uzunluk sınırında kelime sınırından keser.
 */
export function renderSeoPattern(tpl: string, vars: SeoPatternVars, field: SeoPatternField = "title"): string {
  const filled = tpl.replace(VAR_RE, (_, k: string) => {
    const v = (vars as Record<string, unknown>)[k];
    return v == null ? "" : String(v).replace(/[<>]/g, "");
  });
  const tidy = filled
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .replace(DUP_SEP_RE, "$1")
    .replace(EDGE_SEP_RE, "")
    .trim();
  return cutAtWord(tidy, field === "title" ? SEO_PATTERN_TITLE_MAX : SEO_PATTERN_DESC_MAX);
}

/**
 * Etkin metin: kaydedilmiş kalıp varsa `renderSeoPattern`, yoksa varsayılan kalıp birebir (`fillSeoPattern`).
 * `patterns` null (ayar okunamadı) ise de varsayılan kullanılır.
 */
export function resolveSeoPattern(
  patterns: SeoPatterns | null | undefined,
  entity: SeoPatternEntity,
  field: SeoPatternField,
  vars: SeoPatternVars,
): string {
  const custom = patterns?.[entity]?.[field]?.trim();
  if (custom) return renderSeoPattern(custom, vars, field);
  if (entity === "listing") {
    return field === "title" ? listingDefaultTitle(vars) : renderSeoPattern(DEFAULT_SEO_PATTERNS.listing.description, vars, "description");
  }
  return fillSeoPattern(DEFAULT_SEO_PATTERNS[entity][field], vars);
}

const cleanVar = (v: unknown): string => (v == null ? "" : String(v).replace(/[<>]/g, "").replace(/\s+/g, " ").trim());

/**
 * Varsayılan ilan başlığı: `{ilan_basligi} | {ilce} {islem} {tip} – {ofis}`, en çok 60 karakter. Aşarsa marka
 * (` – {ofis}`) korunur, baştaki kısım kelime sınırında kısalır; marka çok uzunsa bütün metin kelime sınırında kesilir.
 */
export function listingDefaultTitle(vars: SeoPatternVars, max: number = LISTING_TITLE_MAX): string {
  const head = cleanVar(vars.ilan_basligi);
  const mid = [vars.ilce, vars.islem, vars.tip].map(cleanVar).filter(Boolean).join(" ");
  const brand = cleanVar(vars.ofis);
  const body = [head, mid].filter(Boolean).join(" | ");
  const suffix = brand ? ` – ${brand}` : "";
  const full = `${body}${suffix}`.replace(EDGE_SEP_RE, "").trim();
  if (full.length <= max) return full;
  const room = max - suffix.length;
  if (body && room >= 20) {
    const cut = cutAtWord(body, room);
    if (cut) return `${cut}${suffix}`;
  }
  return cutAtWord(full, max);
}

/** Kalıptaki değişkenlerden varlığa uymayan/bilinmeyenleri listeler (yönetim uyarısı). */
export function unknownPatternVars(tpl: string, entity: SeoPatternEntity): string[] {
  const allowed = new Set<string>(SEO_PATTERN_VARS.filter((v) => (v.entities as readonly string[]).includes(entity)).map((v) => v.key));
  const out = new Set<string>();
  for (const m of tpl.matchAll(VAR_RE)) if (!allowed.has(m[1]!)) out.add(m[1]!);
  return [...out];
}

/* ---------- Vitrin robots kararı ---------- */

/**
 * Vitrin/ilan/danışman robots: ofisin açık arama onayı (tenants.vitrin_seo_optin). `neverIndex` (örnek/demo/test/
 * platform kiracısı; src/lib/vitrin-seo/never-index.ts) onaydan ÖNCE uygulanır: true ise opt-in olsa bile noindex.
 */
export function vitrinRobots(optin: boolean, neverIndex: boolean = false): { index: boolean; follow: boolean } {
  return optin && !neverIndex ? { index: true, follow: true } : { index: false, follow: true };
}

/** Ofis tanıtım metni açıklama olarak (boşlukları sadeleştirir, 200 karakter). */
export function introDescription(intro: string | null | undefined): string | null {
  if (intro == null) return null;
  return intro.replace(/\s+/g, " ").slice(0, 200);
}
