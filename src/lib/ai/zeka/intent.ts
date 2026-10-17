import { CREATE_CUES, DATA_CUES, HOWTO_CUES, NAV_CUES, REPORT_CUES } from "./lexicon";
import { anyPhrase, tokens } from "./normalize";
import type { ZekaIntent, ZekaSlots } from "./types";

/**
 * Niyet sınıflandırma (SAF, kural tabanlı, açıklanabilir). Her karar bir ipucuna dayanır; güven puanı ipucunun gücüdür.
 * Sıra: nasıl-yapılır → veri sorusu → oluşturma → rapor → gezinme → durumlu liste → kayıt arama → yalnız varlık → serbest arama.
 */

export type IntentDecision = { intent: ZekaIntent; confidence: number; reason: string };

const QUESTION_END = /\?\s*$/;
const WEAK_CREATE = new Set(["ac", "yaz", "yeni"]);

export function classifyIntent(raw: string, slots: ZekaSlots): IntentDecision {
  const toks = tokens(raw);
  if (toks.length === 0) return { intent: "unknown", confidence: 0, reason: "boş" };

  const hasHowto = anyPhrase(toks, HOWTO_CUES);
  const hasData = anyPhrase(toks, DATA_CUES.filter((c) => c !== "goster" && c !== "liste" && c !== "listele"));
  const hasList = anyPhrase(toks, ["goster", "listele", "liste", "neler", "hangileri"]);
  // "yeni" ve "aç" zayıf fiildir: "yeni talepler" bir listedir, "portföyler sayfasını aç" gezinmedir.
  const strongCreate = anyPhrase(toks, CREATE_CUES.filter((c) => !WEAK_CREATE.has(c)));
  const pluralWord = toks.some((t) => /(ler|lar)(?:i|im|imiz|in)?$/.test(t));
  const weakCreate = toks.includes("ac") || toks.includes("yaz") || (toks.includes("yeni") && !pluralWord);
  const hasReport = anyPhrase(toks, REPORT_CUES);
  const hasNav = anyPhrase(toks, NAV_CUES.filter((c) => c !== "goster" && c !== "ac"));
  const hasCreate = strongCreate || (weakCreate && !hasNav);
  const entity = slots.entity;
  const hasRecordHint = Boolean(slots.phone || slots.listingCode || slots.personName);
  const hasPropertySlots = Object.keys(slots.propertyParams).length > 0;

  // "Nasıl …" her zaman yardım; ama "kaç / ne kadar" ile birlikte veri sorusudur ("bu ay ne kadar satış").
  if (hasHowto && !anyPhrase(toks, ["kac", "ne kadar", "toplam"])) {
    return { intent: "howto", confidence: 0.82, reason: "nasıl-yapılır ipucu" };
  }
  if (hasData && (entity || hasPropertySlots || slots.status)) {
    return { intent: "data", confidence: entity ? 0.86 : 0.7, reason: "sayı/toplam sorusu" };
  }
  // Oluşturma: fiil + varlık, ya da "X için yarın 14:00 randevu" (randevu/görev + zaman + kişi, soru değil).
  const scheduleLike = (entity === "appointment" || entity === "task") && Boolean(slots.date || slots.time) && !QUESTION_END.test(raw);
  if ((hasCreate && entity) || (scheduleLike && (slots.personName || hasCreate || slots.time))) {
    const strong = strongCreate && entity ? 0.9 : hasCreate && entity ? 0.82 : 0.78;
    return { intent: "create", confidence: strong, reason: "oluşturma fiili / zamanlı kayıt" };
  }
  if (hasReport) return { intent: "report", confidence: 0.74, reason: "rapor ipucu" };
  if (hasNav && entity) return { intent: "navigate", confidence: 0.8, reason: "gezinme fiili" };
  if (slots.status && entity) return { intent: "data", confidence: 0.76, reason: "durumlu liste" };
  if (hasList && entity && !hasPropertySlots && !hasRecordHint) return { intent: "data", confidence: 0.7, reason: "liste isteği" };
  if (hasRecordHint || hasPropertySlots) return { intent: "search", confidence: hasPropertySlots ? 0.8 : 0.72, reason: "kayıt/filtre ipucu" };
  if (hasData) return { intent: "data", confidence: 0.5, reason: "soru (varlık belirsiz)" };
  if (entity && toks.length <= 2) return { intent: "navigate", confidence: 0.72, reason: "yalnız varlık adı" };
  // Tek-iki sözcük, başka ipucu yok ("ayarlar", "takvim"): büyük olasılıkla sayfa adı.
  if (toks.length <= 2 && !QUESTION_END.test(raw)) return { intent: "navigate", confidence: 0.55, reason: "kısa sayfa adı" };
  if (hasNav) return { intent: "navigate", confidence: 0.6, reason: "gezinme fiili" };
  if (QUESTION_END.test(raw)) return { intent: "howto", confidence: 0.45, reason: "soru işareti" };
  return { intent: "search", confidence: 0.42, reason: "serbest metin" };
}
