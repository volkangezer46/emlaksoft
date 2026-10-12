/** Site içeriği sabitleri ve saf yardımcılar: zod'suz çekirdek (istemci editörü içe aktarır; şema/doğrulayıcı schema.ts'te). */
import type { Issue } from "@/lib/site-menu/schema-core";
import type { LayoutItem, SiteContent } from "./schema";

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
  { id: "emlakfiyati", label: "EmlakFiyati analiz bakiyesi bölümü" },
  { id: "diger", label: "Ayrıntılar" },
  { id: "neden", label: "Neden EmlakSoft (karşılaştırma)" },
  { id: "nasil", label: "Nasıl çalışır" },
  { id: "guvenlik", label: "Güvenlik ve KVKK" },
  { id: "fiyat", label: "Fiyatlar" },
  { id: "sss", label: "Sık sorulan sorular" },
  { id: "son", label: "Son çağrı" },
] as const;
export type LandingSectionId = (typeof LANDING_SECTIONS)[number]["id"];
export const LANDING_IDS = LANDING_SECTIONS.map((s) => s.id) as [LandingSectionId, ...LandingSectionId[]];

export const SECTION_KEYS = ["tur", "ozellikler", "diger", "neden", "nasil", "fiyat", "sss", "guvenlik"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];


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


/** Metnin ilk cümlesi (satır sonları boşluk sayılır; nokta/ünlem/soru/üç nokta ile biten ilk parça; yoksa metnin tamamı). Saf. */
export function firstSentence(value: string): string {
  const t = value.replace(/\s+/g, " ").trim();
  const m = /^(.+?[.!?…])(?=\s|$)/.exec(t);
  return (m ? m[1]! : t).trim();
}


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


export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((i) => i.level === "error");
}

/** Taslak/canlı karşılaştırması (alan sırası değişmez: iki taraf da aynı şemadan gelir). */
export function sameContent(a: SiteContent | null, b: SiteContent | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
