import type { RichBlock } from "@/lib/rich-text/core";
import { SERP_PX, descriptionPixels, titlePixels } from "./pixel-width";
import { containsPhrase, foldTr, keyTerms } from "./text-match";

/**
 * REHBER İÇERİK PUANI (SAF, istemci panelinde canlı çalışır; zod/ağ yok).
 * Okunabilirlik: Ateşman (1997) Türkçe okunabilirlik formülü — 198,825 − 40,175 × (hece/sözcük) − 2,610 × (sözcük/cümle);
 * Türkçede hece sayısı ünlü sayısına eşittir. Puan bir REHBERDİR: anahtar kelime doldurma ödüllendirilmez (yoğunluk
 * %3'ü aşarsa ceza), sözcük sayısı için üst ödül sınırı vardır.
 */

export type ContentCheck = { id: string; label: string; ratio: number; weight: number; detail: string; fix: string };

export type ContentScore = {
  total: number;
  checks: ContentCheck[];
  words: number;
  readability: { score: number; label: string } | null;
  /** Odak kelimenin metindeki yoğunluğu (%; odak kelime yoksa null). */
  density: number | null;
};

const VOWEL_RE = /[aeıioöuüâîûAEIİOÖUÜÂÎÛ]/g;

function inlineText(s: string): string {
  return s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1").replace(/\*\*|\*/g, "");
}

function blockText(b: RichBlock): string {
  switch (b.type) {
    case "p":
    case "h2":
    case "h3":
    case "quote":
      return inlineText(b.text);
    case "callout":
      return inlineText(`${b.title ?? ""} ${b.text}`);
    case "ul":
    case "ol":
      return b.items.map(inlineText).join(". ");
    case "table":
      return [b.caption ?? "", ...b.head, ...b.rows.flat()].join(" ");
    case "faq":
      return b.items.map((i) => `${i.q} ${inlineText(i.a)}`).join(" ");
    default:
      return "";
  }
}

/** Satır içi bağlantılar: [metin](href). */
export function inlineLinks(blocks: readonly RichBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    const texts = b.type === "p" || b.type === "quote" || b.type === "callout" ? [b.text] : b.type === "ul" || b.type === "ol" ? b.items : b.type === "faq" ? b.items.map((i) => i.a) : [];
    for (const t of texts) for (const m of t.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) out.push(m[1]!);
  }
  return out;
}

export function countWordsTr(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function syllables(word: string): number {
  return Math.max(1, (word.match(VOWEL_RE) ?? []).length);
}

/** Ateşman okunabilirlik puanı (0–100'e kırpılır). Metin çok kısaysa null. */
export function atesman(text: string): { score: number; label: string } | null {
  const sentences = text.split(/[.!?…]+(?:\s|$)/).map((s) => s.trim()).filter((s) => countWordsTr(s) > 0);
  const words = text.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (words.length < 30 || sentences.length === 0) return null;
  const syl = words.reduce((s, w) => s + syllables(w), 0);
  const raw = 198.825 - 40.175 * (syl / words.length) - 2.61 * (words.length / sentences.length);
  const score = Math.round(Math.max(0, Math.min(100, raw)));
  const label = score >= 90 ? "Çok kolay" : score >= 70 ? "Kolay" : score >= 50 ? "Orta" : score >= 30 ? "Zor" : "Çok zor";
  return { score, label };
}

export type ContentScoreInput = {
  title: string;
  seoTitle: string;
  seoDescription: string;
  body: readonly RichBlock[];
  focusKeyword?: string | null;
  /** Başlık şablonu ("%s | EmlakSoft"): piksel ölçümü basılacak başlıkla yapılır. */
  titleTemplate?: string;
  /** İç bağlantı sayılan yollar (yoksa "/" ile başlayan her bağlantı iç sayılır). */
  minWords?: number;
};

export function scoreContent(input: ContentScoreInput): ContentScore {
  const checks: ContentCheck[] = [];
  const add = (c: ContentCheck) => checks.push({ ...c, ratio: Math.max(0, Math.min(1, c.ratio)) });
  const text = input.body.map(blockText).filter(Boolean).join(". ");
  const words = countWordsTr(text);
  const minWords = input.minWords ?? 300;

  add({ id: "length", label: "Uzunluk", ratio: words >= 1200 ? 1 : words >= 800 ? 0.9 : words >= minWords ? 0.6 : words / minWords / 2, weight: 3, detail: `${words} sözcük`, fix: words < minWords ? `En az ${minWords} sözcük gerekir (altı aramalara kapalıdır).` : "Konuyu derinleştirin: örnek, tablo, adım adım anlatım ekleyin." });

  const read = atesman(text);
  if (read) add({ id: "readability", label: "Okunabilirlik (Ateşman)", ratio: read.score >= 60 ? 1 : read.score >= 50 ? 0.75 : read.score >= 40 ? 0.5 : 0.25, weight: 2, detail: `${read.score}/100 · ${read.label}`, fix: "Cümleleri kısaltın, uzun sözcükler yerine gündelik karşılıklarını kullanın." });

  const sentences = text.split(/[.!?…]+(?:\s|$)/).filter((s) => countWordsTr(s) > 0);
  const longSentences = sentences.filter((s) => countWordsTr(s) > 25).length;
  if (sentences.length >= 3) add({ id: "sentences", label: "Uzun cümle oranı", ratio: longSentences / sentences.length <= 0.25 ? 1 : longSentences / sentences.length <= 0.4 ? 0.5 : 0.2, weight: 1, detail: `${longSentences}/${sentences.length} cümle 25 sözcükten uzun`, fix: "25 sözcükten uzun cümleleri ikiye bölün." });

  const h2 = input.body.filter((b) => b.type === "h2");
  add({ id: "headings", label: "Ara başlıklar (H2)", ratio: h2.length >= 3 ? 1 : h2.length === 2 ? 0.8 : h2.length === 1 ? 0.5 : 0, weight: 2, detail: `${h2.length} ara başlık`, fix: "Okuru yönlendiren 3+ ara başlık (H2) ekleyin; içindekiler listesi bunlardan oluşur." });
  const per = h2.length > 0 ? words / h2.length : words;
  add({ id: "sections", label: "Bölüm uzunluğu", ratio: per <= 350 ? 1 : per <= 600 ? 0.5 : 0.2, weight: 1, detail: `başlık başına ~${Math.round(per)} sözcük`, fix: "Uzun bölümleri yeni ara başlıklarla bölün (≈300 sözcükte bir)." });
  const longParas = input.body.filter((b) => b.type === "p" && countWordsTr(inlineText(b.text)) > 150).length;
  add({ id: "paragraphs", label: "Paragraf uzunluğu", ratio: longParas === 0 ? 1 : longParas <= 2 ? 0.5 : 0.2, weight: 1, detail: longParas === 0 ? "Uzun paragraf yok" : `${longParas} paragraf 150 sözcükten uzun`, fix: "Uzun paragrafları bölün; telefonda okunurluk artar." });

  const links = inlineLinks(input.body);
  const internal = links.filter((h) => h.startsWith("/") && !h.startsWith("//")).length;
  add({ id: "internal-links", label: "İç bağlantılar", ratio: internal >= 3 ? 1 : internal === 2 ? 0.8 : internal === 1 ? 0.5 : 0, weight: 2, detail: `${internal} iç bağlantı`, fix: "İlgili rehber yazılarına, araçlara ve bölge sayfalarına en az 3 iç bağlantı verin." });
  const hasTool = input.body.some((b) => b.type === "toolEmbed");
  const hasFaq = input.body.some((b) => b.type === "faq");
  add({ id: "answer", label: "Soru-cevap / araç bloğu", ratio: hasFaq ? 1 : hasTool ? 0.7 : 0, weight: 1, detail: hasFaq ? "SSS bloğu var" : hasTool ? "Araç kartı var" : "Yok", fix: "Sık sorulan sorular (SSS) bloğu ekleyin: arama motorları ve yapay zekâ yanıtları doğrudan buradan alır." });

  const rendered = (input.titleTemplate ?? "%s").replace("%s", input.seoTitle || input.title);
  const tpx = titlePixels(rendered);
  add({ id: "seo-title", label: "SEO başlığı", ratio: tpx === 0 ? 0 : tpx <= SERP_PX.titleMax && tpx >= SERP_PX.titleMin ? 1 : 0.5, weight: 2, detail: `~${tpx} px`, fix: `Başlık ${SERP_PX.titleMin}–${SERP_PX.titleMax} px arasında olmalı.` });
  const dpx = descriptionPixels(input.seoDescription);
  add({ id: "seo-description", label: "SEO açıklaması", ratio: dpx === 0 ? 0.3 : dpx <= SERP_PX.descMax && dpx >= SERP_PX.descMin ? 1 : 0.6, weight: 1, detail: dpx === 0 ? "Boş (ilk paragraftan özet kullanılır)" : `~${dpx} px`, fix: "Ziyaretçiye ne öğreneceğini söyleyen 120–155 karakterlik bir açıklama yazın." });

  let density: number | null = null;
  const kw = (input.focusKeyword ?? "").trim();
  if (kw && keyTerms(kw).length > 0) {
    const firstPara = input.body.find((b) => b.type === "p");
    add({ id: "kw-title", label: "Odak kelime başlıkta", ratio: containsPhrase(input.seoTitle || input.title, kw) ? 1 : 0, weight: 2, detail: `“${kw}”`, fix: `SEO başlığında “${kw}” geçsin (mümkünse başta).` });
    add({ id: "kw-h1", label: "Odak kelime yazı başlığında", ratio: containsPhrase(input.title, kw) ? 1 : 0, weight: 1, detail: `“${kw}”`, fix: `Yazı başlığında (h1) “${kw}” geçsin.` });
    add({ id: "kw-intro", label: "Odak kelime ilk paragrafta", ratio: firstPara && firstPara.type === "p" && containsPhrase(inlineText(firstPara.text), kw) ? 1 : 0, weight: 1, detail: "Giriş paragrafı", fix: "Konuyu ilk paragrafta açıkça söyleyin." });
    add({ id: "kw-h2", label: "Odak kelime bir ara başlıkta", ratio: h2.some((b) => b.type === "h2" && containsPhrase(b.text, kw)) ? 1 : 0, weight: 1, detail: `${h2.length} ara başlık`, fix: "En az bir ara başlıkta odak kelimeyi ya da yakın anlamlısını kullanın." });
    add({ id: "kw-description", label: "Odak kelime açıklamada", ratio: containsPhrase(input.seoDescription, kw) ? 1 : 0, weight: 1, detail: input.seoDescription ? "SEO açıklaması" : "Açıklama boş", fix: "SEO açıklamasında odak kelime geçsin." });
    // Yoğunluk: odak ifadenin geçiş sayısı × ifade sözcük sayısı / toplam sözcük.
    const hay = ` ${foldTr(text)} `;
    const needle = ` ${foldTr(kw)} `;
    let count = 0;
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) count += 1;
    density = words > 0 ? Math.round(((count * keyTerms(kw).length) / words) * 1000) / 10 : 0;
    add({
      id: "kw-density",
      label: "Odak kelime yoğunluğu",
      ratio: density === 0 ? 0.2 : density > 3 ? 0 : density >= 0.5 && density <= 2.5 ? 1 : 0.6,
      weight: 1,
      detail: `%${density.toLocaleString("tr-TR")}`,
      fix: density > 3 ? "Odak kelime çok sık geçiyor (anahtar kelime doldurma); doğal yazın, yakın anlamlılarını kullanın." : "Odak kelimeyi metinde doğal biçimde birkaç kez kullanın (%0,5–2,5).",
    });
  }

  const w = checks.reduce((s, c) => s + c.weight, 0);
  const total = w === 0 ? 0 : Math.round((100 * checks.reduce((s, c) => s + c.weight * c.ratio, 0)) / w);
  return { total, checks, words, readability: read, density };
}
