"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath, updateTag } from "next/cache";
import { now } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { GUIDE_LIMITS, emptyGuide, guideHasErrors, isGuideCategory, validateGuide, type GuideContent, type GuideIndexEntry, type GuideIssue } from "@/lib/guides/schema";
import { checkGuideSlug, toGuideSlug } from "@/lib/guides/slug";
import { guideLivePaths } from "@/lib/guides/publish-surface";
import {
  GUIDES_CACHE_TAG,
  guideLinkPaths,
  guideStore,
  publishGuideContent,
  readGuideIndexState,
  unpublishGuideEntry,
  writeGuideIndex,
  type GuideIndexWrite,
} from "@/lib/guides/store";

/**
 * Rehber yazmaları (/admin/site/rehber). Yetki: `sitecontent` modülü (süper admin + operasyon).
 *  - Operasyon (ops) TASLAK yazabilir: yeni yazı, taslak kaydı.
 *  - Yayınlama, yayından kaldırma ve sürüme dönüş YALNIZ süper admin.
 * Her yazma logPlatformActivity'ye düşer. Canlıyı etkileyen yazmalar `guides` etiketini ve rehber yollarını düşürür.
 * Zamanlama Yayın masasındadır (yüzey: src/lib/guides/publish-surface.ts; masada `guide:<id>` olarak kayıtlı).
 */

export type GuideActionResult = {
  ok?: boolean;
  error?: string;
  issues?: GuideIssue[];
  id?: string;
  guide?: GuideContent;
  /** Kayıttan sonraki (normalize edilmiş) yol; editör kendi alanını buna eşitler. */
  slug?: string;
};

const INDEX_UNREADABLE = "Rehber listesi şu an okunamadı; mevcut yazıları korumak için kayıt yapılmadı. Biraz sonra tekrar deneyin.";
const INDEX_CONFLICT = "Rehber listesi bu arada başka bir oturumda değişti; sayfayı yenileyip tekrar deneyin.";
const PUBLISH_ONLY_SUPER = "Yayınlama ve geri alma yalnız süper admin yetkisindedir; taslağı kaydedip süper admine iletin.";

const isId = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{12}$/.test(v);
const nowIso = () => new Date(now()).toISOString();
const who = (s: { full_name?: string | null; email?: string | null }) => (s.full_name || s.email || "").slice(0, 120);

/** Taslak yazarı: sitecontent modülü olan her personel (süper admin, operasyon). */
async function requireDraftWriter() {
  return requirePlatformModule("sitecontent");
}

/** Yayıncı: yalnız süper admin. */
async function requirePublisher() {
  const staff = await requirePlatformModule("sitecontent");
  return staff.role === "super_admin" ? staff : null;
}

function refreshAdmin(id?: string) {
  revalidatePath("/admin/site/rehber");
  if (id) revalidatePath(`/admin/site/rehber/${id}`);
}

/** Canlıyı etkileyen yazma: rehber önbelleği ve herkese açık yollar düşer. */
function refreshLive(entry: Pick<GuideIndexEntry, "id" | "slug" | "category">) {
  updateTag(GUIDES_CACHE_TAG);
  refreshAdmin(entry.id);
  for (const p of guideLivePaths(entry)) revalidatePath(p.path);
}

function indexWriteError(r: GuideIndexWrite, failMessage: string): string | null {
  if (r === "ok") return null;
  return r === "conflict" ? INDEX_CONFLICT : failMessage;
}

/** Yeni yazı: taslak olarak açılır (yayında değil). Yol başlıktan önerilir (Türkçe harf dönüşümü). */
export async function createGuide(titleInput: string, categoryInput: string, slugInput?: string): Promise<GuideActionResult> {
  const staff = await requireDraftWriter();
  const rl = await checkRateLimit(`site-guides-create:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık yazı açtınız; birkaç dakika sonra tekrar deneyin." };

  const title = String(titleInput ?? "").trim().slice(0, GUIDE_LIMITS.title);
  if (!title) return { error: "Başlık boş olamaz." };
  if (!isGuideCategory(categoryInput)) return { error: "Kategori listeden seçilmeli." };
  const read = await readGuideIndexState();
  if (!read.ok) return { error: INDEX_UNREADABLE };
  const index = read.list;
  if (index.length >= GUIDE_LIMITS.maxGuides) {
    return { error: `En çok ${GUIDE_LIMITS.maxGuides} yazı açılabilir. Daha fazlası için ayrı tablo kararı gerekir; sahibe iletin.` };
  }
  const slugCheck = checkGuideSlug(slugInput?.trim() || title, index.map((e) => e.slug));
  if (!slugCheck.ok) return { error: slugCheck.message };

  const content = emptyGuide(title, categoryInput);
  const id = randomBytes(6).toString("hex");
  const saved = await guideStore(id).saveDraft(content, staff.id);
  if (!saved.ok) return { error: saved.error };
  const at = nowIso();
  const entry: GuideIndexEntry = { id, slug: slugCheck.slug, title, category: categoryInput, status: "taslak", publishedAt: null, firstPublishedAt: null, updatedAt: at, updatedBy: who(staff) };
  const err = indexWriteError(await writeGuideIndex([...index, entry], staff.id, read.version), "Rehber listesi kaydedilemedi; tekrar deneyin.");
  if (err) return { error: err };

  await logPlatformActivity({ actorId: staff.id, action: "site_guide.create", entityType: "site_guide", entityId: id, meta: { slug: entry.slug, category: entry.category } });
  refreshAdmin();
  return { ok: true, id };
}

/** Taslağı (ve yayında değilse yolu) kaydeder. Taslak canlıyı değiştirmez. Hatalar kaydı engeller; uyarılar engellemez. */
export async function saveGuideDraft(id: string, input: unknown, slugInput?: string): Promise<GuideActionResult> {
  const staff = await requireDraftWriter();
  if (!isId(id)) return { error: "Yazı bulunamadı." };
  const rl = await checkRateLimit(`site-guides-draft:${staff.id}`, { limit: 90, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık kaydettiniz; birkaç dakika sonra tekrar deneyin." };

  const read = await readGuideIndexState();
  if (!read.ok) return { error: INDEX_UNREADABLE };
  const index = read.list;
  const entry = index.find((e) => e.id === id);
  if (!entry) return { error: "Yazı bulunamadı." };

  let slug = entry.slug;
  // Normalize hali mevcut yolla aynıysa (ör. "Kira Artışı" → "kira-artisi") değişiklik sayılmaz.
  if (slugInput !== undefined && toGuideSlug(slugInput.trim()) !== entry.slug) {
    if (entry.status === "yayinda") return { error: "Yayındaki yazının yolu değiştirilemez; önce yayından kaldırın." };
    const c = checkGuideSlug(slugInput, index.filter((e) => e.id !== id).map((e) => e.slug));
    if (!c.ok) return { error: c.message };
    slug = c.slug;
  }

  const { guide, issues } = validateGuide(input, { extraPaths: guideLinkPaths(index, id) });
  if (!guide || guideHasErrors(issues)) return { error: "Yazıda düzeltilmesi gereken hatalar var.", issues };

  const saved = await guideStore(id).saveDraft(guide, staff.id);
  if (!saved.ok) return { error: saved.error, issues };
  // Yayındaki yazının listedeki başlık/kategorisi canlıya aittir; yalnız yayında olmayanınki taslaktan güncellenir.
  const live = entry.status === "yayinda";
  const next = index.map((e) =>
    e.id === id ? { ...e, slug, ...(live ? {} : { title: guide.title, category: guide.category }), updatedAt: nowIso(), updatedBy: who(staff) } : e,
  );
  const err = indexWriteError(await writeGuideIndex(next, staff.id, read.version), "Rehber listesi kaydedilemedi; tekrar deneyin.");
  if (err) return { error: err, issues };

  await logPlatformActivity({ actorId: staff.id, action: "site_guide.draft_save", entityType: "site_guide", entityId: id, meta: { slug, blocks: guide.body.length, warnings: issues.length } });
  refreshAdmin(id);
  return { ok: true, issues, guide, slug };
}

/** Kayıtlı taslağı canlıya alır (geçmişe yazılır) ve yazıyı yayına açar. Yalnız süper admin. */
export async function publishGuide(id: string, label: string): Promise<GuideActionResult> {
  const staff = await requirePublisher();
  if (!staff) return { error: PUBLISH_ONLY_SUPER };
  if (!isId(id)) return { error: "Yazı bulunamadı." };
  const rl = await checkRateLimit(`site-guides-publish:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık yayınladınız; birkaç dakika sonra tekrar deneyin." };

  const read = await readGuideIndexState();
  if (!read.ok) return { error: INDEX_UNREADABLE };
  const entry = read.list.find((e) => e.id === id);
  if (!entry) return { error: "Yazı bulunamadı." };
  // Yayın anında yol yeniden denetlenir (bu arada yeni ayrılmış yol eklenmiş olabilir).
  const c = checkGuideSlug(entry.slug, read.list.filter((e) => e.id !== id).map((e) => e.slug));
  if (!c.ok) return { error: c.message };

  const state = await guideStore(id).readState();
  if (!state.draft) return { error: "Yayınlanacak taslak yok; önce taslağı kaydedin." };
  const { guide, issues } = validateGuide(state.draft, { extraPaths: guideLinkPaths(read.list, id) });
  if (!guide || guideHasErrors(issues)) return { error: "Taslakta hatalar var; düzeltmeden yayınlanamaz.", issues };

  const note = String(label ?? "").trim().slice(0, 80) || "Yayın";
  const meta = { id: randomBytes(6).toString("hex"), at: nowIso(), by: who(staff), label: note };
  const res = await publishGuideContent(id, guide, meta, staff.id);
  if (!res.ok) return { error: res.error };

  await logPlatformActivity({ actorId: staff.id, action: "site_guide.publish", entityType: "site_guide", entityId: id, meta: { slug: entry.slug, label: note } });
  refreshLive(res.entry);
  // Kategori değiştiyse eski kategori sayfası da düşer.
  if (entry.category !== res.entry.category) revalidatePath(`/rehber/kategori/${entry.category}`);
  return { ok: true, issues };
}

/** Yayından kaldırır: yol 404 döner; içerik ve geçmiş saklanır. Yalnız süper admin. */
export async function unpublishGuide(id: string): Promise<GuideActionResult> {
  const staff = await requirePublisher();
  if (!staff) return { error: PUBLISH_ONLY_SUPER };
  if (!isId(id)) return { error: "Yazı bulunamadı." };
  const res = await unpublishGuideEntry(id, staff.id, who(staff), nowIso());
  if (!res.ok) return { error: res.error };
  await logPlatformActivity({ actorId: staff.id, action: "site_guide.unpublish", entityType: "site_guide", entityId: id, meta: { slug: res.entry.slug } });
  refreshLive(res.entry);
  return { ok: true };
}

/** Seçilen eski sürümü canlıya alır (yeni sürüm olarak geçmişe yazılır). Yalnız süper admin. */
export async function rollbackGuide(id: string, versionId: string): Promise<GuideActionResult> {
  const staff = await requirePublisher();
  if (!staff) return { error: PUBLISH_ONLY_SUPER };
  if (!isId(id)) return { error: "Yazı bulunamadı." };
  const rl = await checkRateLimit(`site-guides-publish:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." };

  const read = await readGuideIndexState();
  if (!read.ok) return { error: INDEX_UNREADABLE };
  const entry = read.list.find((e) => e.id === id);
  if (!entry) return { error: "Yazı bulunamadı." };
  const state = await guideStore(id).readState();
  const version = state.history.find((h) => h.id === String(versionId));
  if (!version) return { error: "Sürüm bulunamadı." };
  const { guide, issues } = validateGuide(version.cfg, { extraPaths: guideLinkPaths(read.list, id) });
  if (!guide || guideHasErrors(issues)) return { error: "Bu sürüm artık kurallara uymuyor; geri dönülemiyor.", issues };

  const meta = { id: randomBytes(6).toString("hex"), at: nowIso(), by: who(staff), label: `Geri dönüş: ${version.label}`.slice(0, 80) };
  const res = await publishGuideContent(id, guide, meta, staff.id);
  if (!res.ok) return { error: res.error };

  await logPlatformActivity({ actorId: staff.id, action: "site_guide.rollback", entityType: "site_guide", entityId: id, meta: { slug: entry.slug, version: version.id } });
  refreshLive(res.entry);
  if (entry.category !== res.entry.category) revalidatePath(`/rehber/kategori/${entry.category}`);
  return { ok: true, guide };
}
