"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath, updateTag } from "next/cache";
import { now } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { defaultSiteMenu } from "@/lib/site-menu/defaults";
import { checkMenuMedia, MEDIA_LIMITS, type MediaRole } from "@/lib/site-menu/media";
import { hasErrors, validateSiteMenu, type Issue, type SiteMenuConfig } from "@/lib/site-menu/schema";
import {
  pruneMedia,
  publishConfig,
  readAdminState,
  resetToDefault,
  saveDraft,
  saveMedia,
  SITE_MENU_CACHE_TAG,
  type MediaEntry,
} from "@/lib/site-menu/store";

export type SiteMenuActionResult = { ok?: boolean; error?: string; issues?: Issue[]; media?: MediaEntry; config?: SiteMenuConfig };

const READONLY = "Site menüsünü yalnız süper admin değiştirebilir; bu hesap salt okunur.";
const HARD_FILE_LIMIT = MEDIA_LIMITS.motionBytes + 64 * 1024;

async function requireWriter() {
  const staff = await requirePlatformModule("sitemenu");
  return staff.role === "super_admin" ? staff : null;
}

function refreshAdmin() {
  revalidatePath("/admin/site-menu");
}

/** Canlı menüyü etkileyen yazmalar: etiketli önbelleği düşürür ve statik sayfaları yeniden üretir. */
function refreshLive() {
  updateTag(SITE_MENU_CACHE_TAG);
  refreshAdmin();
  revalidatePath("/", "layout");
}

/** Duyuru anahtarı: metin/bağlantı/bitiş değişince değişir; kapatılmış duyuru yeni metinle yeniden görünür. */
function withAnnouncementKey(cfg: SiteMenuConfig): SiteMenuConfig {
  const a = cfg.announcement;
  const key = createHash("sha1").update(`${a.text}|${a.href}|${a.endsOn}`).digest("hex").slice(0, 10);
  return { ...cfg, announcement: { ...a, key } };
}

/** Taslağı doğrular ve kaydeder. Hatalar kaydı engeller; uyarılar engellemez. */
export async function saveSiteMenuDraft(input: unknown): Promise<SiteMenuActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  const rl = await checkRateLimit(`site-menu-draft:${staff.id}`, { limit: 90, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık kaydettiniz; birkaç dakika sonra tekrar deneyin." };

  const state = await readAdminState();
  const { config, issues } = validateSiteMenu(input, { media: state.media });
  if (!config || hasErrors(issues)) return { error: "Menüde düzeltilmesi gereken hatalar var.", issues };

  const next = withAnnouncementKey(config);
  const saved = await saveDraft(next, staff.id);
  if (!saved.ok) return { error: saved.error, issues };

  await logPlatformActivity({
    actorId: staff.id,
    action: "site_menu.draft_save",
    entityType: "site_menu",
    entityId: "draft",
    meta: { groups: next.groups.length, footerColumns: next.footer.length, announcement: next.announcement.enabled },
  });
  refreshAdmin();
  return { ok: true, issues, config: next };
}

/** Kayıtlı taslağı canlıya alır; sürüm geçmişine yazar. */
export async function publishSiteMenu(label: string): Promise<SiteMenuActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  const rl = await checkRateLimit(`site-menu-publish:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık yayınladınız; birkaç dakika sonra tekrar deneyin." };

  const state = await readAdminState();
  if (!state.draft) return { error: "Yayınlanacak taslak yok; önce değişiklik yapıp taslağı kaydedin." };
  const { config, issues } = validateSiteMenu(state.draft, { media: state.media });
  if (!config || hasErrors(issues)) return { error: "Taslakta hatalar var; düzeltmeden yayınlanamaz.", issues };

  const note = String(label ?? "").trim().slice(0, 80) || "Yayın";
  const entry = { id: randomBytes(6).toString("hex"), at: new Date(now()).toISOString(), by: staff.full_name || staff.email, label: note };
  const res = await publishConfig(config, entry, staff.id);
  if (!res.ok) return { error: res.error };

  await logPlatformActivity({
    actorId: staff.id,
    action: "site_menu.publish",
    entityType: "site_menu",
    entityId: entry.id,
    meta: { label: note, groups: config.groups.length },
  });
  refreshLive();
  return { ok: true, issues };
}

/** Taslağı bırakır (canlı yapılandırma neyse taslak da o olur). */
export async function discardSiteMenuDraft(): Promise<SiteMenuActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  const state = await readAdminState();
  const base = state.live ?? defaultSiteMenu();
  const saved = await saveDraft(base, staff.id);
  if (!saved.ok) return { error: saved.error };
  await logPlatformActivity({ actorId: staff.id, action: "site_menu.draft_discard", entityType: "site_menu", entityId: "draft" });
  refreshAdmin();
  return { ok: true, config: base };
}

/** Seçilen eski sürümü canlıya alır (yeni bir sürüm olarak geçmişe yazılır). */
export async function rollbackSiteMenu(versionId: string): Promise<SiteMenuActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  const rl = await checkRateLimit(`site-menu-publish:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." };

  const state = await readAdminState();
  const version = state.history.find((h) => h.id === String(versionId));
  if (!version) return { error: "Sürüm bulunamadı." };
  const { config, issues } = validateSiteMenu(version.cfg, { media: state.media });
  if (!config || hasErrors(issues)) return { error: "Bu sürümdeki bazı medya dosyaları artık yok ya da kurallar değişti; geri dönülemiyor.", issues };

  const entry = {
    id: randomBytes(6).toString("hex"),
    at: new Date(now()).toISOString(),
    by: staff.full_name || staff.email,
    label: `Geri dönüş: ${version.label}`.slice(0, 80),
  };
  const res = await publishConfig(config, entry, staff.id);
  if (!res.ok) return { error: res.error };

  await logPlatformActivity({
    actorId: staff.id,
    action: "site_menu.rollback",
    entityType: "site_menu",
    entityId: version.id,
    meta: { label: version.label },
  });
  refreshLive();
  return { ok: true, config };
}

/** Canlı menüyü siler: site kodundaki varsayılan menüye döner; taslak da varsayılana eşitlenir. */
export async function resetSiteMenuToDefault(): Promise<SiteMenuActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  const rl = await checkRateLimit(`site-menu-publish:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." };

  const res = await resetToDefault({ id: randomBytes(6).toString("hex"), at: new Date(now()).toISOString(), by: staff.full_name || staff.email }, staff.id);
  if (!res.ok) return { error: res.error };
  await pruneMedia(staff.id);

  await logPlatformActivity({ actorId: staff.id, action: "site_menu.reset", entityType: "site_menu", entityId: "default" });
  refreshLive();
  return { ok: true, config: defaultSiteMenu() };
}

/** Logo/ikon, durağan görsel, poster veya animasyonlu/video medya yükler (tür bayt içeriğinden doğrulanır). */
export async function uploadSiteMenuMedia(fd: FormData): Promise<SiteMenuActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  const rl = await checkRateLimit(`site-menu-media:${staff.id}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık yükleme yaptınız; birkaç dakika sonra tekrar deneyin." };

  const role = String(fd.get("role") ?? "");
  if (role !== "icon" && role !== "image" && role !== "featured") return { error: "Geçersiz yükleme türü." };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Dosya seçilmedi." };
  if (file.size > HARD_FILE_LIMIT) return { error: "Dosya çok büyük." };

  const checked = checkMenuMedia(role as MediaRole, new Uint8Array(await file.arrayBuffer()));
  if (!checked.ok) return { error: checked.error };

  let state = await readAdminState();
  if (state.media.length >= MEDIA_LIMITS.maxAssets) {
    await pruneMedia(staff.id);
    state = await readAdminState();
    if (state.media.length >= MEDIA_LIMITS.maxAssets) {
      return { error: `En fazla ${MEDIA_LIMITS.maxAssets} medya dosyası saklanabilir; kullanılmayanlar yayın sonrası otomatik temizlenir.` };
    }
  }

  const entry: MediaEntry = {
    id: randomBytes(6).toString("hex"),
    type: checked.type,
    kind: checked.kind,
    bytes: checked.bytes,
    w: checked.w,
    h: checked.h,
    name: file.name.replace(/[^\p{L}\p{N}._ -]/gu, "").slice(0, 60) || "dosya",
    at: new Date(now()).toISOString(),
  };
  const saved = await saveMedia(entry, { type: checked.type, enc: checked.encoding, data: checked.data }, staff.id);
  if (!saved.ok) return { error: saved.error };

  await logPlatformActivity({
    actorId: staff.id,
    action: "site_menu.media_upload",
    entityType: "site_menu",
    entityId: entry.id,
    meta: { role, type: entry.type, kind: entry.kind, bytes: entry.bytes },
  });
  refreshAdmin();
  return { ok: true, media: entry };
}
