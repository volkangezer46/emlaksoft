"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath, updateTag } from "next/cache";
import { now } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import type { Issue } from "@/lib/site-menu/schema";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import { hasErrors, validateSiteContent, type SiteContent } from "@/lib/site-content/schema";
import { SITE_CONTENT_CACHE_TAG, siteContentStore } from "@/lib/site-content/store";

export type SiteContentActionResult = { ok?: boolean; error?: string; issues?: Issue[]; config?: SiteContent };

const READONLY = "Site içeriğini yalnız süper admin değiştirebilir; bu hesap salt okunur.";

/** Yazma yetkisi: süper admin. Operasyon salt okur. Her action önce requirePlatformModule ile kapılanır. */
async function requireWriter() {
  const staff = await requirePlatformModule("sitecontent");
  return staff.role === "super_admin" ? staff : null;
}

function refreshAdmin() {
  revalidatePath("/admin/site-icerik");
  revalidatePath("/admin/site");
}

/** Canlı içeriği etkileyen yazmalar: etiketli önbelleği düşürür, ana sayfa/kayıt statik çıktılarını yeniler. */
function refreshLive() {
  updateTag(SITE_CONTENT_CACHE_TAG);
  refreshAdmin();
  revalidatePath("/");
  revalidatePath("/kayit");
}

const entryNow = () => new Date(now()).toISOString();

/** Taslağı doğrular ve kaydeder. Hatalar kaydı engeller; uyarılar (riskli kelime vb.) engellemez. */
export async function saveSiteContentDraft(input: unknown): Promise<SiteContentActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  const rl = await checkRateLimit(`site-content-draft:${staff.id}`, { limit: 90, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık kaydettiniz; birkaç dakika sonra tekrar deneyin." };

  const { config, issues } = validateSiteContent(input);
  if (!config || hasErrors(issues)) return { error: "İçerikte düzeltilmesi gereken hatalar var.", issues };

  const saved = await siteContentStore.saveDraft(config, staff.id);
  if (!saved.ok) return { error: saved.error, issues };

  await logPlatformActivity({
    actorId: staff.id,
    action: "site_content.draft_save",
    entityType: "site_content",
    entityId: "draft",
    meta: { faq: config.faq.length, warnings: issues.length },
  });
  refreshAdmin();
  return { ok: true, issues, config };
}

/** Kayıtlı taslağı canlıya alır; sürüm geçmişine yazar. */
export async function publishSiteContent(label: string): Promise<SiteContentActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  const rl = await checkRateLimit(`site-content-publish:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık yayınladınız; birkaç dakika sonra tekrar deneyin." };

  const state = await siteContentStore.readState();
  if (!state.draft) return { error: "Yayınlanacak taslak yok; önce değişiklik yapıp taslağı kaydedin." };
  const { config, issues } = validateSiteContent(state.draft);
  if (!config || hasErrors(issues)) return { error: "Taslakta hatalar var; düzeltmeden yayınlanamaz.", issues };

  const note = String(label ?? "").trim().slice(0, 80) || "Yayın";
  const entry = { id: randomBytes(6).toString("hex"), at: entryNow(), by: staff.full_name || staff.email, label: note };
  const res = await siteContentStore.publish(config, entry, staff.id);
  if (!res.ok) return { error: res.error };

  await logPlatformActivity({ actorId: staff.id, action: "site_content.publish", entityType: "site_content", entityId: entry.id, meta: { label: note } });
  refreshLive();
  return { ok: true, issues };
}

/** Taslağı bırakır (canlı içerik neyse taslak da o olur). */
export async function discardSiteContentDraft(): Promise<SiteContentActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  const state = await siteContentStore.readState();
  const base = state.live ?? defaultSiteContent();
  const saved = await siteContentStore.saveDraft(base, staff.id);
  if (!saved.ok) return { error: saved.error };
  await logPlatformActivity({ actorId: staff.id, action: "site_content.draft_discard", entityType: "site_content", entityId: "draft" });
  refreshAdmin();
  return { ok: true, config: base };
}

/** Seçilen eski sürümü canlıya alır (yeni bir sürüm olarak geçmişe yazılır). */
export async function rollbackSiteContent(versionId: string): Promise<SiteContentActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  const rl = await checkRateLimit(`site-content-publish:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." };

  const state = await siteContentStore.readState();
  const version = state.history.find((h) => h.id === String(versionId));
  if (!version) return { error: "Sürüm bulunamadı." };
  const { config, issues } = validateSiteContent(version.cfg);
  if (!config || hasErrors(issues)) return { error: "Bu sürüm artık kurallara uymuyor; geri dönülemiyor.", issues };

  const entry = { id: randomBytes(6).toString("hex"), at: entryNow(), by: staff.full_name || staff.email, label: `Geri dönüş: ${version.label}`.slice(0, 80) };
  const res = await siteContentStore.publish(config, entry, staff.id);
  if (!res.ok) return { error: res.error };

  await logPlatformActivity({ actorId: staff.id, action: "site_content.rollback", entityType: "site_content", entityId: version.id, meta: { label: version.label } });
  refreshLive();
  return { ok: true, config };
}

/** Canlı içeriği siler: site kodundaki varsayılan (bugünkü) metne döner; taslak da varsayılana eşitlenir. */
export async function resetSiteContentToDefault(): Promise<SiteContentActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  const rl = await checkRateLimit(`site-content-publish:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." };

  const res = await siteContentStore.resetToDefault({ id: randomBytes(6).toString("hex"), at: entryNow(), by: staff.full_name || staff.email }, staff.id);
  if (!res.ok) return { error: res.error };

  await logPlatformActivity({ actorId: staff.id, action: "site_content.reset", entityType: "site_content", entityId: "default" });
  refreshLive();
  return { ok: true, config: defaultSiteContent() };
}
