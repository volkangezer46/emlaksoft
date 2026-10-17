import { indexNowExecutor, redirect404DraftExecutor, seoMetaDraftExecutor } from "@/lib/seo/executors";
import { staticRefreshExecutor } from "@/lib/static-home/executors";
import { fromSeoExecutor, fromStaticExecutor } from "./adapters";
import { canAutoOptimize } from "./fingerprint";
import type { IssueExecutor, SiteIssue } from "./types";

/**
 * YÜRÜTÜCÜ KAYDI (K2; S2/S4 dikişi tamam). Yerleşik iki eylem:
 *  - `href`: yalnız ilgili ekrana götürür ("Düzelt"); plan/apply yoktur.
 *  - `ignore`: gerekçeli yoksayma; gerekçe zorunludur (eylem katmanı doğrular, durum makinesi "yoksayildi").
 * Paket yürütücüleri `adapters.ts` ile Kokpit biçimine çevrilip kaydedilir (hepsi "guvenli"; Otopilot izin listesiyle
 * aynı adlar):
 *  - seo_meta_draft:long-description / :missing-og-title / :long-title / :missing-description → SEO yayın yüzeyinin
 *    TASLAĞINA yazar (canlı değişmez);
 *  - redirect_404_draft → 404 adresine KAPALI yönlendirme kuralı ekler (açmak insan işi);
 *  - indexnow → adresi IndexNow'a bildirir (kapalıysa dış çağrı yok);
 *  - static_refresh → statik sayfa önbelleğini temizleyip yeniden çizer (içerik değişmez).
 * Kaydı olmayan `kind` için arayüz "Bu düzeltme için ekran: …" gösterir.
 */

export const hrefExecutor: IssueExecutor = { kind: "href", label: "Düzelt", risk: "guvenli", mode: "link" };

export const IGNORE_REASON_MIN = 5;

export const ignoreExecutor: IssueExecutor = { kind: "ignore", label: "Yoksay", risk: "guvenli", mode: "direct" };

/** SEO taslaklarının Yayın masası yüzeyi (publishing/surfaces.ts "seo"). */
export const SEO_DRAFT_SURFACE = "seo";

export const PACKAGE_EXECUTORS: readonly IssueExecutor[] = [
  fromSeoExecutor("seo_meta_draft:long-description", seoMetaDraftExecutor, { label: "Açıklamayı kısalt (taslak)", draftSurface: SEO_DRAFT_SURFACE, status: "taslakta" }),
  fromSeoExecutor("seo_meta_draft:missing-og-title", seoMetaDraftExecutor, { label: "Paylaşım başlığı ekle (taslak)", draftSurface: SEO_DRAFT_SURFACE, status: "taslakta" }),
  fromSeoExecutor("seo_meta_draft:long-title", seoMetaDraftExecutor, { label: "Başlığı kısalt (taslak)", draftSurface: SEO_DRAFT_SURFACE, status: "taslakta" }),
  fromSeoExecutor("seo_meta_draft:missing-description", seoMetaDraftExecutor, { label: "Açıklama ekle (taslak)", draftSurface: SEO_DRAFT_SURFACE, status: "taslakta" }),
  fromSeoExecutor("redirect_404_draft", redirect404DraftExecutor, { draftSurface: null, status: "taslakta" }),
  fromSeoExecutor("indexnow", indexNowExecutor, { draftSurface: null, status: null }),
  fromStaticExecutor(staticRefreshExecutor),
];

export const EXECUTORS: readonly IssueExecutor[] = [hrefExecutor, ignoreExecutor, ...PACKAGE_EXECUTORS];

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
