import { isActiveStatus } from "./state";
import type { IssueArea, IssueSeverity, IssueStatus } from "./types";

/**
 * SİTE NOTU (SAF): 100'den başlar, açık her bulgu önemine göre düşürür (kritik −8, uyarı −3, bilgi −0,5), alan
 * ağırlığıyla çarpılır; taban 0. Veri yoksa not YOKTUR (`null`): sahte sayı gösterilmez.
 * "Şunu düzeltirseniz +N": tek başına en çok puan kazandıran 3 bulgu; N tabanı hesaba katan gerçek fark.
 */

export const SEVERITY_PENALTY: Record<IssueSeverity, number> = { kritik: 8, uyari: 3, bilgi: 0.5 };

/** Alan ağırlıkları: arama görünürlüğü ve hız ziyaretçiyi doğrudan etkiler; ölçüm/reklam/içerik dolaylı. */
export const AREA_WEIGHT: Record<IssueArea, number> = { seo: 1, hiz: 1, olcum: 0.75, reklam: 0.5, icerik: 0.75 };

export type ScoredIssue = { id: string; area: IssueArea; severity: IssueSeverity; status: IssueStatus; url: string; title: string };

export const issuePenalty = (i: Pick<ScoredIssue, "area" | "severity">) => SEVERITY_PENALTY[i.severity] * AREA_WEIGHT[i.area];

const clampScore = (penalty: number) => Math.max(0, Math.round((100 - penalty) * 10) / 10);

/** Açık bulgulardan not; `hasData` false ise (hiç toplayıcı çalışmadı) null. */
export function siteScore(issues: readonly ScoredIssue[], hasData: boolean): number | null {
  if (!hasData) return null;
  const penalty = issues.filter((i) => isActiveStatus(i.status)).reduce((s, i) => s + issuePenalty(i), 0);
  return clampScore(penalty);
}

/** Alan notu (ağırlıksız): alanın kendi kutucuğu için. */
export function areaScore(issues: readonly ScoredIssue[], area: IssueArea, hasData: boolean): number | null {
  if (!hasData) return null;
  const penalty = issues.filter((i) => i.area === area && isActiveStatus(i.status)).reduce((s, i) => s + SEVERITY_PENALTY[i.severity], 0);
  return clampScore(penalty);
}

export type GainSuggestion = { picks: ScoredIssue[]; gain: number };

/** En büyük kazancı veren en çok 3 açık bulgu ve bunlar düzelince notun gerçek artışı (taban 0 hesaba katılır). */
export function topGains(issues: readonly ScoredIssue[], limit = 3): GainSuggestion {
  const active = issues.filter((i) => isActiveStatus(i.status));
  const picks = [...active].sort((a, b) => issuePenalty(b) - issuePenalty(a) || a.url.localeCompare(b.url)).slice(0, limit);
  const before = siteScore(active, true) ?? 0;
  const ids = new Set(picks.map((p) => p.id));
  const after = siteScore(active.filter((i) => !ids.has(i.id)), true) ?? 0;
  return { picks, gain: Math.round((after - before) * 10) / 10 };
}

/** Puanı Türkçe yazar: 92,5 / 100. */
export function formatScore(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

const distinctUrls = (issues: readonly ScoredIssue[]) => new Set(issues.map((i) => i.url)).size;

/**
 * Alan için teknik olmayan TEK cümle. Kutucuğun ana satırı budur; LCP/INP/p75 gibi terimler yalnız ikincil satırda.
 * `connected` false: toplayıcı yok; `hasData` false: toplayıcı var ama henüz sonuç yok.
 */
export function areaSentence(area: IssueArea, issues: readonly ScoredIssue[], state: { connected: boolean; hasData: boolean }): string {
  if (!state.connected) return "Henüz bağlı değil";
  if (!state.hasData) return "Veri birikiyor";
  const open = issues.filter((i) => i.area === area && isActiveStatus(i.status));
  const pages = distinctUrls(open);
  const critical = open.filter((i) => i.severity === "kritik").length;
  if (open.length === 0) {
    return {
      seo: "Arama motorları sitenizde sorun görmüyor",
      hiz: "Sayfalarınız hızlı açılıyor",
      olcum: "Ziyaretçi ölçümü sorunsuz çalışıyor",
      reklam: "Reklamlarda bekleyen iyileştirme yok",
      icerik: "İçerikte bekleyen eksik yok",
    }[area];
  }
  const urgent = critical > 0 ? `; ${critical} tanesi acil` : "";
  switch (area) {
    case "seo":
      return `Arama motorları ${pages} sayfanızda sorun görüyor${urgent}`;
    case "hiz":
      return `${pages} sayfanız ziyaretçiye yavaş açılıyor${urgent}`;
    case "olcum":
      return `Ziyaretçi ölçümünde ${open.length} sorun var${urgent}`;
    case "reklam":
      return `Reklamlarınızda ${open.length} iyileştirme fırsatı var${urgent}`;
    case "icerik":
      return `${pages} sayfada içerik eksiği var${urgent}`;
  }
}
