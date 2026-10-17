import type { NlGeo } from "@/lib/nl-search/parse";
import { classifyIntent, type IntentDecision } from "./intent";
import { pickMetric, type MetricId } from "./metrics";
import { cleanQuery, foldQuery, tokens } from "./normalize";
import { detectEntities, extractSlots } from "./slots";
import { ZEKA_MAX_QUERY, type ZekaIntent, type ZekaSlots } from "./types";

/**
 * ÇOK TURLU BAĞLAM (SAF). Sunucu durumsuzdur: istemci aynı konuşmanın son sorularını (`history`, eskiden yeniye, en çok
 * 3) gönderir; sunucu onları SIRAYLA yeniden çözer ve bir önceki turun yuvalarını (varlık, bölge, oda, fiyat, dönem,
 * durum, kişi) ve niyetini çıkarır. Yeni soru bir TAKİP sorusuysa ("bunlardan kaçı kiralık?", "peki geçen ay?",
 * "Beşiktaş'ta?") eksik yuvalar önceki turdan tamamlanır; değilse bağlam hiç kullanılmaz.
 *
 * Güvenlik: geçmiş yalnız SÜZGEÇ taşır. Yetki/kapsam her turda araçlarda yeniden uygulanır (rolün göremediği veri
 * önceki turdan da gelemez); geçmiş istemciden geldiği için güvenilmez girdi sayılır, yalnız metin olarak ayrıştırılır.
 */

export const ZEKA_MAX_HISTORY = 3;

export type TurnCarry = { slots: ZekaSlots; intent: ZekaIntent; metric: MetricId | null };

type SlotOpts = { nowMs: number; geo?: NlGeo };

/** İstemciden gelen geçmişi temizler (dizi değilse boş; her öğe 2–300 karakter; en çok son 3). */
export function sanitizeHistory(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim().slice(0, ZEKA_MAX_QUERY))
    .filter((x) => x.length >= 2)
    .slice(-ZEKA_MAX_HISTORY);
}

/** Sayfa bağlamı: yalnız site içi yol (sorgu/karma atılır), en çok 120 karakter. Geçersizse null. */
export function sanitizePage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.split(/[?#]/)[0]!.trim().slice(0, 120);
  return /^\/[A-Za-z0-9/_.\-]*$/.test(path) && !path.includes("//") ? path : null;
}

/** Takip sorusu ipuçları (katlanmış). "kaçı" = "bunlardan kaçı" demektir. */
const ANAPHORA = new Set([
  "bunlar", "bunlardan", "bunlarin", "bunlari", "bunlarda", "bunlarla",
  "onlar", "onlardan", "onlarin", "onlari", "onlarda",
  "sunlar", "sunlardan", "bunun", "bundan", "onun", "ondan",
  "icinden", "ayni", "peki", "kaci", "kacinin", "hangisi", "hangileri", "olanlar", "olanlari", "olani",
]);
const PARTICLES = new Set(["peki", "ya", "ve", "bir de", "o zaman", "simdi"]);
const COUNT_CUE = /\b(kac\w*|ne kadar|toplam\w*|sayisi)\b/;

/** Baştaki/sondaki takip sözcüklerini atar ("Peki Beşiktaş'ta?" → "Beşiktaş'ta?"): ad ya da yer sanılmasın. */
export function stripFollowParticles(query: string): string {
  let q = cleanQuery(query);
  for (let i = 0; i < 2; i += 1) {
    const words = q.split(/\s+/);
    const first = foldQuery(words[0] ?? "");
    if (words.length > 1 && PARTICLES.has(first)) q = words.slice(1).join(" ");
    const w2 = q.split(/\s+/);
    const last = foldQuery((w2[w2.length - 1] ?? "").replace(/[?.!]+$/, ""));
    if (w2.length > 1 && last === "ya") q = `${w2.slice(0, -1).join(" ")}${/[?]$/.test(q) ? "?" : ""}`;
  }
  return q;
}

function hasFilterSlot(s: ZekaSlots): boolean {
  return Boolean(
    s.period || s.status || s.transaction || s.rooms.length || s.priceMin != null || s.priceMax != null || s.propertyType || s.districtId || s.provinceId || s.neighborhoodId || s.date,
  );
}

/**
 * Bu soru bir önceki turun DEVAMI mı? (1) gönderme sözcüğü ("bunlardan", "peki", "kaçı", "olanlar"), (2) "ya" ile
 * başlayan/biten soru, (3) varlık adı geçmeyen ama süzgeç taşıyan kısa soru ("geçen ay?", "Kadıköy'de?"). Tek başına
 * sayfa adı ("ayarlar") takip sayılmaz.
 */
export function isFollowUp(query: string, cur: ZekaSlots): boolean {
  const toks = tokens(foldQuery(query));
  if (toks.length === 0) return false;
  if (toks.some((t) => ANAPHORA.has(t))) return true;
  if (toks[0] === "ya" || toks[toks.length - 1] === "ya") return true;
  const explicit = detectEntities(toks);
  return toks.length <= 3 && explicit.length === 0 && !cur.phone && !cur.listingCode && hasFilterSlot(cur);
}

const PLACE_KEYS = ["il", "ilce", "mahalle"] as const;

/** Önceki turun yuvalarını yenisiyle birleştirir: YENİ soru her zaman kazanır, eksikler önceki turdan gelir. */
export function mergeSlots(prev: ZekaSlots, cur: ZekaSlots): ZekaSlots {
  const entity = cur.entity ?? prev.entity;
  const same = entity === prev.entity;
  const curHasPlace = Boolean(cur.provinceId || cur.districtId || cur.neighborhoodId);
  const prevParams: Record<string, string> = same ? { ...prev.propertyParams } : {};
  if (curHasPlace) for (const k of PLACE_KEYS) delete prevParams[k];
  if (!same && !curHasPlace) for (const k of PLACE_KEYS) if (prev.propertyParams[k]) prevParams[k] = prev.propertyParams[k]!;
  const propertyParams: Record<string, string> = { ...prevParams, ...cur.propertyParams };
  if (entity !== "property" && entity !== null) delete propertyParams.islem;
  const place = curHasPlace ? cur : prev;
  return {
    ...cur,
    entity,
    entities: cur.entities.length ? cur.entities : prev.entities,
    status: cur.status ?? (same ? prev.status : null),
    rooms: cur.rooms.length ? cur.rooms : same ? prev.rooms : [],
    priceMin: cur.priceMin ?? (same ? prev.priceMin : null),
    priceMax: cur.priceMax ?? (same ? prev.priceMax : null),
    transaction: entity === "property" ? (cur.transaction ?? (same ? prev.transaction : null)) : null,
    propertyType: cur.propertyType ?? (same ? prev.propertyType : null),
    provinceId: place.provinceId,
    districtId: place.districtId,
    neighborhoodId: place.neighborhoodId,
    placeLabel: place.placeLabel,
    propertyParams,
    date: cur.date ?? prev.date,
    time: cur.time ?? prev.time,
    period: cur.period ?? prev.period,
    personName: cur.personName ?? prev.personName,
    phone: cur.phone ?? prev.phone,
    listingCode: cur.listingCode ?? prev.listingCode,
  };
}

/** Takip sorusunda niyet: sayı ipucu varsa veri sorusu; belirsizse önceki turun veri/arama niyeti sürer. */
export function inheritIntent(decision: IntentDecision, carry: TurnCarry, query: string): IntentDecision {
  const folded = foldQuery(query);
  if (decision.intent === "create" || (decision.intent === "howto" && decision.confidence >= 0.8)) return decision;
  if (COUNT_CUE.test(folded)) return { intent: "data", confidence: Math.max(decision.confidence, 0.8), reason: "takip: sayı sorusu" };
  if ((carry.intent === "data" || carry.intent === "search") && decision.intent !== carry.intent) {
    return { intent: carry.intent, confidence: Math.max(0.7, Math.min(decision.confidence, 0.8)), reason: "takip: önceki niyet" };
  }
  return decision;
}

export type ResolvedTurn = { query: string; slots: ZekaSlots; decision: IntentDecision; followUp: boolean; carry: TurnCarry | null };

/** Bir turu (önceki bağlamla) çözer: yuvalar + niyet + metrik. */
export function resolveTurn(raw: string, prev: TurnCarry | null, opts: SlotOpts): ResolvedTurn {
  const query = cleanQuery(raw);
  const stripped = prev ? stripFollowParticles(query) : query;
  const cur = extractSlots(stripped, opts);
  const followUp = Boolean(prev) && isFollowUp(query, cur);
  const slots = followUp && prev ? mergeSlots(prev.slots, cur) : cur;
  const base = classifyIntent(stripped, slots);
  const decision = followUp && prev ? inheritIntent(base, prev, query) : base;
  return { query: followUp ? stripped : query, slots, decision, followUp, carry: followUp ? prev : null };
}

/** Geçmişi sırayla katlar: son turun bağlamı (geçmiş boşsa null). */
export function buildCarry(history: readonly string[], opts: SlotOpts): TurnCarry | null {
  let carry = null as TurnCarry | null;
  for (const q of history.slice(-ZEKA_MAX_HISTORY)) {
    const prev: TurnCarry | null = carry;
    const t = resolveTurn(q, prev, opts);
    const metric: MetricId | null = pickMetric(foldQuery(t.query), t.slots) ?? (t.followUp && prev ? prev.metric : null);
    carry = { slots: t.slots, intent: t.decision.intent, metric };
  }
  return carry;
}

/** GPT sistem istemine eklenen bağlam satırı (yalnız soru metinleri; kişisel veri openai-client'ta maskelenir). */
export function historyPromptLine(history: readonly string[]): string {
  if (history.length === 0) return "";
  return `ÖNCEKİ SORULAR (eskiden yeniye; yeni soru bunların devamı olabilir, "bunlar/onlar" bu bağlama gönderme yapar):\n${history.map((h, i) => `${i + 1}. ${h}`).join("\n")}`;
}
