import { helpFaqHref, helpGuideHref, type HelpContent } from "./core";

/**
 * PA-7 yardım makalesi önerisi (saf, testli): yeni destek talebinin konusu yazılırken ilgili rehber/SSS maddeleri.
 * Türkçe katlama (büyük/küçük harf, ı/i, şapka/çengel) + kelime kökü yaklaşımı (ilk 5 harf) + başlık ağırlığı.
 * Yalnız anlamlı kelimeler sayılır (3+ harf, bağlaç/dolgu sözcükleri hariç); hiç eşleşme yoksa öneri yok.
 */

export type ArticleSuggestion = { kind: "guide" | "faq"; slug: string; title: string; snippet: string; href: string; score: number };

const STOP = new Set([
  "ve", "ile", "icin", "ama", "fakat", "veya", "bir", "bu", "su", "o", "da", "de", "ki", "mi", "mu", "ne", "nasil", "neden",
  "olmuyor", "olmadi", "yapamiyorum", "edemiyorum", "gitmiyor", "calismiyor", "sorun", "hata", "lutfen", "yardim", "var", "yok",
  "gibi", "daha", "cok", "her", "hic", "ben", "biz", "sey", "beni", "bana",
]);

export function foldTr(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
}

/** Sorgu kelimeleri: katlanmış, 3+ harf, dolgu sözcükleri hariç, en çok 8; kök = ilk 5 harf. */
export function queryStems(q: string): string[] {
  const words = foldTr(q)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
  return [...new Set(words.map((w) => w.slice(0, 5)))].slice(0, 8);
}

function scoreText(stems: readonly string[], title: string, body: string): number {
  const t = foldTr(title);
  const b = foldTr(body);
  let score = 0;
  let hits = 0;
  for (const s of stems) {
    const inTitle = t.includes(s);
    const inBody = b.includes(s);
    if (inTitle) score += 3;
    if (inBody) score += 1;
    if (inTitle || inBody) hits++;
  }
  if (hits === 0) return 0;
  // Kelimelerin çoğu eşleşen madde öne çıkar (tek ortak kelime zayıf öneri).
  return score + (hits / stems.length) * 2;
}

/** En iyi `limit` öneri (puan eşitse rehber önce). Tek kelimelik sorguda başlık eşleşmesi şart (gürültü yok). */
export function suggestHelpArticles(content: Pick<HelpContent, "guides" | "faq">, q: string, limit = 3): ArticleSuggestion[] {
  const stems = queryStems(q);
  if (stems.length === 0) return [];
  const minScore = stems.length === 1 ? 3 : 2;
  const out: ArticleSuggestion[] = [];
  for (const g of content.guides) {
    const score = scoreText(stems, g.title, [g.intro, ...g.steps].join(" "));
    if (score >= minScore) out.push({ kind: "guide", slug: g.slug, title: g.title, snippet: g.intro, href: helpGuideHref(g.slug), score });
  }
  for (const f of content.faq) {
    const score = scoreText(stems, f.q, f.a);
    if (score >= minScore) out.push({ kind: "faq", slug: f.id, title: f.q, snippet: f.a, href: helpFaqHref(f.id), score });
  }
  return out
    .sort((a, b) => b.score - a.score || (a.kind === b.kind ? 0 : a.kind === "guide" ? -1 : 1))
    .slice(0, limit)
    .map((s) => ({ ...s, snippet: s.snippet.length > 180 ? `${s.snippet.slice(0, 177).trimEnd()}…` : s.snippet }));
}
