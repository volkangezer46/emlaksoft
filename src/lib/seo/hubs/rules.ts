import { formatTry } from "@/lib/format";
import { slugifyTr } from "@/lib/vitrin/listing-slug";
import type { HubLevel, SeoHubSettings } from "../schema";

/**
 * PROGRAMATİK BÖLGE SAYFALARI — SAF kurallar (yol, eşik, istatistik, metin, SSS). Ağ/DB yok; testlidir.
 *
 * Yol biçimi (tek kaynak):
 *   /emlak                                   → il listesi (gezinme)
 *   /emlak/{il}                              → il sayfası          (+ /emlak/{il}/{niyet})
 *   /emlak/{il}/{ilce}                       → ilçe sayfası        (+ /emlak/{il}/{ilce}/{niyet})
 *   /emlak/{il}/{ilce}/{mahalle}/{niyet}     → mahalle + niyet
 * Niyet: `{islem}-{tip}` ya da `{islem}-{oda}-{tip}` (satilik-daire, kiralik-2-1-daire, satilik-villa).
 *
 * BEYAZ ŞAPKA: içerik yalnız gerçek ilanlardan; ilan sayısı eşiğin altındaysa sayfa `noindex, follow` (ince/kapı
 * sayfası yok), hiç ilan yoksa 404. Metin ve SSS gerçek istatistiklerden üretilir; uydurma sayı/yorum/puan yok.
 */

export const HUB_BASE = "/emlak";

export const TX_SLUGS = ["satilik", "kiralik", "gunluk-kiralik", "devren"] as const;
export type TxSlug = (typeof TX_SLUGS)[number];

export const TX_LABEL: Record<TxSlug, string> = { satilik: "satılık", kiralik: "kiralık", "gunluk-kiralik": "günlük kiralık", devren: "devren" };

/** properties.transaction_type → niyet işlemi (bilinmeyen: null; sayfa üretilmez). */
export function txSlugOf(raw: string | null | undefined): TxSlug | null {
  const v = slugifyTr(raw);
  if (v === "sale" || v === "satilik") return "satilik";
  if (v === "rent" || v === "kiralik") return "kiralik";
  if (v === "daily-rent" || v === "gunluk-kiralik") return "gunluk-kiralik";
  if (v === "transfer" || v === "devren") return "devren";
  return null;
}

/** Oda sayısı yalnız "N+M" biçiminde kabul edilir (serbest metin niyet üretmez). */
export function roomsSlugOf(raw: string | null | undefined): { slug: string; label: string } | null {
  const v = String(raw ?? "").replace(/\s+/g, "");
  const m = /^(\d{1,2})\+(\d)$/.exec(v);
  if (!m) return null;
  return { slug: `${m[1]}-${m[2]}`, label: `${m[1]}+${m[2]}` };
}

export type HubIntent = { tx: TxSlug; type: string; typeLabel: string; rooms?: { slug: string; label: string } };

export function intentSlug(i: Pick<HubIntent, "tx" | "type" | "rooms">): string {
  return [i.tx, i.rooms?.slug, i.type].filter(Boolean).join("-");
}

/** Niyet parçası mı (işlem önekiyle başlar)? Ayrıştırma tipin kendisini değil biçimi doğrular; tip DB verisiyle eşleşir. */
export function parseIntentSegment(seg: string): { tx: TxSlug; rooms?: string; type: string } | null {
  const tx = [...TX_SLUGS].sort((a, b) => b.length - a.length).find((t) => seg.startsWith(`${t}-`));
  if (!tx) return null;
  const rest = seg.slice(tx.length + 1);
  const rm = /^(\d{1,2})-(\d)-(.+)$/.exec(rest);
  if (rm) return { tx, rooms: `${rm[1]}-${rm[2]}`, type: rm[3]! };
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rest) ? { tx, type: rest } : null;
}

export type HubRef = { il: string; ilce?: string; mahalle?: string; intent?: string };

export function hubPath(r: HubRef): string {
  return [HUB_BASE, r.il, r.ilce, r.mahalle, r.intent].filter(Boolean).join("/");
}

/** Yol parçaları → başvuru. Geçersiz biçim (ör. niyetsiz mahalle, fazla parça) null. */
export function parseHubSegments(segs: readonly string[]): HubRef | "root" | null {
  if (segs.length === 0) return "root";
  if (segs.length > 4 || segs.some((s) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) || s.length > 80)) return null;
  const [il, a, b, c] = segs as [string, string?, string?, string?];
  if (parseIntentSegment(il)) return null;
  if (!a) return { il };
  if (parseIntentSegment(a)) return segs.length === 2 ? { il, intent: a } : null;
  if (!b) return { il, ilce: a };
  if (parseIntentSegment(b)) return segs.length === 3 ? { il, ilce: a, intent: b } : null;
  if (c && parseIntentSegment(c)) return { il, ilce: a, mahalle: b, intent: c };
  return null;
}

export function hubLevelOf(r: HubRef): HubLevel {
  return r.mahalle ? "mahalle" : r.ilce ? "ilce" : "il";
}

/* ------------------------------ İlan girdisi ve hub kümesi ------------------------------ */

export type GeoName = { slug: string; name: string };

export type HubListing = {
  id: string;
  tenantId: string;
  officeSlug: string;
  officeName: string;
  title: string;
  tx: TxSlug;
  type: string;
  typeLabel: string;
  rooms: { slug: string; label: string } | null;
  il: GeoName;
  ilce: GeoName | null;
  mahalle: GeoName | null;
  /** Yalnız TL ilanlarda dolu (istatistikler para birimi karıştırmaz). */
  priceTry: number | null;
  /** Görüntülenen fiyat metni (her para birimi). */
  priceText: string | null;
  sqm: number | null;
  updatedAt: string | null;
  /** Vitrin ilan yolu (tek kaynak listing-slug.ts ile üretilmiş). */
  href: string;
};

export type HubSummary = {
  path: string;
  ref: HubRef;
  level: HubLevel;
  count: number;
  geo: { il: GeoName; ilce?: GeoName; mahalle?: GeoName };
  intent?: HubIntent;
  lastmod: string | null;
};

type Cand = { path: string; ref: HubRef; geo: HubSummary["geo"]; intent?: HubIntent };

function candidates(l: HubListing, s: Pick<SeoHubSettings, "levels" | "roomIntents">): Cand[] {
  const out: Cand[] = [];
  const base = { tx: l.tx, type: l.type, typeLabel: l.typeLabel };
  const intents: HubIntent[] = [base];
  if (s.roomIntents && l.rooms) intents.push({ ...base, rooms: l.rooms });
  const lv = new Set(s.levels);
  if (lv.has("il")) {
    out.push({ path: hubPath({ il: l.il.slug }), ref: { il: l.il.slug }, geo: { il: l.il } });
    out.push({ path: hubPath({ il: l.il.slug, intent: intentSlug(base) }), ref: { il: l.il.slug, intent: intentSlug(base) }, geo: { il: l.il }, intent: base });
  }
  if (l.ilce && lv.has("ilce")) {
    out.push({ path: hubPath({ il: l.il.slug, ilce: l.ilce.slug }), ref: { il: l.il.slug, ilce: l.ilce.slug }, geo: { il: l.il, ilce: l.ilce } });
    for (const it of intents) {
      const ref = { il: l.il.slug, ilce: l.ilce.slug, intent: intentSlug(it) };
      out.push({ path: hubPath(ref), ref, geo: { il: l.il, ilce: l.ilce }, intent: it });
    }
  }
  if (l.ilce && l.mahalle && lv.has("mahalle")) {
    const ref = { il: l.il.slug, ilce: l.ilce.slug, mahalle: l.mahalle.slug, intent: intentSlug(base) };
    out.push({ path: hubPath(ref), ref, geo: { il: l.il, ilce: l.ilce, mahalle: l.mahalle }, intent: base });
  }
  return out;
}

/** Tüm ilanlardan hub kümesi (yalnız ≥1 ilanı olanlar; elle kapatılanlar hariç). Sıra: yol. */
export function computeHubs(listings: readonly HubListing[], s: Pick<SeoHubSettings, "levels" | "roomIntents" | "disabledPaths">): HubSummary[] {
  const disabled = new Set(s.disabledPaths);
  const map = new Map<string, HubSummary>();
  for (const l of listings) {
    for (const c of candidates(l, s)) {
      if (disabled.has(c.path)) continue;
      const cur = map.get(c.path);
      if (cur) {
        cur.count += 1;
        if (l.updatedAt && (!cur.lastmod || l.updatedAt > cur.lastmod)) cur.lastmod = l.updatedAt;
      } else {
        map.set(c.path, { path: c.path, ref: c.ref, level: hubLevelOf(c.ref), count: 1, geo: c.geo, intent: c.intent, lastmod: l.updatedAt });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** Bu hub'a giren ilanlar (sayfa listesi ve istatistik). */
export function listingsForHub(listings: readonly HubListing[], ref: HubRef): HubListing[] {
  const intent = ref.intent ? parseIntentSegment(ref.intent) : null;
  return listings.filter((l) => {
    if (l.il.slug !== ref.il) return false;
    if (ref.ilce && l.ilce?.slug !== ref.ilce) return false;
    if (ref.mahalle && l.mahalle?.slug !== ref.mahalle) return false;
    if (intent) {
      if (l.tx !== intent.tx || l.type !== intent.type) return false;
      if (intent.rooms && l.rooms?.slug !== intent.rooms) return false;
    }
    return true;
  });
}

export type HubDecision = "index" | "noindex" | "notfound";

/** Eşik kuralı: ≥ min → index; 1..min-1 → noindex, follow (sitemap dışı); 0 → 404. Özellik kapalıysa 404. */
export function hubDecision(count: number, s: Pick<SeoHubSettings, "enabled" | "minListings">): HubDecision {
  if (!s.enabled || count <= 0) return "notfound";
  return count >= s.minListings ? "index" : "noindex";
}

/* ------------------------------ İstatistik ------------------------------ */

export function median(values: readonly number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : Math.round((v[mid - 1]! + v[mid]!) / 2);
}

export type HubStats = {
  count: number;
  offices: number;
  /** Medyan fiyat yalnız en az 3 TL ilanı varsa (tek ilan "ortalama" sayılmaz). */
  medianPrice: number | null;
  priceSample: number;
  medianPricePerSqm: number | null;
  ppsSample: number;
  minPrice: number | null;
  maxPrice: number | null;
  topRooms: { label: string; count: number } | null;
  types: { label: string; count: number }[];
};

export const HUB_STATS_MIN_SAMPLE = 3;

/**
 * İstatistikler. Fiyat yalnız TEK işlem türündeki kümede anlamlıdır (satılık ile kiralık karışmaz): `withPrices`
 * yalnız niyetli hub'da true verilir; m² fiyatı yalnız satılıkta hesaplanır (kira/m² ayrı bir göstergedir).
 */
export function hubStats(list: readonly HubListing[], opts: { withPrices?: boolean; perSqm?: boolean } = {}): HubStats {
  const withPrices = opts.withPrices ?? true;
  const prices = withPrices ? list.map((l) => l.priceTry).filter((n): n is number => n !== null && n > 0) : [];
  const pps = withPrices && (opts.perSqm ?? true) ? list.filter((l) => l.priceTry && l.sqm && l.sqm > 0).map((l) => Math.round((l.priceTry as number) / (l.sqm as number))) : [];
  const rooms = new Map<string, number>();
  for (const l of list) if (l.rooms) rooms.set(l.rooms.label, (rooms.get(l.rooms.label) ?? 0) + 1);
  const topRooms = [...rooms].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const types = new Map<string, number>();
  for (const l of list) types.set(l.typeLabel, (types.get(l.typeLabel) ?? 0) + 1);
  return {
    count: list.length,
    offices: new Set(list.map((l) => l.tenantId)).size,
    medianPrice: prices.length >= HUB_STATS_MIN_SAMPLE ? median(prices) : null,
    priceSample: prices.length,
    medianPricePerSqm: pps.length >= HUB_STATS_MIN_SAMPLE ? median(pps) : null,
    ppsSample: pps.length,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    topRooms: topRooms ? { label: topRooms[0], count: topRooms[1] } : null,
    types: [...types].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "tr")),
  };
}

/* ------------------------------ Türkçe metin ------------------------------ */

const VOWELS = "aeıioöuüAEIİOÖUÜ";
const HARD = "çfhkpsştÇFHKPSŞT";

/** Bulunma eki: Kadıköy'de, Beşiktaş'ta, Ataşehir'de, Üsküdar'da (ünlü uyumu + sertleşme). */
export function locative(name: string): string {
  const n = name.trim();
  if (!n) return n;
  const letters = [...n];
  const lastVowel = [...letters].reverse().find((ch) => VOWELS.includes(ch)) ?? "e";
  const back = "aıouAIOU".includes(lastVowel);
  const last = letters[letters.length - 1]!;
  const d = HARD.includes(last) ? "t" : "d";
  return `${n}'${d}${back ? "a" : "e"}`;
}

/** Cümle başı büyük harf (Türkçe). */
const cap = (s: string) => (s ? s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1) : s);

export function hubPlaceName(h: Pick<HubSummary, "geo">): string {
  if (h.geo.mahalle && h.geo.ilce) return `${h.geo.mahalle.name}, ${h.geo.ilce.name}`;
  return h.geo.ilce?.name ?? h.geo.il.name;
}

/** "satılık 2+1 daire" / "satılık daire" / "emlak ilanları". */
export function intentPhrase(i: HubIntent | undefined): string {
  if (!i) return "emlak ilanları";
  return [TX_LABEL[i.tx], i.rooms?.label, i.typeLabel.toLocaleLowerCase("tr-TR")].filter(Boolean).join(" ");
}

export function hubTitle(h: Pick<HubSummary, "geo" | "intent">): string {
  const place = h.geo.mahalle ? `${h.geo.mahalle.name} ${h.geo.ilce?.name ?? ""}`.trim() : (h.geo.ilce?.name ?? h.geo.il.name);
  return h.intent ? `${place} ${intentPhrase(h.intent)} ilanları` : `${place} emlak ilanları`;
}

export function hubH1(h: Pick<HubSummary, "geo" | "intent">): string {
  return cap(hubTitle(h));
}

/** Fiyat sözcüğü: kiralıkta aylık kira. */
export function priceWord(i: HubIntent | undefined): string {
  return i?.tx === "kiralik" ? "aylık kira" : "fiyat";
}

/** Hub istatistik seçenekleri (hubStats): fiyat yalnız niyetli, m² yalnız satılık. */
export function statsOptionsFor(i: HubIntent | undefined): { withPrices: boolean; perSqm: boolean } {
  return { withPrices: Boolean(i), perSqm: i?.tx === "satilik" };
}

export function hubDescription(h: Pick<HubSummary, "geo" | "intent">, st: HubStats): string {
  const where = locative(hubPlaceName(h));
  const what = h.intent ? intentPhrase(h.intent) : "emlak ilanı";
  const parts = [`${where} ${st.count} ${what}`];
  if (st.medianPrice) parts.push(`medyan ${priceWord(h.intent)} ${formatTry(st.medianPrice)}`);
  if (st.medianPricePerSqm) parts.push(`m² ${formatTry(st.medianPricePerSqm)}`);
  return `${parts.join(", ")}. Arama onayı veren emlak ofislerinin güncel, doğrulanmış ilanları.`.slice(0, 300);
}

/** Giriş paragrafı (yalnız gerçek istatistik; örneklem küçükse fiyat cümlesi yok). */
export function hubIntro(h: Pick<HubSummary, "geo" | "intent">, st: HubStats): string[] {
  const where = locative(hubPlaceName(h));
  const what = h.intent ? intentPhrase(h.intent) : "emlak ilanı";
  const out = [`${where} şu anda ${st.count} ${what} yayında; ilanlar ${st.offices} emlak ofisinden geliyor ve ofisler ilanı kapattığında listeden düşer.`];
  if (st.medianPrice) {
    const range = st.minPrice && st.maxPrice && st.minPrice !== st.maxPrice ? ` En düşük ${formatTry(st.minPrice)}, en yüksek ${formatTry(st.maxPrice)}.` : "";
    out.push(`Fiyatı TL olarak girilmiş ${st.priceSample} ilanın medyan ${priceWord(h.intent)} ${formatTry(st.medianPrice)}.${range}`);
  }
  if (st.medianPricePerSqm) out.push(`Metrekaresi belli ${st.ppsSample} ilanda medyan m² fiyatı ${formatTry(st.medianPricePerSqm)}.`);
  if (st.topRooms && !h.intent?.rooms) out.push(`En çok ilan ${st.topRooms.label} oda düzeninde (${st.topRooms.count} ilan).`);
  return out;
}

/** SSS: yalnız verisi olan sorular (sayfada görünen SSS = FAQPage). */
export function hubFaq(h: Pick<HubSummary, "geo" | "intent">, st: HubStats): { q: string; a: string }[] {
  const where = locative(hubPlaceName(h));
  const what = h.intent ? intentPhrase(h.intent) : "emlak ilanı";
  const faq: { q: string; a: string }[] = [{ q: `${where} kaç ${what} var?`, a: `Şu anda ${st.count} ilan yayında (${st.offices} emlak ofisi). Sayı ofisler ilan ekledikçe ve kapattıkça güncellenir.` }];
  if (st.medianPrice) faq.push({ q: `${where} ${what} ${h.intent?.tx === "kiralik" ? "kiraları" : "fiyatları"} ne kadar?`, a: `Fiyatı TL girilmiş ${st.priceSample} ilanın medyan ${priceWord(h.intent)} ${formatTry(st.medianPrice)}. Medyan, uç değerlerden etkilenmeyen orta değerdir; ilan fiyatıdır, gerçekleşen işlem fiyatı değildir.` });
  if (st.medianPricePerSqm) faq.push({ q: `${where} metrekare fiyatı ne kadar?`, a: `Metrekaresi belli ${st.ppsSample} ilanda medyan m² fiyatı ${formatTry(st.medianPricePerSqm)}.` });
  if (st.topRooms && !h.intent?.rooms) faq.push({ q: `${where} en çok hangi oda tipinde ilan var?`, a: `En çok ilan ${st.topRooms.label} (${st.topRooms.count} ilan).` });
  return faq;
}

/** Üst (geri) bağlantılar: breadcrumb sırası. */
export function hubCrumbs(h: Pick<HubSummary, "geo" | "intent" | "ref">): { name: string; path?: string }[] {
  const c: { name: string; path?: string }[] = [
    { name: "Ana sayfa", path: "/" },
    { name: "Emlak ilanları", path: HUB_BASE },
    { name: h.geo.il.name, path: hubPath({ il: h.ref.il }) },
  ];
  if (h.geo.ilce) c.push({ name: h.geo.ilce.name, path: hubPath({ il: h.ref.il, ilce: h.ref.ilce }) });
  if (h.geo.mahalle) c.push({ name: h.geo.mahalle.name });
  if (h.intent) c.push({ name: cap(intentPhrase(h.intent)) });
  // Son öğe sayfanın kendisidir (bağlantısız).
  const last = c[c.length - 1]!;
  if (last.path === hubPath(h.ref)) delete last.path;
  return c;
}

/** Alt ve kardeş bağlantılar: bu hub'dan inilebilen, en az 1 ilanı olan hub'lar (en çok `limit`, çok ilanlı önce). */
export function hubChildren(all: readonly HubSummary[], ref: HubRef, limit = 24): HubSummary[] {
  const self = hubPath(ref);
  return all
    .filter((h) => {
      if (h.path === self || h.ref.il !== ref.il) return false;
      if (!ref.ilce) return ref.intent ? h.ref.intent === ref.intent && Boolean(h.ref.ilce) && !h.ref.mahalle : (Boolean(h.ref.ilce) && !h.ref.intent) || (!h.ref.ilce && Boolean(h.ref.intent));
      if (h.ref.ilce !== ref.ilce) return false;
      if (!ref.intent) return Boolean(h.ref.intent);
      return Boolean(h.ref.mahalle) && h.ref.intent === ref.intent;
    })
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .slice(0, limit);
}

/** Bağlantı metni (çocuk hub'lar listesi). */
export function hubLinkLabel(h: HubSummary): string {
  if (h.geo.mahalle) return `${h.geo.mahalle.name} ${intentPhrase(h.intent)}`;
  if (h.intent && h.geo.ilce) return cap(intentPhrase(h.intent));
  if (h.intent) return `${h.geo.il.name} ${intentPhrase(h.intent)}`;
  return h.geo.ilce?.name ?? h.geo.il.name;
}

/* ------------------------------ Yapılandırılmış veri ------------------------------ */

type Ld = Record<string, unknown>;

/** CollectionPage + ItemList (ilk 30 ilan) + BreadcrumbList + FAQPage (görünen SSS ile birebir). */
export function hubJsonLd(input: {
  base: string;
  path: string;
  name: string;
  description: string;
  listings: readonly Pick<HubListing, "href" | "title">[];
  crumbs: readonly { name: string; path?: string }[];
  faq: readonly { q: string; a: string }[];
}): Ld {
  const b = input.base.replace(/\/+$/, "");
  const url = `${b}${input.path}`;
  const graph: Ld[] = [
    {
      "@type": "CollectionPage",
      "@id": `${url}#sayfa`,
      name: input.name,
      description: input.description,
      url,
      inLanguage: "tr-TR",
      isPartOf: { "@id": `${b}/#website` },
      mainEntity: { "@id": `${url}#liste` },
    },
    {
      "@type": "ItemList",
      "@id": `${url}#liste`,
      numberOfItems: input.listings.length,
      itemListElement: input.listings.slice(0, 30).map((l, i) => ({ "@type": "ListItem", position: i + 1, url: `${b}${l.href}`, name: l.title })),
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: input.crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, ...(c.path ? { item: c.path === "/" ? b : `${b}${c.path}` } : {}) })),
    },
  ];
  if (input.faq.length > 0) {
    graph.push({ "@type": "FAQPage", mainEntity: input.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}
