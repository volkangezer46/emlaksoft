"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath, updateTag } from "next/cache";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { now } from "@/lib/clock";
import { optionalEmailSchema, optionalPhoneSchema } from "@/lib/validation/contact";
import { getSeoPage } from "@/lib/seo/registry";
import { executeSeoRobot } from "@/lib/seo/robot";
import { validateNewRule, analyzeRedirects } from "@/lib/seo/redirects";
import {
  GlobalInputSchema,
  PageOverrideSchema,
  PagesSchema,
  RedirectRuleSchema,
  RedirectsSchema,
  RobotsSettingsSchema,
  SEO_KEYS,
  SitemapSettingsSchema,
  AI_BOTS,
  CHANGE_FREQS,
  JSON_LD_KINDS,
  compactOverride,
  type SeoPageOverride,
  type SeoRedirectRule,
} from "@/lib/seo/schema";
import { SEO_CACHE_TAG, readIndexNow, readSeoSettingsFresh, writeIndexNow, writeSeoSetting } from "@/lib/seo/store";
import type { PlatformStaff } from "@/lib/platform";

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
  const res = await writeSeoSetting("global", GlobalInputSchema, input, g.staff.id);
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
  const superAdmin = g.staff.role === "super_admin";

  const priorityRaw = text(fd, "sitemapPriority");
  const priority = priorityRaw === undefined ? undefined : Number(priorityRaw.replace(",", "."));
  const freq = text(fd, "changeFreq");
  const kinds = fd.getAll("jsonLd").filter((v): v is string => typeof v === "string");

  const next: SeoPageOverride = {
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
  if (!def.canIndex && next.robotsIndex === true) return { error: "Bu sayfa (örn. giriş) indekslenebilir yapılamaz." };
  if (next.sitemapPriority !== undefined && !(next.sitemapPriority >= 0 && next.sitemapPriority <= 1)) return { error: "Öncelik 0 ile 1 arasında olmalı." };
  // Hiçbir değişiklik yoksa güncellenme zamanı yazılmaz.
  const checked = PageOverrideSchema.safeParse(next);
  if (!checked.success) return { error: checked.error.issues[0]?.message ?? "Sayfa ayarı geçersiz." };
  const compact = compactOverride(checked.data);

  const pages = { ...settings.pages };
  if (!compact) delete pages[path];
  else pages[path] = { ...compact, updatedAt: new Date(now()).toISOString() };

  const res = await writeSeoSetting("pages", PagesSchema, pages, g.staff.id);
  if (!res.ok) return { error: res.error };
  await audit(g.staff, "seo.page.save", path);
  refresh();
  return { ok: true };
}

export async function resetSeoPage(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(false);
  if ("error" in g) return g;
  const path = text(fd, "path") ?? "";
  if (!getSeoPage(path)) return { error: "Bu yol yönetilebilir sayfalar arasında değil." };
  const settings = await readSeoSettingsFresh();
  const pages = { ...settings.pages };
  delete pages[path];
  const res = await writeSeoSetting("pages", PagesSchema, pages, g.staff.id);
  if (!res.ok) return { error: res.error };
  await audit(g.staff, "seo.page.reset", path);
  refresh();
  return { ok: true };
}

/* ------------------------------ Sitemap ve robots ------------------------------ */

export async function saveSeoSitemap(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(true);
  if ("error" in g) return g;
  const slugs = lines(fd, "optInTenantSlugs").map((s) => s.toLowerCase());
  const max = Number(text(fd, "maxUrlsPerSitemap") ?? "45000");
  const input = {
    staticPages: bool(fd, "staticPages"),
    tools: bool(fd, "tools"),
    vitrinOffices: bool(fd, "vitrinOffices"),
    vitrinListings: bool(fd, "vitrinListings"),
    advisors: bool(fd, "advisors"),
    onlyOptIn: bool(fd, "onlyOptIn"),
    optInTenantSlugs: slugs,
    maxUrlsPerSitemap: Number.isFinite(max) ? Math.round(max) : 45000,
  };
  const res = await writeSeoSetting("sitemap", SitemapSettingsSchema, input, g.staff.id);
  if (!res.ok) return { error: res.error };
  await audit(g.staff, "seo.sitemap.save", "sitemap", { onlyOptIn: input.onlyOptIn, optIn: slugs.length });
  refresh();
  return { ok: true };
}

export async function saveSeoRobots(fd: FormData): Promise<SeoActionResult> {
  const g = await guard(true);
  if ("error" in g) return g;
  const botIds = AI_BOTS.map((b) => b.id as string);
  // Form "izin ver" anahtarlarını gönderir: işaretli OLMAYAN bot engellenir.
  const allowed = new Set(fd.getAll("allowAi").filter((v): v is string => typeof v === "string"));
  const blocked = botIds.filter((id) => !allowed.has(id));
  const input = {
    extraDisallow: lines(fd, "extraDisallow"),
    blockedAiBots: blocked,
    llmsTxtEnabled: bool(fd, "llmsTxtEnabled"),
    llmsTxt: text(fd, "llmsTxt") ?? "",
  };
  const res = await writeSeoSetting("robots", RobotsSettingsSchema, input, g.staff.id);
  if (!res.ok) return { error: res.error };
  await audit(g.staff, "seo.robots.save", "robots", { blockedAi: blocked.length, extra: input.extraDisallow.length });
  refresh();
  return { ok: true };
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
  const res = await writeSeoSetting("redirects", RedirectsSchema, [...settings.redirects, parsed.data], g.staff.id);
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
  const res = await writeSeoSetting("redirects", RedirectsSchema, next, g.staff.id);
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
  const res = await writeSeoSetting("redirects", RedirectsSchema, settings.redirects.filter((r) => r.id !== id), g.staff.id);
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
  const res = await writeSeoSetting("redirects", RedirectsSchema, [], g.staff.id);
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
  const payload = { version: 1, exportedAt: new Date(now()).toISOString(), global: s.global, pages: s.pages, sitemap: s.sitemap, robots: s.robots, redirects: s.redirects };
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
  ];
  // Önce HEPSİNİ doğrula; biri bozuksa hiçbir şey yazılmaz.
  for (const st of steps) {
    if (st.value === undefined) continue;
    const parsed = (st.schema as { safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } } }).safeParse(st.value);
    if (!parsed.success) return { error: `${st.name}: ${parsed.error?.issues[0]?.message ?? "geçersiz"}` };
  }
  for (const st of steps) {
    if (st.value === undefined) continue;
    const res = await writeSeoSetting(st.name, st.schema, st.value, g.staff.id);
    if (!res.ok) return { error: `${st.name}: ${res.error}` };
    wrote.push(st.name);
  }
  await audit(g.staff, "seo.import", "backup", { keys: wrote });
  refresh();
  return { ok: true, message: wrote.length > 0 ? `İçe aktarıldı: ${wrote.join(", ")}.` : "Yedekte içe aktarılacak bölüm yok." };
}
