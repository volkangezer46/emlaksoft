import { FAQ, FAQ_PRICE_PATTERN, type FaqItem } from "@/lib/help-faq";

/**
 * AI asistanına ürün kullanım bilgisi (SSS) besleme — SAF seçici. Ağ/AI çağrısı YOKTUR: seçilen kayıtlar yalnız
 * mevcut asistan çağrısına (src/lib/ai/openai-client.ts üzerinden; kişisel veri redact.ts ile maskelenir) sistem bağlamı
 * olarak eklenir. Ağ çağrısı burada yazılmaz.
 *
 * Dürüstlük: soruyla ilgili SSS kaydı bulunamazsa HİÇBİR şey eklenmez (uydurma yönlendirme yok). Fiyat/tutar içeren
 * kayıt asla beslenmez (güncel fiyat sayfada; FAQ_PRICE_PATTERN).
 */

const STOP = new Set([
  "ve", "ile", "bir", "bu", "su", "şu", "mi", "mı", "mu", "mü", "de", "da", "ne", "nasıl", "nasil", "icin", "için", "ama", "veya", "ya",
  "ben", "biz", "olarak", "gibi", "var", "yok", "kadar", "daha", "çok", "cok", "en", "her", "hangi", "nerede", "nereden", "neden",
  "yapabilirim", "yapılır", "yapilir", "edebilirim", "olur", "olabilir", "istiyorum", "lazım", "lazim", "emlaksoft",
]);

/** Türkçe küçük harf + noktalamasız belirteçler (en az 3 harf), ek kırpma: kaba kök (ilk 5 harf) ile eşleşir. */
export function tokenize(text: string): string[] {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/[^a-z0-9çğıöşü\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t))
    .map((t) => t.slice(0, 5));
}

export type FaqMatch = { item: FaqItem; score: number };

/** Soruyla en çok örtüşen SSS kayıtları (en az `minScore` ortak kök belirteç). Boş = ilgili kayıt yok. */
export function selectFaqForQuestion(question: string, faq: readonly FaqItem[] = FAQ, max = 2, minScore = 2): FaqMatch[] {
  const qTokens = new Set(tokenize(question));
  if (qTokens.size === 0) return [];
  const out: FaqMatch[] = [];
  for (const item of faq) {
    if (FAQ_PRICE_PATTERN.test(item.q) || FAQ_PRICE_PATTERN.test(item.a)) continue;
    const titleTokens = new Set(tokenize(item.q));
    const bodyTokens = new Set(tokenize(item.a));
    let score = 0;
    for (const t of qTokens) {
      if (titleTokens.has(t)) score += 2; // başlıkta geçen kök daha ağır
      else if (bodyTokens.has(t)) score += 1;
    }
    if (score >= minScore) out.push({ item, score });
  }
  return out.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id)).slice(0, Math.max(0, max));
}

/** Asistan sistem bağlamına eklenen blok; eşleşme yoksa boş metin. */
export function faqContextText(matches: readonly FaqMatch[]): string {
  if (matches.length === 0) return "";
  const lines = matches.map((m) => `- Soru: ${m.item.q}\n  Yanıt: ${m.item.a}${m.item.href ? `\n  Sayfa: ${m.item.href}` : ""}`);
  return [
    "ÜRÜN KULLANIM BİLGİSİ (resmî Yardım SSS'sinden; yalnız kullanıcı EmlakSoft'un nasıl kullanılacağını soruyorsa kullan,",
    "bu metinde olmayan özellik/fiyat uydurma, emin değilsen Yardım Merkezi'ne (/app/yardim) yönlendir):",
    ...lines,
  ].join("\n");
}

/** Mesaj listesinin son kullanıcı sorusu için bağlam bloğu (kısayol). */
export function faqContextForMessages(messages: readonly { role: string; content: string }[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  return faqContextText(selectFaqForQuestion(last));
}
