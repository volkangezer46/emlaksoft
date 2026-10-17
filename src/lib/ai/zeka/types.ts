/**
 * EmlakSoft Zeka — ortak tipler (SAF; sunucu ve istemci içe aktarabilir, yan etkisiz).
 *
 * TEK çekirdek, birden çok YÜZEY: her yüzeyin kendi araç seti ve veri sınırı vardır.
 *  - app    : ofis kullanıcısı (oturumlu, RLS + etkin izin + kapalı modül süzgeci).
 *  - public : platform sitesi ilk ziyaret sayfaları (oturumsuz; YALNIZ herkese açık ürün içeriği).
 *  - vitrin : bir ofisin herkese açık vitrini (YALNIZ o ofisin yayındaki ilanları).
 *  - admin  : platform personeli (salt okunur platform özeti).
 *
 * Kural: Zeka HİÇBİR ZAMAN veri yazmaz. "Oluştur" niyeti yalnız ön doldurulmuş bir FORM BAĞLANTISI üretir; kayıt,
 * kullanıcı formu açıp kendisi kaydettiğinde (mevcut kapılı server action'larla) oluşur.
 */

export const ZEKA_SURFACES = ["app", "public", "vitrin", "admin"] as const;
export type ZekaSurface = (typeof ZEKA_SURFACES)[number];

export const ZEKA_INTENTS = ["navigate", "search", "create", "data", "howto", "report", "unknown"] as const;
export type ZekaIntent = (typeof ZEKA_INTENTS)[number];

export const ZEKA_INTENT_LABELS: Record<ZekaIntent, string> = {
  navigate: "Gezinme",
  search: "Kayıt arama",
  create: "Oluşturma",
  data: "Veri sorusu",
  howto: "Nasıl yapılır",
  report: "Rapor",
  unknown: "Anlaşılamadı",
};

export type ZekaEngineId = "local" | "gpt";
export const ZEKA_MODES = ["auto", "local", "gpt"] as const;
export type ZekaMode = (typeof ZEKA_MODES)[number];

/** Zeka'nın tanıdığı iş varlıkları (Türkçe eş anlamlılarıyla `lexicon.ts`). */
export const ZEKA_ENTITIES = [
  "customer",
  "property",
  "demand",
  "appointment",
  "task",
  "deal",
  "offer",
  "contract",
  "rental",
  "dues",
  "finance",
  "commission",
  "campaign",
  "team",
  "report",
] as const;
export type ZekaEntity = (typeof ZEKA_ENTITIES)[number];

export type ZekaStatus = "overdue" | "today" | "open" | "done" | "won" | "lost" | "upcoming" | "new";

export type ZekaPeriodKey =
  | "today"
  | "tomorrow"
  | "yesterday"
  | "this_week"
  | "next_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_year"
  | "last_year"
  | "day";

/** Kapalı tarih aralığı (Türkiye takvimi, YYYY-MM-DD, `to` DAHİL). */
export type ZekaPeriod = { key: ZekaPeriodKey; from: string; to: string; label: string };

/** Sorgudan çıkarılan yuvalar (slot). Para HER ZAMAN tam TL (kısaltma yok). */
export type ZekaSlots = {
  entity: ZekaEntity | null;
  /** Birden çok varlık geçtiyse hepsi (ilki `entity`). */
  entities: ZekaEntity[];
  status: ZekaStatus | null;
  rooms: string[];
  priceMin: number | null;
  priceMax: number | null;
  transaction: "Satılık" | "Kiralık" | null;
  propertyType: string | null;
  provinceId: string | null;
  districtId: string | null;
  neighborhoodId: string | null;
  /** Bulunan konumun görünen adı ("Kadıköy (İstanbul)"). */
  placeLabel: string | null;
  /** Portföy listesi filtre parametreleri (nl-search sözleşmesi: islem, oda, fiyat_min…). */
  propertyParams: Record<string, string>;
  date: string | null;
  time: string | null;
  period: ZekaPeriod | null;
  personName: string | null;
  phone: string | null;
  listingCode: string | null;
  amount: number | null;
  /** Arama için arta kalan serbest metin (varlık/yuva sözcükleri çıkarılmış). */
  freeText: string;
};

export type ZekaRecordKind = "customer" | "property" | "demand" | "deal" | "task" | "ticket" | "listing";

export type ZekaCard =
  | { kind: "record"; entity: ZekaRecordKind; id: string; title: string; subtitle?: string; href: string }
  | { kind: "metric"; label: string; value: string; hint?: string; href?: string }
  | { kind: "nav"; label: string; description?: string; href: string }
  | { kind: "help"; title: string; body: string; href?: string; source?: string };

/**
 * Önerilen eylem: YALNIZ bağlantı. `create` bir formun ön doldurulmuş adresidir; kullanıcı formu kendisi kaydeder.
 * `confirm` panelde düğmenin yanında gösterilen onay cümlesidir ("Form açılır; kaydetmeden önce kontrol edin").
 */
export type ZekaAction = {
  kind: "navigate" | "create" | "contact";
  label: string;
  href: string;
  confirm?: string;
  prefill?: Record<string, string>;
};

export type ZekaResult = {
  surface: ZekaSurface;
  engine: ZekaEngineId;
  intent: ZekaIntent;
  answer: string;
  cards: ZekaCard[];
  actions: ZekaAction[];
  followUps: string[];
  /** 0..1 — eşik altı yanıtlar "emin değilim" der ve en yakın seçenekleri sunar. */
  confidence: number;
  /** Yanıt gerçekten soruyu karşıladı mı (öğrenme döngüsü: cevapsız sorular listesi). */
  answered: boolean;
  slots?: Partial<ZekaSlots>;
  /** Günlük kaydı kimliği (geri bildirim için; kayıt yazılamadıysa yok). */
  logId?: string;
  /** GPT istendi ama yerel motora düşüldüyse nedeni (gösterim/denetim; kişisel veri yok). */
  fallbackReason?: string;
};

/** Bir motorun sözleşmesi. Yerel ve GPT motoru AYNI araç setini kullanır. */
export interface ZekaEngine<C> {
  readonly id: ZekaEngineId;
  answer(query: string, ctx: C): Promise<ZekaResult>;
}

/** Girdi üst sınırı (uç noktalar ve motorlar aynı sınırı uygular). */
export const ZEKA_MAX_QUERY = 300;
/** Bu güvenin altı "emin değilim" sayılır. */
export const ZEKA_LOW_CONFIDENCE = 0.45;
