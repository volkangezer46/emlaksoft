import { EMPTY_FILTERS, listingHref, type ListingFilters } from "@/lib/vitrin/listing-filters";
import type { NlGeo } from "@/lib/nl-search/parse";
import { cleanQuery, foldQuery } from "../normalize";
import { extractSlots } from "../slots";
import { describePropertyFilters, type ToolOutput } from "../tools";
import type { ZekaAction, ZekaCard, ZekaResult } from "../types";

/**
 * VİTRİN yüzeyi (bir ofisin herkese açık vitrini) — SAF yerel motor. Veri sınırı: YALNIZ o ofisin YAYINDAKİ ilanları
 * (sayım `vitrin_listing_search` ile, sunucuda). Ziyaretçinin doğal dil isteği ("Kadıköy'de 3+1, 10 milyon altı, deniz
 * manzaralı") vitrinin MEVCUT süzgeç sözleşmesine (`listing-filters.ts`) çevrilir. Talep bırakma YALNIZ vitrindeki mevcut
 * talep formuyla ve ziyaretçinin kendi onayıyla olur (Zeka form göndermez, kayıt açmaz).
 */

export type VitrinEnv = {
  slug: string;
  office: string;
  geo?: NlGeo;
  nowMs: number;
  /** Süzgece uyan yayındaki ilan sayısı (sunucu; okunamazsa null). */
  count: (f: ListingFilters) => Promise<number | null>;
};

/** Doğal dil → vitrin süzgeci (tam TL). Anlaşılmayan sözcükler serbest metin aramasına (q) gider. */
export function vitrinFiltersFrom(query: string, env: Pick<VitrinEnv, "geo" | "nowMs">): { filters: ListingFilters; label: string } {
  const s = extractSlots(query, { nowMs: env.nowMs, geo: env.geo });
  const raw = cleanQuery(query).split(/\s+/);
  const free = new Set(s.freeText.split(" ").filter((w) => w.length >= 3));
  const qWords = raw.filter((w) => free.has(foldQuery(w)) && !/^(ilan|ilanlar\w*|ev|evler\w*|bul|ara|var|mı|mi)$/i.test(w));
  const filters: ListingFilters = {
    ...EMPTY_FILTERS,
    tx: s.transaction === "Satılık" ? "satilik" : s.transaction === "Kiralık" ? "kiralik" : "",
    min: s.priceMin,
    max: s.priceMax,
    oda: s.rooms[0] ?? "",
    tur: s.propertyType ?? "",
    il: s.districtId ? "" : (s.provinceId ?? ""),
    ilce: s.districtId ?? "",
    mahalle: s.neighborhoodId ?? "",
    q: qWords.join(" ").slice(0, 80),
  };
  if (s.districtId && s.provinceId) filters.il = s.provinceId;
  return { filters, label: describePropertyFilters(s) };
}

export async function vitrinSearch(env: VitrinEnv, query: string): Promise<ToolOutput> {
  const { filters, label } = vitrinFiltersFrom(query, env);
  const href = listingHref(env.slug, filters);
  const count = await env.count(filters);
  const contact: ZekaAction = {
    kind: "contact",
    label: "Danışmana ilet",
    href: `${href}#talep-formu`,
    confirm: "Talep formu açılır; bilgilerinizi siz yazıp gönderdiğinizde danışman size ulaşır.",
  };
  const cards: ZekaCard[] = count != null ? [{ kind: "metric", label: `${label === "Tüm" ? "Yayındaki" : label} ilan`, value: String(count), href }] : [];
  const answer =
    count == null
      ? `${env.office} vitrininde bu kriterlerle ilanları listeledim.`
      : count === 0
        ? `${env.office} vitrininde bu kriterlere uyan yayında ilan yok. Kriterlerinizi danışmana iletirseniz uygun portföy çıkınca size döner.`
        : `${env.office} vitrininde bu kriterlere uyan ${count} ilan var.`;
  return {
    answer,
    cards,
    actions: count === 0 ? [contact, { kind: "navigate", label: "Tüm ilanlar", href: `/vitrin/${env.slug}` }] : [{ kind: "navigate", label: "İlanları göster", href }, contact],
    followUps: ["Kiralık olanlar", "Daha uygun fiyatlı", "Yer göstermesi istiyorum"],
    answered: true,
    confidence: count == null ? 0.6 : 0.85,
    summary: { durum: "bulundu", kriter: label, sayi: count },
  };
}

const CONTACT_RE = /\b(randevu|yer gosterme|gormek istiyorum|gorusme|ara(yin|sin)|iletisim|danisman|numara|telefon|bilgi almak)\b/;

export async function answerLocalVitrin(raw: string, env: VitrinEnv): Promise<ZekaResult> {
  const q = cleanQuery(raw);
  const folded = foldQuery(q);
  if (CONTACT_RE.test(folded)) {
    return {
      surface: "vitrin",
      engine: "local",
      intent: "create",
      answer: `Yer gösterme ya da bilgi için ${env.office} danışmanına talep bırakabilirsiniz. Formu siz doldurup gönderdiğinizde size dönülür; ben sizin adınıza bir şey göndermem.`,
      cards: [],
      actions: [{ kind: "contact", label: "Talep formunu aç", href: `/vitrin/${env.slug}#talep-formu`, confirm: "Bilgilerinizi siz yazıp gönderirsiniz." }],
      followUps: ["3+1 satılık daireler", "Kiralık ilanlar"],
      confidence: 0.85,
      answered: true,
    };
  }
  const out = await vitrinSearch(env, q);
  return { surface: "vitrin", engine: "local", intent: "search", answer: out.answer, cards: out.cards, actions: out.actions, followUps: out.followUps, confidence: out.confidence, answered: out.answered };
}

export const ZEKA_VITRIN_TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "search_listings",
      description: "Bu ofisin YAYINDAKİ ilanlarında doğal dil süzgeciyle (bölge, oda, fiyat, tür, satılık/kiralık) arar; sayı ve listeleme bağlantısı döner.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
];

export function vitrinRules(office: string): string {
  return [
    `Sen "${office}" emlak ofisinin vitrin asistanısın. Türkçe, kısa (en çok 3 cümle) ve nazik yanıt ver.`,
    "İlan sayısı ve kriterleri YALNIZ search_listings aracından al; ilan uydurma.",
    "Fiyat pazarlığı yapma, indirim veya kesin söz verme; hukuki, vergi veya kredi tavsiyesi verme; kişileri özelliklerine göre yönlendirme.",
    "Telefon, e-posta veya bağlantı yazma; iletişim için sayfadaki talep formunu öner. Ziyaretçi adına talep GÖNDEREMEZSİN.",
  ].join("\n");
}
