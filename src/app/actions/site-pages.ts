"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath, updateTag } from "next/cache";
import { afterSafe } from "@/lib/after-safe";
import { now } from "@/lib/clock";
import { captureLiveDigests, runAfterPublish } from "@/lib/publishing/after-publish";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import type { Issue } from "@/lib/site-menu/schema";
import { SITEMAP_CACHE_TAG } from "@/lib/seo/sitemap-data";
import { readSeoSettingsFresh } from "@/lib/seo/store";
import { buildRedirectMap, normalizeRedirectPath, withLegacyRedirects } from "@/lib/seo/redirects";
import { hasErrors } from "@/lib/site-content/schema-core";
import { PAGE_LIMITS, validateSitePage, type SitePageContent, type SitePageIndexEntry } from "@/lib/site-pages/schema";
import { checkSlug, normalizeSlugInput } from "@/lib/site-pages/slug";
import { SITE_PAGES_CACHE_TAG, readSitePageIndexState, sitePageStore, writeSitePageIndex, type SitePageIndexWrite } from "@/lib/site-pages/store";
import { getTemplate } from "@/lib/site-pages/templates";

/**
 * Sayfa oluşturucu yazmaları (/admin/site/sayfalar). Yetki: `sitecontent` modülü + süper admin (site içeriğiyle aynı
 * kural); operasyon salt okur. Her yazma logPlatformActivity'ye düşer. Canlıyı etkileyen yazmalar `site-pages` ve
 * sitemap önbelleğini düşürür (herkese açık sayfa istek başına veritabanına gitmez).
 */

export type SitePageActionResult = {
  ok?: boolean;
  error?: string;
  issues?: Issue[];
  page?: SitePageContent;
  id?: string;
  /** Uyarı (engellemez): ör. bu yolda yönlendirme var. */
  notice?: string;
};

const INDEX_UNREADABLE = "Sayfa listesi şu an okunamadı; mevcut sayfaları korumak için kayıt yapılmadı. Biraz sonra tekrar deneyin.";
const INDEX_CONFLICT = "Sayfa listesi bu arada başka bir oturumda değişti; sayfayı yenileyip tekrar deneyin.";
const READONLY = "Sayfaları yalnız süper admin değiştirebilir; bu hesap salt okunur.";
const REDIRECT_NOTICE = "Bu yolda yönlendirme var; yönlendirme önceliklidir. Sayfanın görünmesi için /admin/site/seo'daki kuralı kapatın.";

async function requireWriter() {
  const staff = await requirePlatformModule("sitecontent");
  return staff.role === "super_admin" ? staff : null;
}

const isId = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{12}$/.test(v);
const nowIso = () => new Date(now()).toISOString();
const who = (s: { full_name?: string | null; email?: string | null }) => (s.full_name || s.email || "").slice(0, 120);

function refreshAdmin(id?: string) {
  revalidatePath("/admin/site/sayfalar");
  revalidatePath("/admin/site");
  if (id) revalidatePath(`/admin/site/sayfalar/${id}`);
}

/** Canlıyı etkileyen yazma: yayın haritası, sayfa içeriği ve sitemap önbelleği düşer. */
function refreshLive(id: string, slug: string) {
  updateTag(SITE_PAGES_CACHE_TAG);
  updateTag(SITEMAP_CACHE_TAG);
  refreshAdmin(id);
  revalidatePath(`/${slug}`);
}

/** Liste yazma sonucunu kullanıcı mesajına çevirir (ok ise null). */
function indexWriteError(r: SitePageIndexWrite, failMessage: string): string | null {
  if (r === "ok") return null;
  return r === "conflict" ? INDEX_CONFLICT : failMessage;
}

/** Diğer özel sayfaların yolları (iç bağlantı sayılır). */
const otherPaths = (index: readonly SitePageIndexEntry[], id?: string) => index.filter((e) => e.id !== id).map((e) => `/${e.slug}`);

/** Slug için etkin yönlendirme var mı (uyarı; yönlendirme her zaman önceliklidir). */
async function redirectExistsFor(slug: string): Promise<boolean> {
  try {
    const s = await readSeoSettingsFresh();
    return buildRedirectMap(withLegacyRedirects(s.redirects)).has(normalizeRedirectPath(`/${slug}`));
  } catch {
    return false;
  }
}

/** Şablondan yeni sayfa: taslak olarak açılır (yayında değil). */
export async function createSitePage(templateId: string, slugInput: string): Promise<SitePageActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  const rl = await checkRateLimit(`site-pages-create:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık sayfa açtınız; birkaç dakika sonra tekrar deneyin." };

  const tpl = getTemplate(String(templateId));
  if (!tpl) return { error: "Şablon bulunamadı." };
  const read = await readSitePageIndexState();
  if (!read.ok) return { error: INDEX_UNREADABLE };
  const index = read.list;
  if (index.length >= PAGE_LIMITS.maxPages) return { error: `En çok ${PAGE_LIMITS.maxPages} sayfa açılabilir.` };
  const slugCheck = checkSlug(normalizeSlugInput(slugInput || tpl.slug), index.map((e) => e.slug));
  if (!slugCheck.ok) return { error: slugCheck.message };

  const { page, issues } = validateSitePage(tpl.content, { extraPaths: otherPaths(index) });
  if (!page || hasErrors(issues)) return { error: "Şablon kurallara uymuyor; Boş sayfa şablonuyla açıp blokları elle ekleyin.", issues };

  const id = randomBytes(6).toString("hex");
  const saved = await sitePageStore(id).saveDraft(page, staff.id);
  if (!saved.ok) return { error: saved.error };
  const entry: SitePageIndexEntry = { id, slug: slugCheck.slug, title: page.title, kind: tpl.kind, status: "taslak", updatedAt: nowIso(), updatedBy: who(staff) };
  const indexErr = indexWriteError(await writeSitePageIndex([...index, entry], staff.id, read.version), "Sayfa listesi kaydedilemedi; tekrar deneyin.");
  if (indexErr) return { error: indexErr };

  await logPlatformActivity({ actorId: staff.id, action: "site_page.create", entityType: "site_page", entityId: id, meta: { slug: entry.slug, template: tpl.id } });
  refreshAdmin();
  const notice = (await redirectExistsFor(entry.slug)) ? REDIRECT_NOTICE : undefined;
  return { ok: true, id, notice };
}

/** Taslağı (ve yayında değilse yolu) kaydeder. Hatalar kaydı engeller; uyarılar engellemez. */
export async function saveSitePageDraft(id: string, input: unknown, slugInput?: string): Promise<SitePageActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  if (!isId(id)) return { error: "Sayfa bulunamadı." };
  const rl = await checkRateLimit(`site-pages-draft:${staff.id}`, { limit: 90, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık kaydettiniz; birkaç dakika sonra tekrar deneyin." };

  const read = await readSitePageIndexState();
  if (!read.ok) return { error: INDEX_UNREADABLE };
  const index = read.list;
  const entry = index.find((e) => e.id === id);
  if (!entry) return { error: "Sayfa bulunamadı." };

  let slug = entry.slug;
  if (slugInput !== undefined && normalizeSlugInput(slugInput) !== entry.slug) {
    if (entry.status === "yayinda") return { error: "Yayındaki sayfanın yolu değiştirilemez; önce yayından kaldırın." };
    const c = checkSlug(normalizeSlugInput(slugInput), index.filter((e) => e.id !== id).map((e) => e.slug));
    if (!c.ok) return { error: c.message };
    slug = c.slug;
  }

  const { page, issues } = validateSitePage(input, { extraPaths: otherPaths(index, id) });
  if (!page || hasErrors(issues)) return { error: "Sayfada düzeltilmesi gereken hatalar var.", issues };

  const saved = await sitePageStore(id).saveDraft(page, staff.id);
  if (!saved.ok) return { error: saved.error, issues };
  const next = index.map((e) => (e.id === id ? { ...e, slug, title: page.title, updatedAt: nowIso(), updatedBy: who(staff) } : e));
  const indexErr = indexWriteError(await writeSitePageIndex(next, staff.id, read.version), "Sayfa listesi kaydedilemedi; tekrar deneyin.");
  if (indexErr) return { error: indexErr, issues };

  await logPlatformActivity({ actorId: staff.id, action: "site_page.draft_save", entityType: "site_page", entityId: id, meta: { slug, blocks: page.blocks.length, warnings: issues.length } });
  refreshAdmin(id);
  const notice = (await redirectExistsFor(slug)) ? REDIRECT_NOTICE : undefined;
  return { ok: true, issues, page, notice };
}

/** Kayıtlı taslağı canlıya alır; sürüm geçmişine yazar ve sayfayı yayına açar. */
export async function publishSitePage(id: string, label: string): Promise<SitePageActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  if (!isId(id)) return { error: "Sayfa bulunamadı." };
  const rl = await checkRateLimit(`site-pages-publish:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık yayınladınız; birkaç dakika sonra tekrar deneyin." };

  const read = await readSitePageIndexState();
  if (!read.ok) return { error: INDEX_UNREADABLE };
  const index = read.list;
  const entry = index.find((e) => e.id === id);
  if (!entry) return { error: "Sayfa bulunamadı." };
  // Yayın anında yol yeniden denetlenir (bu arada yeni bir rota/korumalı önek eklenmiş olabilir).
  const c = checkSlug(entry.slug, index.filter((e) => e.id !== id).map((e) => e.slug));
  if (!c.ok) return { error: c.message };

  const store = sitePageStore(id);
  const state = await store.readState();
  if (!state.draft) return { error: "Yayınlanacak taslak yok; önce taslağı kaydedin." };
  const { page, issues } = validateSitePage(state.draft, { extraPaths: otherPaths(index, id) });
  if (!page || hasErrors(issues)) return { error: "Taslakta hatalar var; düzeltmeden yayınlanamaz.", issues };

  const note = String(label ?? "").trim().slice(0, 80) || "Yayın";
  const meta = { id: randomBytes(6).toString("hex"), at: nowIso(), by: who(staff), label: note };
  const beforeDigests = await captureLiveDigests([`/${entry.slug}`]);
  const res = await store.publish(page, meta, staff.id);
  if (!res.ok) return { error: res.error };
  const next = index.map((e) => (e.id === id ? { ...e, status: "yayinda" as const, title: page.title, updatedAt: meta.at, updatedBy: meta.by } : e));
  const indexErr = indexWriteError(await writeSitePageIndex(next, staff.id, read.version), "İçerik yayına yazıldı ama sayfa listesi güncellenemedi; tekrar Yayınla'ya basın.");
  if (indexErr) return { error: indexErr };

  await logPlatformActivity({ actorId: staff.id, action: "site_page.publish", entityType: "site_page", entityId: id, meta: { slug: entry.slug, label: note } });
  refreshLive(id, entry.slug);
  afterSafe(() => runAfterPublish({ surface: "sitepage", kind: "publish", publishRef: meta.id, livePaths: [`/${entry.slug}`], actorId: staff.id, source: "staff", beforeDigests }), "yayın sonrası zinciri");
  const notice = (await redirectExistsFor(entry.slug)) ? REDIRECT_NOTICE : undefined;
  return { ok: true, issues, notice };
}

/** Yayından kaldırır (arşiv): yol 404 döner; içerik ve geçmiş saklanır, yeniden yayınlanabilir. */
export async function unpublishSitePage(id: string): Promise<SitePageActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  if (!isId(id)) return { error: "Sayfa bulunamadı." };
  const read = await readSitePageIndexState();
  if (!read.ok) return { error: INDEX_UNREADABLE };
  const index = read.list;
  const entry = index.find((e) => e.id === id);
  if (!entry) return { error: "Sayfa bulunamadı." };
  if (entry.status === "arsiv") return { ok: true };
  const next = index.map((e) => (e.id === id ? { ...e, status: "arsiv" as const, updatedAt: nowIso(), updatedBy: who(staff) } : e));
  const indexErr = indexWriteError(await writeSitePageIndex(next, staff.id, read.version), "Sayfa listesi kaydedilemedi; tekrar deneyin.");
  if (indexErr) return { error: indexErr };
  await logPlatformActivity({ actorId: staff.id, action: "site_page.unpublish", entityType: "site_page", entityId: id, meta: { slug: entry.slug } });
  refreshLive(id, entry.slug);
  afterSafe(() => runAfterPublish({ surface: "sitepage", kind: "unpublish", publishRef: id, livePaths: [`/${entry.slug}`], actorId: staff.id, source: "staff" }), "yayın sonrası zinciri");
  return { ok: true };
}

/** Seçilen eski sürümü canlıya alır (yeni bir sürüm olarak geçmişe yazılır) ve sayfayı yayına açar. */
export async function rollbackSitePage(id: string, versionId: string): Promise<SitePageActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  if (!isId(id)) return { error: "Sayfa bulunamadı." };
  const rl = await checkRateLimit(`site-pages-publish:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." };

  const read = await readSitePageIndexState();
  if (!read.ok) return { error: INDEX_UNREADABLE };
  const index = read.list;
  const entry = index.find((e) => e.id === id);
  if (!entry) return { error: "Sayfa bulunamadı." };
  const c = checkSlug(entry.slug, index.filter((e) => e.id !== id).map((e) => e.slug));
  if (!c.ok) return { error: c.message };
  const store = sitePageStore(id);
  const state = await store.readState();
  const version = state.history.find((h) => h.id === String(versionId));
  if (!version) return { error: "Sürüm bulunamadı." };
  const { page, issues } = validateSitePage(version.cfg, { extraPaths: otherPaths(index, id) });
  if (!page || hasErrors(issues)) return { error: "Bu sürüm artık kurallara uymuyor; geri dönülemiyor.", issues };

  const meta = { id: randomBytes(6).toString("hex"), at: nowIso(), by: who(staff), label: `Geri dönüş: ${version.label}`.slice(0, 80) };
  const beforeDigests = await captureLiveDigests([`/${entry.slug}`]);
  const res = await store.publish(page, meta, staff.id);
  if (!res.ok) return { error: res.error };
  const next = index.map((e) => (e.id === id ? { ...e, status: "yayinda" as const, title: page.title, updatedAt: meta.at, updatedBy: meta.by } : e));
  const indexErr = indexWriteError(await writeSitePageIndex(next, staff.id, read.version), "Sürüm yayına yazıldı ama sayfa listesi güncellenemedi; tekrar deneyin.");
  if (indexErr) return { error: indexErr };

  await logPlatformActivity({ actorId: staff.id, action: "site_page.rollback", entityType: "site_page", entityId: id, meta: { slug: entry.slug, version: version.id } });
  refreshLive(id, entry.slug);
  afterSafe(() => runAfterPublish({ surface: "sitepage", kind: "restore", publishRef: meta.id, livePaths: [`/${entry.slug}`], actorId: staff.id, source: "staff", beforeDigests }), "yayın sonrası zinciri");
  return { ok: true, page };
}
