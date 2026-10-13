import type { IssueProposal } from "./contracts";
import { suggest404Target } from "./not-found-suggest";
import { SEO_THRESHOLDS } from "./thresholds";

/**
 * KURAL ÖNERİLERİ (SAF, AI'SIZ, deterministik). Aynı girdi her zaman aynı öneriyi üretir.
 *  - long-description: açıklama sözcük sınırında 155 karaktere kısaltılır.
 *  - missing-og-title: paylaşım başlığı sayfa başlığından türetilir.
 *  - redirect_404: 404 yolu için mevcut not-found-suggest sonucu.
 * Eylem (`action`) yalnız otomatik iyileştirilebilir sayfada eklenir; manualOnly bulgu yalnız öneriyi gösterir.
 */

/** Sözcük sınırında kısaltır; sondaki noktalama/bağlaç kırpılır, cümle sonu noktası eklenir. Zaten kısaysa aynen döner. */
export function shortenAtWord(text: string, max: number = SEO_THRESHOLDS.suggestDescriptionMax): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  // Önce max içindeki son cümle sonu (yeterince uzunsa) — anlam bütünlüğü korunur.
  const window = clean.slice(0, max);
  const sentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("; "));
  if (sentenceEnd >= Math.floor(max * 0.6)) return `${window.slice(0, sentenceEnd).replace(/[;,]\s*$/, "")}.`;
  const cut = window.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const base = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut)
    .replace(/[\s,;:–—-]+$/, "")
    .replace(/\s+(ve|ile|veya|ya|ama|için)$/i, "")
    .replace(/[\s,;:–—-]+$/, "");
  return /[.!?…]$/.test(base) ? base : `${base}.`;
}

/** Başlık şablonu ekini (" | EmlakSoft") atar; paylaşım başlığı marka adıyla tek kez biter. */
export function ogTitleFromTitle(renderedTitle: string, siteName: string): string {
  const t = renderedTitle.replace(/\s+/g, " ").trim();
  const suffix = new RegExp(`\\s*[|·–—-]\\s*${siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  const core = t.replace(suffix, "").trim() || t;
  return core.toLowerCase().includes(siteName.toLowerCase()) ? core : `${core} | ${siteName}`;
}

export type RuleSuggestInput =
  | { rule: "long-description"; path: string; description: string; autoAction: boolean }
  | { rule: "missing-og-title"; path: string; renderedTitle: string; siteName: string; autoAction: boolean }
  | { rule: "redirect_404"; path: string; candidates: readonly string[] };

export function ruleSuggestion(input: RuleSuggestInput): IssueProposal | null {
  if (input.rule === "long-description") {
    const after = shortenAtWord(input.description);
    if (after === input.description.trim()) return null;
    return {
      rule: "long-description",
      summary: `${input.path} açıklaması ${input.description.trim().length}→${after.length} karakter`,
      field: "description",
      before: input.description,
      after,
      action: input.autoAction ? { kind: "seo_meta_draft", risk: "guvenli" } : undefined,
    };
  }
  if (input.rule === "missing-og-title") {
    const after = ogTitleFromTitle(input.renderedTitle, input.siteName);
    if (!after) return null;
    return {
      rule: "missing-og-title",
      summary: `${input.path} paylaşım başlığı: “${after}”`,
      field: "ogTitle",
      before: null,
      after,
      action: input.autoAction ? { kind: "seo_meta_draft", risk: "guvenli" } : undefined,
    };
  }
  const target = suggest404Target(input.path, input.candidates);
  if (!target) return null;
  return {
    rule: "redirect_404",
    summary: `${input.path} → ${target} yönlendirmesi (taslak)`,
    field: "redirect",
    before: input.path,
    after: target,
    action: { kind: "redirect_404_draft", risk: "guvenli" },
  };
}
