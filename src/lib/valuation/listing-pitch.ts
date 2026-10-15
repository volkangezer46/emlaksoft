/**
 * PF-03 — Yetki alma sunumu: değerleme raporuna "neden bizimle?" bölümü. SAF modül (veri okuması
 * `listing-pitch-data.ts`, kayıt `valuations.sources` içindeki `__sunum` elemanı).
 *
 * Kurallar:
 *  - Kanıt kartları YALNIZ ofisin kendi gerçek verisinden (kazanılmış anlaşma, açık talep). Örnek veri sayılmaz.
 *  - Örneklem eşiği: n < 3 ise kart hiç çizilmez; rakam uydurulmaz, "az veri" kartı da gösterilmez.
 *  - Public sayfada yalnız TOPLU sayılar görünür: müşteri, adres ya da portföy kimliği sızmaz.
 *  - Sayılar sunum kaydedildiği anın anlık görüntüsüdür (tarihiyle birlikte gösterilir).
 */

export const PRESENTATION_ENTRY_NAME = "__sunum";
export const PITCH_MIN_SAMPLE = 3;

export type PitchDeal = {
  /** Kapanış fiyatı (deals.deal_value). */
  salePrice: number | null;
  /** Portföyün liste fiyatı (kapanış anındaki). */
  listPrice: number | null;
  /** İlana çıkıştan kapanışa gün. */
  daysOnMarket: number | null;
};

export type PitchInput = {
  areaLabel: string | null;
  /** Bölge (ilçe) kapsamında son 12 ayın kazanılmış SATIŞ anlaşmaları. */
  deals: readonly PitchDeal[];
  /** Bölgede açık (kapanmamış) satın alma talebi sayısı. */
  openBuyerDemands: number;
};

export type PitchCard = {
  key: "sold" | "days" | "ratio" | "buyers";
  label: string;
  value: string;
  note: string;
};

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const nf = (n: number, digits = 0) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits }).format(n);

/** En çok 4 kanıt kartı; eşik altı kart düşer. */
export function buildPitchCards(input: PitchInput): PitchCard[] {
  const area = input.areaLabel ? `${input.areaLabel} bölgesinde` : "Bölgede";
  const cards: PitchCard[] = [];

  if (input.deals.length >= PITCH_MIN_SAMPLE) {
    cards.push({ key: "sold", label: "Son 12 ayda satış", value: `${nf(input.deals.length)} işlem`, note: `${area} ofisimizin tamamladığı satışlar` });
  }

  const days = input.deals
    .map((d) => d.daysOnMarket)
    .filter((d): d is number => d != null && Number.isFinite(d) && d >= 0 && d <= 3650);
  const medDays = days.length >= PITCH_MIN_SAMPLE ? median(days) : null;
  if (medDays != null) {
    cards.push({ key: "days", label: "Ortalama satış süresi", value: `${nf(Math.round(medDays))} gün`, note: `İlana çıkıştan satışa (medyan, ${nf(days.length)} işlem)` });
  }

  const ratios = input.deals
    .map((d) => (d.salePrice && d.listPrice && d.listPrice > 0 ? d.salePrice / d.listPrice : null))
    .filter((r): r is number => r != null && r >= 0.5 && r <= 1.5);
  const medRatio = ratios.length >= PITCH_MIN_SAMPLE ? median(ratios) : null;
  if (medRatio != null) {
    cards.push({ key: "ratio", label: "Satış / ilan fiyatı", value: `%${nf(medRatio * 100, 1)}`, note: `Satış fiyatının ilan fiyatına oranı (medyan, ${nf(ratios.length)} işlem)` });
  }

  if (input.openBuyerDemands >= PITCH_MIN_SAMPLE) {
    cards.push({ key: "buyers", label: "Kayıtlı alıcı talebi", value: `${nf(input.openBuyerDemands)} alıcı`, note: `${area} satın almak için bekleyen müşterilerimiz` });
  }

  return cards.slice(0, 4);
}

export type MarketingItemKey =
  | "pro_photo"
  | "tour360"
  | "portals"
  | "vitrin"
  | "matched_buyers"
  | "open_house"
  | "social"
  | "weekly_report";

export const MARKETING_ITEMS: ReadonlyArray<{ key: MarketingItemKey; label: string; detail: string }> = [
  { key: "pro_photo", label: "Profesyonel fotoğraf", detail: "Gün ışığında, geniş açı çekim; ilan görselleri filigranlı." },
  { key: "tour360", label: "360° sanal tur", detail: "Alıcı evi gezmeden önce tüm odaları görür; boşa gösterim azalır." },
  { key: "portals", label: "Portallarda yayın", detail: "İlanınız üye olduğumuz emlak portallarında aynı gün yayında." },
  { key: "vitrin", label: "Ofis vitrini", detail: "Kendi web sitemizde öne çıkan ilan olarak yer alır." },
  { key: "matched_buyers", label: "Kayıtlı alıcılara gönderim", detail: "Kriterleri uyan alıcı müşterilerimize ilk gün iletilir." },
  { key: "open_house", label: "Açık ev günü", detail: "Planlı ziyaret günü; tek seferde birden çok ciddi alıcı." },
  { key: "social", label: "Sosyal medya tanıtımı", detail: "Bölgeye hedefli paylaşım ve kısa video." },
  { key: "weekly_report", label: "Haftalık ilgi raporu", detail: "Görüntülenme, arama ve gösterim sayıları her hafta size iletilir." },
];

export const DEFAULT_MARKETING_ITEMS: MarketingItemKey[] = ["pro_photo", "portals", "matched_buyers", "weekly_report"];

export type PresentationOptions = {
  enabled: boolean;
  trackRecord: boolean;
  marketing: boolean;
  advisor: boolean;
  cta: boolean;
  marketingItems: MarketingItemKey[];
};

export const DEFAULT_PRESENTATION_OPTIONS: PresentationOptions = {
  enabled: false,
  trackRecord: true,
  marketing: true,
  advisor: true,
  cta: true,
  marketingItems: DEFAULT_MARKETING_ITEMS,
};

export type PresentationEntry = {
  name: typeof PRESENTATION_ENTRY_NAME;
  weight: 0;
  value: 0;
  note: string;
  options: PresentationOptions;
  cards: PitchCard[];
  /** Portal adları (pazarlama planındaki "Portallarda yayın" maddesine eklenir). */
  portals: string[];
  areaLabel: string | null;
  computed_at: string;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const MARKETING_KEYS = new Set<string>(MARKETING_ITEMS.map((m) => m.key));

export function sanitizePresentationOptions(v: unknown): PresentationOptions {
  const o = isObj(v) ? v : {};
  const bool = (k: keyof PresentationOptions, d: boolean) => (typeof o[k] === "boolean" ? (o[k] as boolean) : d);
  const items = Array.isArray(o.marketingItems)
    ? Array.from(new Set(o.marketingItems.filter((x): x is MarketingItemKey => typeof x === "string" && MARKETING_KEYS.has(x))))
    : DEFAULT_MARKETING_ITEMS;
  return {
    enabled: bool("enabled", false),
    trackRecord: bool("trackRecord", true),
    marketing: bool("marketing", true),
    advisor: bool("advisor", true),
    cta: bool("cta", true),
    marketingItems: items,
  };
}

const CARD_KEYS = new Set(["sold", "days", "ratio", "buyers"]);

/** Kayıttaki sunum elemanını okur (yoksa null). Kart metinleri yalnız string kabul edilir. */
export function readPresentationEntry(sources: unknown): PresentationEntry | null {
  const list = Array.isArray(sources) ? sources : [];
  const raw = list.find((s) => isObj(s) && s.name === PRESENTATION_ENTRY_NAME) as Record<string, unknown> | undefined;
  if (!raw) return null;
  const cards = Array.isArray(raw.cards)
    ? raw.cards
        .filter((c): c is Record<string, unknown> => isObj(c) && typeof c.key === "string" && CARD_KEYS.has(c.key))
        .map((c) => ({ key: c.key as PitchCard["key"], label: String(c.label ?? ""), value: String(c.value ?? ""), note: String(c.note ?? "") }))
        .slice(0, 4)
    : [];
  return {
    name: PRESENTATION_ENTRY_NAME,
    weight: 0,
    value: 0,
    note: typeof raw.note === "string" ? raw.note : "",
    options: sanitizePresentationOptions(raw.options),
    cards,
    portals: Array.isArray(raw.portals) ? raw.portals.filter((p): p is string => typeof p === "string").slice(0, 12) : [],
    areaLabel: typeof raw.areaLabel === "string" ? raw.areaLabel : null,
    computed_at: typeof raw.computed_at === "string" ? raw.computed_at : "",
  };
}

export function presentationEntry(input: {
  options: PresentationOptions;
  cards: PitchCard[];
  portals: string[];
  areaLabel: string | null;
  computedAt: string;
}): PresentationEntry {
  return {
    name: PRESENTATION_ENTRY_NAME,
    weight: 0,
    value: 0,
    note: "Yetki alma sunumu ayarları ve ofis kanıt kartlarının anlık görüntüsü (fiyat hesabına girmez).",
    options: input.options,
    cards: input.cards,
    portals: input.portals,
    areaLabel: input.areaLabel,
    computed_at: input.computedAt,
  };
}

/** Pazarlama planı satırları (seçili maddeler; portallar varsa adları eklenir). */
export function marketingPlanLines(entry: Pick<PresentationEntry, "options" | "portals">): Array<{ key: MarketingItemKey; label: string; detail: string }> {
  return MARKETING_ITEMS.filter((m) => entry.options.marketingItems.includes(m.key)).map((m) =>
    m.key === "portals" && entry.portals.length > 0
      ? { ...m, detail: `İlanınız ${entry.portals.join(", ")} portallarında aynı gün yayında.` }
      : m,
  );
}
