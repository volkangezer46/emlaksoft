"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath, updateTag } from "next/cache";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { now } from "@/lib/clock";
import { optionalEmailSchema, optionalPhoneSchema } from "@/lib/validation/contact";
import { getSeoPage } from "@/lib/seo/registry";
import { effectivePageView } from "@/lib/seo/metadata";
import { loadSitemapFresh } from "@/lib/seo/sitemap-data";
import { SEO_HISTORY_KEYS, listSeoHistory, type SeoHistoryKey } from "@/lib/seo/history";
import { pageImpact, robotsImpact, sitemapImpact, type SeoImpact } from "@/app/admin/seo/noindex-impact";
import { executeSeoRobot } from "@/lib/seo/robot";
import { validateNewRule, analyzeRedirects } from "@/lib/seo/redirects";
import {
  GlobalInputSchema,
  PageOverrideSchema,
  PagesSchema,
  PatternsSchema,
  RedirectRuleSchema,
  RedirectsSchema,
  RobotsSettingsSchema,
  SEO_KEYS,
  SitemapSettingsSchema,
  SeoAiSettingsSchema,
  AI_BOTS,
  CHANGE_FREQS,
  JSON_LD_KINDS,
  compactOverride,
  mergeSitemap,
  type SeoPageOverride,
  type SeoRedirectRule,
} from "@/lib/seo/schema";
import { SEO_CACHE_TAG, readAuditLatest, readIndexNow, readSeoSettingsFresh, writeIndexNow, writeSeoSetting } from "@/lib/seo/store";
import type { PlatformStaff } from "@/lib/platform";
import { afterSafe } from "@/lib/after-safe";
import { getBaseUrl } from "@/lib/base-url";
import { fetchOwnOriginInspect, readExternalText } from "@/lib/external-fetch";
import { visibleText } from "@/lib/seo/audit-rules";
import { SeoAiOutputSchema, suggestSeoWithAi } from "@/lib/seo/ai-suggest";
import { seoAfterPublishHook } from "@/lib/seo/after-publish-hook";
import { seoMetaDraftExecutor } from "@/lib/seo/executors";
import { auditRunToIssues } from "@/lib/seo/issues-collector";
import { draftSeoPageField, seoOverridesStore, seoPublishSurface } from "@/lib/seo/publish-surface";
import { canAutoOptimize } from "@/lib/seo/scope";

export type SeoActionResult = { ok?: boolean; error?: string; message?: string; data?: string };

const SUPER_ONLY = "Bu ayar yalnız süper admin tarafından değiştirilebilir (siteyi arama motorlarından gizleyebilir).";

function refresh() {
  updateTag(SEO_CACHE_TAG);
  revalidatePath("/admin/seo");
  revalidatePath("/", "layout");
  revalidatePath("/sitemap.xml");
}

async function guard(sensitive: boolean): Promise<{ staff: PlatformStaff } | { error: string }> {
  const staff = await requirePlatformModule("seo");
  if (sensitive && staff.role !== "super_admin") return { error: SUPER_ONLY };
  const rl = await checkRateLimit(`seo-admin:${staff.id}`, { limit: 60, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." };
  return { staff };
}

const text = (fd: FormData, name: string): string | undefined => {
  const v = fd.get(name);
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
};
const bool = (fd: FormData, name: string): boolean => fd.get(name) === "on" || fd.get(name) === "true";
const lines = (fd: FormData, name: string): string[] =>
  (text(fd, name) ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

async function audit(staff: PlatformStaff, action: string, entityId: string, meta?: Record<string, unknown>) {
  await logPlatformActivity({ actorId: staff.id, action, entityType: "seo", entityId, meta: meta ?? null });
}

/* ---------------------------------- Genel ---------------------------------- */

export async function saveSeoGlobal(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(true);
  if ("error" in g) return g;
  // İletişim alanları merkezi doğrulamadan geçer (e-posta normalize, telefon saklama biçimi).
  const email = optionalEmailSchema.safeParse(text(fd, "orgEmail"));
  if (!email.success) return { error: email.error.issues[0]?.message ?? "Geçerli bir e-posta girin." };
  const phone = optionalPhoneSchema.safeParse(text(fd, "orgPhone"));
  if (!phone.success) return { error: phone.error.issues[0]?.message ?? "Geçerli bir telefon girin." };
  const input = {
    siteName: text(fd, "siteName"),
    titleTemplate: text(fd, "titleTemplate"),
    defaultTitle: text(fd, "defaultTitle"),
    defaultDescription: text(fd, "defaultDescription"),
    ogImage: text(fd, "ogImage"),
    twitterHandle: text(fd, "twitterHandle") ?? "",
    locale: "tr_TR" as const,
    organization: {
      name: text(fd, "orgName"),
      legalName: text(fd, "orgLegalName"),
      logo: text(fd, "orgLogo") ?? "",
      sameAs: lines(fd, "orgSameAs"),
      email: email.data ?? "",
      phone: phone.data ?? "",
    },
    verification: {
      google: text(fd, "vGoogle") ?? "",
      bing: text(fd, "vBing") ?? "",
      yandex: text(fd, "vYandex") ?? "",
    },
  };
  const res = await writeSeoSetting("global", GlobalInputSchema, input, g.staff.id, g.staff.full_name);
  if (!res.ok) return { error: res.error };
  await audit(g.staff, "seo.global.save", "global");
  refresh();
  return { ok: true };
}

/* ---------------------------------- Sayfalar ---------------------------------- */

export async function saveSeoPage(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(false);
  if ("error" in g) return g;
  const path = text(fd, "path") ?? "";
  const def = getSeoPage(path);
  if (!def) return { error: "Bu yol yönetilebilir sayfalar arasında değil." };

  const settings = await readSeoSettingsFresh();
  const prev = settings.pages[path] ?? {};
  const next = pageOverrideFromForm(fd, prev, g.staff.role === "super_admin");
  if (!def.canIndex && next.robotsIndex === true) return { error: "Bu sayfa (örn. giriş) indekslenebilir yapılamaz." };
  if (next.sitemapPriority !== undefined && !(next.sitemapPriority >= 0 && next.sitemapPriority <= 1)) return { error: "Öncelik 0 ile 1 arasında olmalı." };
  // Hiçbir değişiklik yoksa güncellenme zamanı yazılmaz.
  const checked = PageOverrideSchema.safeParse(next);
  if (!checked.success) return { error: checked.error.issues[0]?.message ?? "Sayfa ayarı geçersiz." };
  const compact = compactOverride(checked.data);

  const pages = { ...settings.pages };
  if (!compact) delete pages[path];
  else pages[path] = { ...compact, updatedAt: new Date(now()).toISOString() };

  const res = await writeSeoSetting("pages", PagesSchema, pages, g.staff.id, g.staff.full_name);
  if (!res.ok) return { error: res.error };
  await audit(g.staff, "seo.page.save", path);
  refresh();
  return { ok: true };
}

/** Sayfa formundan override (saveSeoPage ve etki önizlemesi ortak). İndeks/sitemap kararları yalnız süper admin. */
function pageOverrideFromForm(fd: FormData, prev: SeoPageOverride, superAdmin: boolean): SeoPageOverride {
  const priorityRaw = text(fd, "sitemapPriority");
  const priority = priorityRaw === undefined ? undefined : Number(priorityRaw.replace(",", "."));
  const freq = text(fd, "changeFreq");
  const kinds = fd.getAll("jsonLd").filter((v): v is string => typeof v === "string");

  return {
    title: text(fd, "title"),
    description: text(fd, "description"),
    canonical: text(fd, "canonical"),
    ogTitle: text(fd, "ogTitle"),
    ogDescription: text(fd, "ogDescription"),
    ogImage: text(fd, "ogImage"),
    // Tarama/indeks/sitemap/JSON-LD kararları yalnız süper admin; ops mevcut değeri korur.
    robotsIndex: superAdmin ? (fd.get("robotsIndex") === "noindex" ? false : fd.get("robotsIndex") === "index" ? true : undefined) : prev.robotsIndex,
    robotsFollow: superAdmin ? (fd.get("robotsFollow") === "nofollow" ? false : undefined) : prev.robotsFollow,
    sitemapInclude: superAdmin ? (fd.get("sitemapInclude") === "exclude" ? false : fd.get("sitemapInclude") === "include" ? true : undefined) : prev.sitemapInclude,
    sitemapPriority: superAdmin ? priority : prev.sitemapPriority,
    changeFreq: superAdmin ? ((CHANGE_FREQS as readonly string[]).includes(freq ?? "") ? (freq as SeoPageOverride["changeFreq"]) : undefined) : prev.changeFreq,
    jsonLd: superAdmin ? (kinds.length > 0 ? (kinds.filter((k) => (JSON_LD_KINDS as readonly string[]).includes(k)) as SeoPageOverride["jsonLd"]) : undefined) : prev.jsonLd,
  };
}

export async function resetSeoPage(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(false);
  if ("error" in g) return g;
  const path = text(fd, "path") ?? "";
  if (!getSeoPage(path)) return { error: "Bu yol yönetilebilir sayfalar arasında değil." };
  const settings = await readSeoSettingsFresh();
  const pages = { ...settings.pages };
  delete pages[path];
  const res = await writeSeoSetting("pages", PagesSchema, pages, g.staff.id, g.staff.full_name);
  if (!res.ok) return { error: res.error };
  await audit(g.staff, "seo.page.reset", path);
  refresh();
  return { ok: true };
}

/* ------------------------------ Sitemap ve robots ------------------------------ */

export async function saveSeoSitemap(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(true);
  if ("error" in g) return g;
  const input = sitemapInputFromForm(fd);
  const res = await writeSeoSetting("sitemap", SitemapSettingsSchema, input, g.staff.id, g.staff.full_name);
  if (!res.ok) return { error: res.error };
  await audit(g.staff, "seo.sitemap.save", "sitemap", { onlyOptIn: input.onlyOptIn, optIn: input.optInTenantSlugs.length });
  refresh();
  return { ok: true };
}

function sitemapInputFromForm(fd: FormData) {
  const slugs = lines(fd, "optInTenantSlugs").map((s) => s.toLowerCase());
  const max = Number(text(fd, "maxUrlsPerSitemap") ?? "45000");
  return {
    staticPages: bool(fd, "staticPages"),
    tools: bool(fd, "tools"),
    vitrinOffices: bool(fd, "vitrinOffices"),
    vitrinListings: bool(fd, "vitrinListings"),
    advisors: bool(fd, "advisors"),
    onlyOptIn: bool(fd, "onlyOptIn"),
    optInTenantSlugs: slugs,
    maxUrlsPerSitemap: Number.isFinite(max) ? Math.round(max) : 45000,
  };
}

export async function saveSeoRobots(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(true);
  if ("error" in g) return g;
  const input = robotsInputFromForm(fd);
  const res = await writeSeoSetting("robots", RobotsSettingsSchema, input, g.staff.id, g.staff.full_name);
  if (!res.ok) return { error: res.error };
  await audit(g.staff, "seo.robots.save", "robots", { blockedAi: input.blockedAiBots.length, extra: input.extraDisallow.length });
  refresh();
  return { ok: true };
}

function robotsInputFromForm(fd: FormData) {
  const botIds = AI_BOTS.map((b) => b.id as string);
  // Form "izin ver" anahtarlarını gönderir: işaretli OLMAYAN bot engellenir.
  const allowed = new Set(fd.getAll("allowAi").filter((v): v is string => typeof v === "string"));
  const blocked = botIds.filter((id) => !allowed.has(id));
  return {
    extraDisallow: lines(fd, "extraDisallow"),
    blockedAiBots: blocked,
    llmsTxtEnabled: bool(fd, "llmsTxtEnabled"),
    llmsTxt: text(fd, "llmsTxt") ?? "",
  };
}

/* ------------------------------ Yönlendirmeler ------------------------------ */

function newId(): string {
  return randomBytes(6).toString("hex");
}

export async function addSeoRedirect(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(false);
  if ("error" in g) return g;
  const rule = {
    id: newId(),
    from: text(fd, "from") ?? "",
    to: text(fd, "to") ?? "",
    status: Number(text(fd, "status") ?? "308"),
    enabled: true,
    note: text(fd, "note"),
  };
  const parsed = RedirectRuleSchema.safeParse(rule);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Kural geçersiz." };
  const settings = await readSeoSettingsFresh();
  const err = validateNewRule(settings.redirects, parsed.data);
  if (err) return { error: err };
  const res = await writeSeoSetting("redirects", RedirectsSchema, [...settings.redirects, parsed.data], g.staff.id, g.staff.full_name);
  if (!res.ok) return { error: res.error };
  await audit(g.staff, "seo.redirect.add", parsed.data.id, { from: parsed.data.from, to: parsed.data.to });
  refresh();
  return { ok: true };
}

export async function toggleSeoRedirect(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(false);
  if ("error" in g) return g;
  const id = text(fd, "id") ?? "";
  const settings = await readSeoSettingsFresh();
  const next: SeoRedirectRule[] = settings.redirects.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
  const loop = analyzeRedirects(next).find((i) => i.ruleId === id && i.kind === "loop");
  if (loop) return { error: loop.message };
  const res = await writeSeoSetting("redirects", RedirectsSchema, next, g.staff.id, g.staff.full_name);
  if (!res.ok) return { error: res.error };
  await audit(g.staff, "seo.redirect.toggle", id);
  refresh();
  return { ok: true };
}

export async function deleteSeoRedirect(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(false);
  if ("error" in g) return g;
  const id = text(fd, "id") ?? "";
  const settings = await readSeoSettingsFresh();
  const res = await writeSeoSetting("redirects", RedirectsSchema, settings.redirects.filter((r) => r.id !== id), g.staff.id, g.staff.full_name);
  if (!res.ok) return { error: res.error };
  await audit(g.staff, "seo.redirect.delete", id);
  refresh();
  return { ok: true };
}

/** Yıkıcı toplu işlem: yalnız süper admin ve satır içi onay (confirm=evet) ile. */
export async function deleteAllSeoRedirects(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(true);
  if ("error" in g) return g;
  if (text(fd, "confirm") !== "evet") return { error: "Onay gerekli." };
  const settings = await readSeoSettingsFresh();
  const res = await writeSeoSetting("redirects", RedirectsSchema, [], g.staff.id, g.staff.full_name);
  if (!res.ok) return { error: res.error };
  await audit(g.staff, "seo.redirect.delete_all", "redirects", { count: settings.redirects.length });
  refresh();
  return { ok: true };
}

/* ------------------------------ IndexNow ------------------------------ */

export async function setIndexNowEnabled(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(true);
  if ("error" in g) return g;
  const enable = bool(fd, "enabled");
  const cur = await readIndexNow();
  const key = enable && !/^[a-f0-9]{32}$/.test(cur.key) ? randomBytes(16).toString("hex") : cur.key;
  const res = await writeIndexNow({ ...cur, enabled: enable, key }, g.staff.id);
  if (!res.ok) return { error: res.error };
  await audit(g.staff, enable ? "seo.indexnow.enable" : "seo.indexnow.disable", "indexnow");
  refresh();
  return { ok: true };
}

export async function regenerateIndexNowKey(): Promise<SeoActionResult> {
  const g = await guard(true);
  if ("error" in g) return g;
  const cur = await readIndexNow();
  const res = await writeIndexNow(
    { ...cur, key: randomBytes(16).toString("hex"), lastHash: "", lastStatus: "anahtar yenilendi", dayKey: "", dayCount: 0 },
    g.staff.id,
  );
  if (!res.ok) return { error: res.error };
  await audit(g.staff, "seo.indexnow.regenerate", "indexnow");
  refresh();
  return { ok: true };
}

/* ------------------------------ AI önerisi ayarı ------------------------------ */

/** AI önerisi aç/kapat ve aylık sınır (yalnız süper admin). Varsayılan KAPALI; kota platform AI kotasından düşer. */
export async function saveSeoAiSettings(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(true);
  if ("error" in g) return g;
  const limit = Number(text(fd, "monthlyLimit") ?? "300");
  const input = { enabled: bool(fd, "enabled"), monthlyLimit: Number.isInteger(limit) ? limit : 300 };
  const res = await writeSeoSetting("ai", SeoAiSettingsSchema, input, g.staff.id, g.staff.full_name);
  if (!res.ok) return { error: res.error };
  await audit(g.staff, input.enabled ? "seo.ai.enable" : "seo.ai.disable", "ai", { monthlyLimit: input.monthlyLimit });
  revalidatePath("/admin/seo");
  return { ok: true, message: input.enabled ? "AI önerisi açıldı." : "AI önerisi kapalı." };
}

/* ------------------------------ Öneri → taslak ------------------------------ */

/**
 * Robot bulgusunun KURAL önerisini SEO taslağına yazar (canlı değişmez). Bulgu son koşudan bulunur; öneri sunucuda
 * yeniden hesaplanır (istemciden değer alınmaz). Kapsam dışı/üyelik sayfası bulgusu taslak ALMAZ.
 */
export async function draftSeoRuleFix(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(false);
  if ("error" in g) return g;
  const url = text(fd, "url") ?? "";
  const code = text(fd, "code") ?? "";
  const [run, settings] = await Promise.all([readAuditLatest(), readSeoSettingsFresh()]);
  if (!run) return { error: "Robot henüz çalışmadı." };
  const finding = run.findings.find((f) => f.url === url && f.code === code);
  if (!finding) return { error: "Bulgu artık yok (robot yeniden çalışmış olabilir)." };
  const issue = auditRunToIssues({ ...run, findings: [finding] }, settings).issues[0];
  if (!issue || !seoMetaDraftExecutor.canHandle(issue)) return { error: "Bu bulgu için otomatik taslak yok; sayfayı elle düzenleyin." };
  const res = await seoMetaDraftExecutor.apply(issue, { actorId: g.staff.id, source: "staff" });
  if (!res.ok) return { error: res.error };
  await audit(g.staff, "seo.draft.rule", issue.url, { code, before: res.before, after: res.after });
  revalidatePath("/admin/seo");
  return { ok: true, message: res.message };
}

/** Sayfanın görünür metnini KENDİ kökenimizden okur (yalnız AI önerisi girdisi; dış adres YOK). */
async function ownPageText(path: string): Promise<string | null> {
  try {
    const res = await fetchOwnOriginInspect(`${getBaseUrl()}${path === "/" ? "/" : path}`, { method: "GET", cache: "no-store" }, { timeoutMs: 8000 });
    if (res.status !== 200) {
      await res.body?.cancel();
      return null;
    }
    return visibleText(await readExternalText(res, 1_500_000));
  } catch {
    return null;
  }
}

/** AI önerisi ister (yalnız süper admin, ayar açık, sayfa kapsam içi; kota platform AI kotasından). Hiçbir şey yazmaz. */
export async function requestSeoAiSuggestion(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(true);
  if ("error" in g) return g;
  const path = text(fd, "path") ?? "";
  if (!getSeoPage(path)) return { error: "Bu yol yönetilebilir sayfalar arasında değil." };
  const pageText = await ownPageText(path);
  if (pageText === null) return { error: "Sayfa kendi sunucumuzdan okunamadı; sayfanın açıldığını kontrol edip tekrar deneyin." };
  const r = await suggestSeoWithAi({ path, visibleText: pageText, actor: { id: g.staff.id, role: g.staff.role } });
  if (!r.ok) return { error: r.error };
  return { ok: true, message: "AI önerisi hazır; kontrol edip taslağa yazabilirsiniz.", data: JSON.stringify(r.suggestion) };
}

/** AI önerisini (super admin gözden geçirdikten sonra) SEO taslağına yazar. Değerler şema sınırlarından geçer. */
export async function draftSeoAiSuggestion(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(true);
  if ("error" in g) return g;
  const path = text(fd, "path") ?? "";
  if (!getSeoPage(path) || !canAutoOptimize(path)) return { error: "Bu sayfa otomatik öneri kapsamında değil." };
  const parsed = SeoAiOutputSchema.safeParse({ title: text(fd, "title"), description: text(fd, "description"), ogTitle: text(fd, "ogTitle") ?? null });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Öneri geçersiz." };
  const fields: Array<["title" | "description" | "ogTitle", string | null | undefined]> = [
    ["title", parsed.data.title],
    ["description", parsed.data.description],
    ["ogTitle", parsed.data.ogTitle],
  ];
  for (const [field, value] of fields) {
    if (!value) continue;
    const res = await draftSeoPageField(path, field, value, g.staff.id);
    if (!res.ok) return { error: res.error };
  }
  await audit(g.staff, "seo.draft.ai", path);
  revalidatePath("/admin/seo");
  return { ok: true, message: "AI önerisi taslağa yazıldı (yayınlanmadı)." };
}

/** SEO taslağını yayınlar (yalnız süper admin): seo.pages'e yazılır, geçmişe girer; etkilenen sayfalar IndexNow + yeniden denetim. */
export async function publishSeoDraft(): Promise<SeoActionResult> {
  const g = await guard(true);
  if ("error" in g) return g;
  const state = await seoPublishSurface.readState();
  if (!state.draft) return { error: "Yayınlanacak taslak yok." };
  const res = await seoPublishSurface.publish(state.draft, g.staff.id, "SEO taslağı yayını", g.staff.full_name);
  if (!res.ok) return { error: res.error };
  const livePaths = seoPublishSurface.livePaths.map((p) => p.path);
  await audit(g.staff, "seo.draft.publish", "pages", { paths: livePaths });
  refresh();
  afterSafe(() => seoAfterPublishHook.run({ surfaceId: "seo", livePaths, actorId: g.staff.id, source: "staff", at: new Date(now()).toISOString() }), "seo.after-publish");
  return { ok: true, message: livePaths.length > 0 ? `Yayınlandı: ${livePaths.join(", ")}.` : "Yayınlandı (değişiklik yoktu)." };
}

/** Taslağı canlıya eşitler (bekleyen değişiklikleri atar). */
export async function discardSeoDraft(): Promise<SeoActionResult> {
  const g = await guard(false);
  if ("error" in g) return g;
  const state = await seoPublishSurface.readState();
  const res = await seoOverridesStore.saveDraft((state.live ?? {}) as Parameters<typeof seoOverridesStore.saveDraft>[0], g.staff.id);
  if (!res.ok) return { error: res.error };
  await audit(g.staff, "seo.draft.discard", "pages");
  revalidatePath("/admin/seo");
  return { ok: true, message: "Taslak atıldı." };
}

/* ------------------------------ Robot ------------------------------ */

/** Robotu şimdi çalıştırır. Cron sırrı hiç kullanılmaz ve istemciye sızmaz: ortak servis doğrudan sunucuda çağrılır. */
export async function runSeoRobotNow(): Promise<SeoActionResult> {
  const g = await guard(true);
  if ("error" in g) return g;
  const rl = await checkRateLimit(`seo-robot-now:${g.staff.id}`, { limit: 3, windowSec: 900, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Robot en çok 15 dakikada 3 kez elle çalıştırılabilir." };
  try {
    const { run, indexNow } = await executeSeoRobot("manual");
    await audit(g.staff, "seo.robot.run", "robot", { critical: run.summary.critical, warning: run.summary.warning });
    revalidatePath("/admin/seo");
    return {
      ok: true,
      message: `${run.summary.pagesChecked} sayfa denetlendi: ${run.summary.critical} kritik, ${run.summary.warning} uyarı. IndexNow: ${indexNow.status}.`,
    };
  } catch (e) {
    console.error("runSeoRobotNow", e);
    return { error: "Robot çalıştırılamadı; sunucu günlüğüne bakın." };
  }
}

/* ------------------------------ Yedek ------------------------------ */

export async function exportSeoSettings(): Promise<SeoActionResult> {
  const g = await guard(false);
  if ("error" in g) return g;
  const s = await readSeoSettingsFresh();
  const payload = { version: 1, exportedAt: new Date(now()).toISOString(), global: s.global, pages: s.pages, sitemap: s.sitemap, robots: s.robots, redirects: s.redirects, patterns: s.patterns };
  await audit(g.staff, "seo.export", "backup");
  return { ok: true, data: JSON.stringify(payload, null, 2) };
}

export async function importSeoSettings(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(true);
  if ("error" in g) return g;
  if (text(fd, "confirm") !== "evet") return { error: "Onay gerekli: içe aktarma mevcut ayarların üzerine yazar." };
  const raw = text(fd, "json");
  if (!raw || raw.length > 400_000) return { error: "Yedek metni boş ya da çok büyük." };
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { error: "Yedek geçerli bir JSON değil." };
  }
  const wrote: string[] = [];
  const steps: { name: keyof typeof SEO_KEYS; schema: Parameters<typeof writeSeoSetting>[1]; value: unknown }[] = [
    { name: "global", schema: GlobalInputSchema, value: obj.global },
    { name: "pages", schema: PagesSchema, value: obj.pages },
    { name: "sitemap", schema: SitemapSettingsSchema, value: obj.sitemap },
    { name: "robots", schema: RobotsSettingsSchema, value: obj.robots },
    { name: "redirects", schema: RedirectsSchema, value: obj.redirects },
    { name: "patterns", schema: PatternsSchema, value: obj.patterns },
  ];
  // Önce HEPSİNİ doğrula; biri bozuksa hiçbir şey yazılmaz.
  for (const st of steps) {
    if (st.value === undefined) continue;
    const parsed = (st.schema as { safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } } }).safeParse(st.value);
    if (!parsed.success) return { error: `${st.name}: ${parsed.error?.issues[0]?.message ?? "geçersiz"}` };
  }
  for (const st of steps) {
    if (st.value === undefined) continue;
    const res = await writeSeoSetting(st.name, st.schema, st.value, g.staff.id, g.staff.full_name);
    if (!res.ok) return { error: `${st.name}: ${res.error}` };
    wrote.push(st.name);
  }
  await audit(g.staff, "seo.import", "backup", { keys: wrote });
  refresh();
  return { ok: true, message: wrote.length > 0 ? `İçe aktarıldı: ${wrote.join(", ")}.` : "Yedekte içe aktarılacak bölüm yok." };
}

/* ------------------------------ Dinamik kalıplar ------------------------------ */

/** Vitrin/ilan/danışman başlık-açıklama kalıpları. Boş alan = bugünkü sabit çıktı. Vitrin ISR 60 sn'de yansır. */
export async function saveSeoPatterns(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(true);
  if ("error" in g) return g;
  const pair = (prefix: string) => ({ title: text(fd, `${prefix}Title`) ?? "", description: text(fd, `${prefix}Description`) ?? "" });
  const input = { office: pair("office"), listing: pair("listing"), agent: pair("agent") };
  const res = await writeSeoSetting("patterns", PatternsSchema, input, g.staff.id, g.staff.full_name);
  if (!res.ok) return { error: res.error };
  const custom = Object.entries(input).flatMap(([k, v]) => [v.title ? `${k}.title` : null, v.description ? `${k}.description` : null]).filter(Boolean);
  await audit(g.staff, "seo.patterns.save", "patterns", { custom });
  refresh();
  return { ok: true, message: "Kalıplar kaydedildi; vitrin sayfalarına en geç 60 saniyede yansır." };
}

/* ------------------------------ Geçmiş ------------------------------ */

const HISTORY_SCHEMAS: Partial<Record<SeoHistoryKey, { schema: Parameters<typeof writeSeoSetting>[1]; empty: unknown }>> = {
  global: { schema: GlobalInputSchema, empty: {} },
  pages: { schema: PagesSchema, empty: {} },
  sitemap: { schema: SitemapSettingsSchema, empty: {} },
  robots: { schema: RobotsSettingsSchema, empty: {} },
  redirects: { schema: RedirectsSchema, empty: [] },
  patterns: { schema: PatternsSchema, empty: {} },
};

/** Geçmişteki bir değere döner (o kayıttaki ÖNCEKİ değer). Dönüş de geçmişe yazılır ve etkinlik günlüğüne düşer. */
export async function restoreSeoHistory(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(true);
  if ("error" in g) return g;
  const id = text(fd, "id") ?? "";
  const entry = (await listSeoHistory()).find((e) => e.id === id);
  if (!entry) return { error: "Geçmiş kaydı bulunamadı (halka dolup silinmiş olabilir)." };
  const def = SEO_HISTORY_KEYS.includes(entry.key) ? HISTORY_SCHEMAS[entry.key] : undefined;
  if (!def) return { error: "Bu ayar geri yüklenemez." };
  let value: unknown = def.empty;
  if (entry.prev !== null) {
    try {
      value = JSON.parse(entry.prev) as unknown;
    } catch {
      return { error: "Geçmiş kaydı bozuk; geri yüklenemedi." };
    }
  }
  const res = await writeSeoSetting(entry.key, def.schema, value, g.staff.id, g.staff.full_name);
  if (!res.ok) return { error: res.error };
  await audit(g.staff, "seo.history.restore", entry.key, { historyId: entry.id, at: entry.at });
  refresh();
  return { ok: true, message: "Önceki değer geri yüklendi." };
}

/* ------------------------------ Kazara noindex koruması ------------------------------ */

export type SeoImpactResult = { error?: string; impact?: SeoImpact };

/**
 * Kaydetmeden önce etki önizlemesi (salt okunur): değişiklik kaç URL'yi arama dışına çıkarır?
 * `scope`: page | sitemap | robots. Form alanları ilgili kaydetme action'ıyla aynıdır.
 */
export async function estimateSeoImpact(fd: FormData): Promise<SeoImpactResult> {
  const staff = await requirePlatformModule("seo");
  const scope = text(fd, "scope");
  const settings = await readSeoSettingsFresh();
  if (scope === "page") {
    const path = text(fd, "path") ?? "";
    const def = getSeoPage(path);
    if (!def) return { impact: { count: 0, details: [] } };
    const prev = settings.pages[path] ?? {};
    const cur = effectivePageView(def, settings.pages[path], settings.global);
    const nextOv = pageOverrideFromForm(fd, prev, staff.role === "super_admin");
    const nxt = effectivePageView(def, compactOverride(nextOv) ?? undefined, settings.global);
    // Sitemap grubu kapalıysa sayfa zaten sitemap'te değildir.
    const grouped = def.group === "arac" ? settings.sitemap.tools : settings.sitemap.staticPages;
    return {
      impact: pageImpact({
        path,
        currentlyIndexable: cur.indexable,
        currentlyInSitemap: cur.inSitemap && grouped,
        nextIndexable: nxt.indexable,
        nextInSitemap: nxt.inSitemap && grouped,
      }),
    };
  }
  if (scope === "sitemap" || scope === "robots") {
    const fresh = await loadSitemapFresh();
    const urls = fresh.chunks.flat().map((e) => e.url);
    if (scope === "robots") {
      const r = robotsInputFromForm(fd);
      return { impact: robotsImpact(urls, settings.robots, { extraDisallow: r.extraDisallow, blockedAiBots: r.blockedAiBots }) };
    }
    const next = mergeSitemap(sitemapInputFromForm(fd));
    // Opt-in kümesi: şu an sitemap'te olan vitrin ofisleri (ofis onayı ya da yedek liste) + formdaki yedek liste.
    const optIn = new Set<string>(next.optInTenantSlugs);
    if (settings.sitemap.onlyOptIn) {
      for (const u of urls) {
        const m = /\/vitrin\/([^/]+)/.exec(u);
        if (m) optIn.add(m[1]!);
      }
    }
    return { impact: sitemapImpact(urls, settings.sitemap, next, [...optIn]) };
  }
  return { error: "Geçersiz kapsam." };
}
