import { parsePriceText } from "../inventory-csv";

/**
 * AYRIŞTIRICI KATMANLARI (SAF: ağ, DOM, saat yok). Portal sayfasından aynı bilgiyi (ilan no, başlık, fiyat, ilan sahibi, durum)
 * dört bağımsız katmandan okumak için yardımcılar. Katman sırası `parse-core.ts`'te: JSON-LD → meta/og → gömülü durum JSON'u
 * (`__NEXT_DATA__`, `window.__...__`) → son çare DOM kalıpları (`portal-rules.json`). Hiçbiri tutmazsa sonuç "kontrol edilemedi"dir.
 * Service worker'da DOMParser olmadığı için hepsi metin tabanlıdır. Kişisel veri en az: yalnız ilan no, başlık, fiyat, durum,
 * ilan sahibi adı okunur.
 */

export type Json = Record<string, unknown>;

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, code: string) => {
    const c = code.toLowerCase();
    if (ENTITY[c] !== undefined) return ENTITY[c];
    if (c.startsWith("#x")) {
      const n = Number.parseInt(c.slice(2), 16);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    if (c.startsWith("#")) {
      const n = Number.parseInt(c.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return m;
  });
}

/** Etiketleri atar, varlıkları çözer, boşlukları teke indirir, uzunluğu kırpar. Boşsa null. */
export function cleanText(raw: string | null | undefined, max: number): string | null {
  if (!raw) return null;
  const s = decodeEntities(raw.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

/** Türkçe küçük harf + aksan katlama: "Kaldırılmıştır" ile "kaldirilmistir" aynı sayılır. */
export function norm(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u");
}

/** Betik/stil/yorum atılmış, etiketsiz görünür metin ("ilan bulunamadı" ibaresi i18n paketlerinde yanlış eşleşmesin). */
export function visibleText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ");
  return decodeEntities(stripped.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ");
}

export function hasAnyNorm(haystack: string, needles: readonly string[]): boolean {
  const h = norm(haystack);
  return needles.some((n) => n && h.includes(norm(n)));
}

export function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

export const LISTING_NO_RE = /^\d{6,12}$/;

// ---------------------------------------------------------------- fiyat (TL normalizasyonu)

/**
 * Fiyatı TL'ye normalleştirir. Para birimi belirtilmemişse TL varsayılır (portallar TL gösterir); BAŞKA bir para birimi
 * (USD, EUR, GBP ...) belirtilmişse fiyat YAZILMAZ (yanlış TL fiyatı üretmek, fiyat uyuşmazlığı alarmı doğurur).
 */
export function normalizeTlPrice(value: unknown, currency: string | null | undefined): { price: number | null; nonTl: boolean } {
  const cur = (currency ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const isTl = cur === "" || cur === "TRY" || cur === "TL" || cur === "TRL" || cur === "₺";
  if (!isTl) return { price: null, nonTl: true };
  let n: number | null = null;
  if (typeof value === "number") n = Number.isFinite(value) && value > 0 ? value : null;
  else if (typeof value === "string") n = parsePriceText(value);
  if (n !== null && (n <= 0 || n >= 1e12)) n = null;
  return { price: n, nonTl: false };
}

/** DOM kalıbıyla yakalanan fiyatın hemen ardındaki metinden para birimi tahmini (USD/EUR/GBP işaretleri). */
export function currencyHint(trailing: string): string | null {
  const t = trailing.slice(0, 14).toLowerCase();
  if (/^\s*(?:₺|tl\b|try\b| ?tl)/i.test(t)) return "TRY";
  if (/^\s*(?:usd|\$|dolar)/i.test(t)) return "USD";
  if (/^\s*(?:eur|€|euro|avro)/i.test(t)) return "EUR";
  if (/^\s*(?:gbp|£|sterlin)/i.test(t)) return "GBP";
  return null;
}

// ---------------------------------------------------------------- JSON-LD

/** `<script type="application/ld+json">` blokları (dizi ve @graph düzleştirilir). Bozuk JSON atlanır. */
export function extractJsonLd(html: string): Json[] {
  const out: Json[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(html)) && guard < 20) {
    guard += 1;
    try {
      const parsed: unknown = JSON.parse(m[1].trim());
      const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== "object") continue;
        const o = item as Json;
        if (Array.isArray(o["@graph"])) queue.push(...(o["@graph"] as unknown[]));
        out.push(o);
      }
    } catch {
      /* bozuk JSON-LD: atlanır */
    }
  }
  return out;
}

export type JsonLdFacts = { ids: string[]; title: string | null; price: number | null; nonTl: boolean; seller: string | null };

const LISTING_LIKE = /Product|RealEstateListing|Offer|Residence|Apartment|House|SingleFamily|Accommodation|Place/i;

function ldType(o: Json): string {
  const t = o["@type"];
  return Array.isArray(t) ? t.join(",") : typeof t === "string" ? t : "";
}

function idFromUrl(u: unknown): string | null {
  const s = str(u);
  if (!s) return null;
  const m = /(\d{6,12})(?:\/detay|-detay)?\/?(?:[?#].*)?$/.exec(s);
  return m ? m[1] : null;
}

/** JSON-LD'den ilan no adayları, başlık, fiyat (+para birimi), satıcı. Yalnız ilan benzeri nesneler (BreadcrumbList vb. dışlanır). */
export function jsonLdFacts(objs: readonly Json[]): JsonLdFacts {
  const ids: string[] = [];
  let title: string | null = null;
  let price: number | null = null;
  let nonTl = false;
  let seller: string | null = null;
  for (const o of objs) {
    const offers = Array.isArray(o.offers) ? (o.offers[0] as Json | undefined) : (o.offers as Json | undefined);
    const idCandidates = [
      str(o.sku),
      str(o.productID),
      str(o.mpn),
      typeof o.identifier === "object" && o.identifier ? str((o.identifier as Json).value) : str(o.identifier),
      idFromUrl(o.url),
      idFromUrl(o["@id"]),
    ];
    const own = idCandidates.filter((x): x is string => !!x && LISTING_NO_RE.test(x));
    const listingLike = own.length > 0 || !!offers || LISTING_LIKE.test(ldType(o));
    if (!listingLike) continue;
    for (const id of own) if (!ids.includes(id)) ids.push(id);
    title ??= str(o.name);
    if (offers && typeof offers === "object") {
      if (price === null && !nonTl) {
        const spec = offers.priceSpecification as Json | undefined;
        const raw = offers.price ?? offers.lowPrice ?? (spec && typeof spec === "object" ? spec.price : undefined);
        const cur = str(offers.priceCurrency) ?? (spec && typeof spec === "object" ? str(spec.priceCurrency) : null);
        const norm1 = normalizeTlPrice(raw, cur);
        if (norm1.nonTl) nonTl = true;
        else price = norm1.price;
      }
      const s = offers.seller as Json | undefined;
      seller ??= s && typeof s === "object" ? str(s.name) : null;
    }
  }
  return { ids, title, price, nonTl, seller };
}

// ---------------------------------------------------------------- meta / og

function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(tag)) && guard < 20) {
    guard += 1;
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? "";
  }
  return out;
}

export type MetaFacts = { meta: Map<string, string>; canonical: string | null };

/** `<meta property|name|itemprop=... content=...>` etiketleri (ilk değer kazanır) + `<link rel="canonical">`. */
export function extractMeta(html: string): MetaFacts {
  const meta = new Map<string, string>();
  const tagRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = tagRe.exec(html)) && guard < 300) {
    guard += 1;
    const a = parseAttrs(m[0]);
    const key = (a.property ?? a.name ?? a.itemprop ?? "").toLowerCase();
    if (key && a.content !== undefined && !meta.has(key)) meta.set(key, decodeEntities(a.content));
  }
  let canonical: string | null = null;
  const linkRe = /<link\b[^>]*>/gi;
  guard = 0;
  while ((m = linkRe.exec(html)) && guard < 80) {
    guard += 1;
    const a = parseAttrs(m[0]);
    if ((a.rel ?? "").toLowerCase() === "canonical" && a.href) {
      canonical = decodeEntities(a.href);
      break;
    }
  }
  return { meta, canonical };
}

/** Başlıktaki site adı son ekini atar ("Moda 3+1 - sahibinden.com"). */
export function stripSiteSuffix(title: string | null): string | null {
  if (!title) return null;
  const t = title.replace(/\s*[-|–—]\s*(?:sahibinden|hepsiemlak|emlakjet)(?:\.com)?\s*$/i, "").trim();
  return t || null;
}

// ---------------------------------------------------------------- gömülü durum JSON'u

const MAX_STATE_SCRIPT = 600_000;

function balancedJsonAt(src: string, start: number): string | null {
  const open = src[start];
  if (open !== "{" && open !== "[") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  const limit = Math.min(src.length, start + MAX_STATE_SCRIPT);
  for (let i = start; i < limit; i += 1) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

/** `__NEXT_DATA__`, `application/json` betikleri ve `window.__ADI__ = {...}` atamaları. Bozuk JSON atlanır. */
export function extractStates(html: string): unknown[] {
  const out: unknown[] = [];
  const tryParse = (raw: string) => {
    try {
      out.push(JSON.parse(raw));
    } catch {
      /* bozuk durum JSON'u: atlanır */
    }
  };
  const next = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (next && next[1].length <= MAX_STATE_SCRIPT) tryParse(next[1].trim());
  const jsonRe = /<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = jsonRe.exec(html)) && guard < 5) {
    guard += 1;
    if (/__NEXT_DATA__/.test(m[0].slice(0, 200))) continue;
    if (m[1].length <= MAX_STATE_SCRIPT) tryParse(m[1].trim());
  }
  const winRe = /window\s*\.\s*(__[A-Za-z0-9_]+__)\s*=\s*/g;
  guard = 0;
  while ((m = winRe.exec(html)) && guard < 4) {
    guard += 1;
    const raw = balancedJsonAt(html, m.index + m[0].length);
    if (raw) tryParse(raw);
  }
  return out;
}

export type StateCandidate = {
  id: string;
  title: string | null;
  price: number | null;
  nonTl: boolean;
  seller: string | null;
  status: string | null;
  removed: boolean;
};

const STRONG_ID_KEYS = ["classifiedid", "listingid", "listing_id", "ilanno", "ilanid", "adid", "advertid", "advertno", "classifiedno"];
const PRICE_KEYS = ["price", "classifiedprice", "pricevalue", "fiyat"];
const TITLE_KEYS = ["title", "classifiedtitle", "name", "baslik", "header"];
const SELLER_KEYS = ["storename", "ownername", "firmname", "advertisername", "officename", "sellername"];
const SELLER_OBJECT_KEYS = ["seller", "owner", "advertiser", "store", "office"];
const STATUS_KEYS = ["status", "listingstatus", "statusname", "classifiedstatus"];
const CURRENCY_KEYS = ["currency", "pricecurrency", "currencycode"];
const REMOVED_STATE = /^(passive|pasif|removed|deleted|expired|inactive|unpublished|kaldirildi|yayinda degil)$/;

function pick(lower: Map<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) if (lower.has(k)) return lower.get(k);
  return undefined;
}

function candidateOf(o: Json): StateCandidate | null {
  const lower = new Map<string, unknown>();
  for (const [k, v] of Object.entries(o)) lower.set(k.toLowerCase(), v);
  let id: string | null = null;
  for (const k of STRONG_ID_KEYS) {
    const v = str(lower.get(k));
    if (v && LISTING_NO_RE.test(v)) {
      id = v;
      break;
    }
  }
  const priceRaw = pick(lower, PRICE_KEYS);
  const titleRaw = str(pick(lower, TITLE_KEYS));
  if (!id) {
    const generic = str(lower.get("id"));
    if (generic && LISTING_NO_RE.test(generic) && (priceRaw !== undefined || titleRaw)) id = generic;
  }
  if (!id) return null;

  let price: number | null = null;
  let nonTl = false;
  const curTop = str(pick(lower, CURRENCY_KEYS));
  if (priceRaw !== undefined && priceRaw !== null) {
    if (typeof priceRaw === "object" && !Array.isArray(priceRaw)) {
      const p = priceRaw as Json;
      const r = normalizeTlPrice(p.value ?? p.amount ?? p.price, str(p.currency) ?? str(p.currencyCode) ?? curTop);
      price = r.price;
      nonTl = r.nonTl;
    } else {
      const r = normalizeTlPrice(priceRaw, curTop);
      price = r.price;
      nonTl = r.nonTl;
    }
  }
  let seller = str(pick(lower, SELLER_KEYS));
  if (!seller) {
    for (const k of SELLER_OBJECT_KEYS) {
      const v = lower.get(k);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        seller = str((v as Json).name) ?? str((v as Json).title);
        if (seller) break;
      }
    }
  }
  const statusRaw = str(pick(lower, STATUS_KEYS));
  const removed = !!statusRaw && REMOVED_STATE.test(norm(statusRaw));
  return { id, title: titleRaw, price, nonTl, seller, status: statusRaw ? statusRaw.slice(0, 40) : null, removed };
}

/** Durum JSON'unda ilan benzeri nesneler (bütçeli gezinti: en çok 30 bin düğüm, 10 derinlik). */
export function collectStateCandidates(roots: readonly unknown[]): StateCandidate[] {
  const out: StateCandidate[] = [];
  const queue: { v: unknown; d: number }[] = roots.map((v) => ({ v, d: 0 }));
  let budget = 30_000;
  for (let i = 0; i < queue.length && budget > 0; i += 1) {
    budget -= 1;
    const { v, d } = queue[i];
    if (!v || typeof v !== "object" || d > 10) continue;
    if (Array.isArray(v)) {
      for (const x of v.slice(0, 200)) if (x && typeof x === "object") queue.push({ v: x, d: d + 1 });
      continue;
    }
    const o = v as Json;
    const c = candidateOf(o);
    if (c) out.push(c);
    for (const x of Object.values(o)) if (x && typeof x === "object") queue.push({ v: x, d: d + 1 });
  }
  return out;
}
