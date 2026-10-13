import { canAutoOptimize } from "./fingerprint";
import type { IssueExecutor, SiteIssue } from "./types";

/**
 * YÜRÜTÜCÜ KAYDI (K2). Yerleşik iki eylem:
 *  - `href`: yalnız ilgili ekrana götürür ("Düzelt"); plan/apply yoktur.
 *  - `ignore`: gerekçeli yoksayma; gerekçe zorunludur (eylem katmanı doğrular, durum makinesi "yoksayildi").
 * Taslak hazırlayan yürütücüler (seo_meta_draft:*, redirect_404_draft, static_refresh, indexnow) kendi paketlerinin
 * dikişinde (S2/S4) EXECUTORS listesine eklenir. Kaydı olmayan `kind` için arayüz "Bu düzeltme için ekran: …" gösterir.
 */

export const hrefExecutor: IssueExecutor = { kind: "href", label: "Düzelt", risk: "guvenli", mode: "link" };

export const IGNORE_REASON_MIN = 5;

export const ignoreExecutor: IssueExecutor = { kind: "ignore", label: "Yoksay", risk: "guvenli", mode: "direct" };

export const EXECUTORS: readonly IssueExecutor[] = [hrefExecutor, ignoreExecutor];

export function executorFor(kind: string | null | undefined, list: readonly IssueExecutor[] = EXECUTORS): IssueExecutor | null {
  if (!kind) return null;
  return list.find((e) => e.kind === kind) ?? null;
}

/** Bulgu "Taslağa al" alabilir mi: önerisi var, yürütücüsü taslak/doğrudan uygular, bulgu manuel değil ve yol otomatik düzeltmeye açık. */
export function canDraft(issue: Pick<SiteIssue, "proposal" | "manual_only" | "url">, list: readonly IssueExecutor[] = EXECUTORS): boolean {
  if (issue.manual_only || !canAutoOptimize(issue.url)) return false;
  const ex = executorFor(issue.proposal?.kind, list);
  return Boolean(ex && ex.mode !== "link" && ex.plan && ex.apply);
}

/** Kaydı olmayan öneri türü: arayüzde "Bu düzeltme için ekran: …" bağlantısı. */
export function screenFallback(issue: Pick<SiteIssue, "href" | "area">): { href: string; label: string } {
  const label = { seo: "SEO merkezi", hiz: "Hız", olcum: "Ölçüm", reklam: "Reklam", icerik: "İçerik" }[issue.area];
  return { href: issue.href || "/admin/site", label };
}
