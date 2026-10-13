import { randomBytes } from "node:crypto";
import type { FixContext, FixExecutor, FixPlan, FixResult, FixRisk, FixTarget } from "./contracts";
import { notFoundCandidates } from "./not-found-suggest";
import { normalizeRedirectPath, validateNewRule } from "./redirects";
import { getSeoPage } from "./registry";
import { ruleSuggestion } from "./rule-suggest";
import { RedirectRuleSchema, RedirectsSchema } from "./schema";
import { canAutoOptimize, pathOfUrl } from "./scope";

/**
 * SEO DÜZELTİCİLERİ (K2). Kayıt (executors listesi) S4 dikişinde; burada nesneler dışa verilir.
 *  - seo_meta_draft: kural önerisini SEO yayın yüzeyinin TASLAĞINA yazar (canlı değişmez; yayın insan ya da Otopilot
 *    `publish=true` ile Yayın masasından). Risk "guvenli" YALNIZ long-description ve missing-og-title kodlarında.
 *  - redirect_404_draft: 404 yolu için öneri hedefe KAPALI (enabled=false) yönlendirme kuralı ekler (taslak).
 *  - indexnow: adresi IndexNow'a bildirir (kapalıysa dış çağrı yok).
 * manualOnly ya da otomatik iyileştirme kapsamı dışındaki bulgu hiçbir eylemi ALMAZ (canHandle=false).
 */

const SAFE_META_CODES = new Set(["long-description", "missing-og-title"]);

const autoPath = (t: FixTarget): string | null => {
  if (t.manualOnly) return null;
  const p = pathOfUrl(t.url);
  return p && canAutoOptimize(p) ? p : null;
};

/**
 * "Bulunamadı" bulgusu mu? Yalnız adresin KENDİSİ 404/410 olan bulgular: kural önerisi redirect_404, ya da
 * http-error + kanıtta 404/410 durumu. `broken-link` BİLEREK yok: onun adresi kırık bağlantıyı İÇEREN sayfadır,
 * o adrese yönlendirme yazmak çalışan sayfayı yönlendirir.
 */
const isNotFoundTarget = (t: FixTarget): boolean => {
  if (t.proposal?.rule === "redirect_404") return true;
  const status = t.evidence?.status;
  return (t.code === "http-error" || t.code === "not-found") && (status === 404 || status === 410);
};

/** Yönlendirme taslağı alabilecek yol: manualOnly değil, otomatik iyileştirme kapsamında, kök değil, 404 bulgusu. */
const redirectPath = (t: FixTarget): string | null => {
  const p = autoPath(t);
  return p && p !== "/" && isNotFoundTarget(t) ? p : null;
};

const proposalAfter = (t: FixTarget): string | null => (typeof t.proposal?.after === "string" && t.proposal.after.trim() ? t.proposal.after.trim() : null);

export const seoMetaDraftExecutor: FixExecutor = {
  kind: "seo_meta_draft",
  label: "SEO taslağına al",
  risk(t): FixRisk {
    return SAFE_META_CODES.has(t.code) ? "guvenli" : "dikkat";
  },
  canHandle(t) {
    const path = autoPath(t);
    return Boolean(path && getSeoPage(path) && SAFE_META_CODES.has(t.code) && proposalAfter(t) && t.proposal?.field);
  },
  async plan(t): Promise<FixPlan | null> {
    if (!this.canHandle(t)) return null;
    return {
      kind: this.kind,
      risk: this.risk(t),
      target: pathOfUrl(t.url) ?? t.url,
      summary: t.proposal?.summary ?? "SEO taslağı",
      before: t.proposal?.before ?? null,
      after: proposalAfter(t),
    };
  },
  async apply(t, ctx: FixContext): Promise<FixResult> {
    const plan = await this.plan(t);
    if (!plan) return { ok: false, error: "Bu bulgu için otomatik taslak yok (elle düzeltin)." };
    const field = t.proposal?.field;
    if (field !== "description" && field !== "ogTitle") return { ok: false, error: "Desteklenmeyen alan." };
    const { draftSeoPageField } = await import("./publish-surface");
    const res = await draftSeoPageField(plan.target, field, plan.after ?? "", ctx.actorId ?? "system");
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, message: `${plan.summary} taslağa yazıldı (yayınlanmadı).`, before: res.before ?? plan.before, after: plan.after };
  },
};

export const redirect404DraftExecutor: FixExecutor = {
  kind: "redirect_404_draft",
  label: "Yönlendirme taslağı",
  risk: () => "guvenli",
  canHandle(t) {
    return Boolean(redirectPath(t));
  },
  async plan(t): Promise<FixPlan | null> {
    const from = redirectPath(t);
    if (!from) return null;
    const { readSeoSettingsFresh } = await import("./store");
    const s = await readSeoSettingsFresh();
    if (s.redirects.some((r) => normalizeRedirectPath(r.from) === normalizeRedirectPath(from))) return null;
    const proposal = ruleSuggestion({ rule: "redirect_404", path: from, candidates: notFoundCandidates(s.redirects) });
    if (!proposal?.after) return null;
    return { kind: this.kind, risk: "guvenli", target: from, summary: proposal.summary, before: from, after: proposal.after };
  },
  async apply(t, ctx): Promise<FixResult> {
    const plan = await this.plan(t);
    if (!plan || !plan.after) return { ok: false, error: "Bu 404 için güvenilir hedef önerisi yok." };
    const { readSeoSettingsFresh, writeSeoSetting } = await import("./store");
    const s = await readSeoSettingsFresh();
    const rule = RedirectRuleSchema.safeParse({
      id: randomBytes(6).toString("hex"),
      from: plan.target,
      to: plan.after,
      status: 308,
      enabled: false,
      note: "Taslak: otomatik 404 önerisi (açmadan önce kontrol edin)",
    });
    if (!rule.success) return { ok: false, error: "Önerilen kural geçersiz." };
    const err = validateNewRule(s.redirects, rule.data);
    if (err) return { ok: false, error: err };
    const res = await writeSeoSetting("redirects", RedirectsSchema, [...s.redirects, rule.data], ctx.actorId ?? undefined);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, message: `${plan.target} → ${plan.after} kapalı kural olarak eklendi.`, before: null, after: `${plan.target} → ${plan.after}` };
  },
};

export const indexNowExecutor: FixExecutor = {
  kind: "indexnow",
  label: "Arama motorlarına bildir (IndexNow)",
  risk: () => "guvenli",
  canHandle(t) {
    return Boolean(autoPath(t));
  },
  async plan(t): Promise<FixPlan | null> {
    const path = autoPath(t);
    if (!path) return null;
    return { kind: this.kind, risk: "guvenli", target: t.url, summary: `${path} IndexNow'a bildirilecek (Bing, Yandex)`, before: null, after: null };
  },
  async apply(t): Promise<FixResult> {
    if (!this.canHandle(t)) return { ok: false, error: "Adres otomatik bildirim kapsamında değil." };
    const { notifyIndexNow } = await import("./indexnow-events");
    const r = await notifyIndexNow([t.url], { source: "elle" });
    if (r.sent === 0) return { ok: false, error: r.skipped ?? r.status };
    return { ok: true, message: `IndexNow: ${r.sent} adres bildirildi (${r.status}).`, before: null, after: null };
  },
};

export const SEO_EXECUTORS: readonly FixExecutor[] = [seoMetaDraftExecutor, redirect404DraftExecutor, indexNowExecutor];
