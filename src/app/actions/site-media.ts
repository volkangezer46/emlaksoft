"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath, updateTag } from "next/cache";
import { now } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { SITE_CONTENT_CACHE_TAG, siteContentStore } from "@/lib/site-content/store";
import { checkAlt, checkInputSize, checkQuota, heroBudget, isLargeOutput, kb, SITE_MEDIA_LIMITS } from "@/lib/site-media/quota";
import { sniffSiteMedia } from "@/lib/site-media/sniff";
import {
  SITE_MEDIA_CACHE_TAG,
  deleteSiteMediaRow,
  insertSiteMedia,
  listSiteMedia,
  readSiteMedia,
  removeVariantFiles,
  replaceSiteMediaFiles,
  syncUsedBy,
  updateSiteMediaText,
  uploadVariants,
  usedBytes,
} from "@/lib/site-media/store";
import { SITE_MEDIA_ID_RE, type SiteMediaRow } from "@/lib/site-media/types";
import { computeUsage, usageLabel } from "@/lib/site-media/usage";
import { ImageProcessError, processSiteImage } from "@/lib/site-media/variants";

/**
 * Site medya kütüphanesi eylemleri (modül `sitecontent`; yazma süper admin, operasyon salt okur — site içeriğiyle aynı).
 * Yükleme: tür BAYT İMZASINDAN (sniff), sharp ile yeniden kodlama (EXIF atılır, 480/960/1600 x AVIF/WebP, LQIP),
 * alt metin zorunlu, kota 1 GB / dosya 8 MB. Her yazma `logPlatformActivity`'ye düşer.
 * Kullanımdaki medya silinemez; "Değiştir" kimliği sabit tutar (yapılandırma değişmeden yeni görsel yayına girer).
 */

export type SiteMediaActionResult = { ok?: boolean; error?: string; media?: SiteMediaRow; warnings?: string[] };

const READONLY = "Medya kütüphanesini yalnız süper admin değiştirebilir; bu hesap salt okunur.";
const SETUP = "Medya kütüphanesi henüz kurulmadı (veritabanı güncellemesi bekliyor).";

async function requireWriter() {
  const staff = await requirePlatformModule("sitecontent");
  return staff.role === "super_admin" ? staff : null;
}

function refresh(live: boolean) {
  updateTag(SITE_MEDIA_CACHE_TAG);
  revalidatePath("/admin/site/medya");
  revalidatePath("/admin/site-icerik");
  if (live) {
    // Yayındaki hero görseli değişti (Değiştir): ana sayfanın statik çıktısı yenilenir.
    updateTag(SITE_CONTENT_CACHE_TAG);
    revalidatePath("/");
  }
}

async function currentUsage() {
  const state = await siteContentStore.readState();
  return computeUsage({ live: state.live, draft: state.draft });
}

/** Yükleme uyarıları: ilk ekran bütçesi (960w AVIF > 120 KB) ve büyük çıktı (> 200 KB). Engellemez. */
function warningsFor(media: Pick<SiteMediaRow, "variants">): string[] {
  const out: string[] = [];
  const hb = heroBudget(media.variants);
  if (hb.over) out.push(`İlk ekran bütçesi aşıldı: 960 px AVIF ${kb(hb.bytes)} (sınır ${kb(SITE_MEDIA_LIMITS.heroBudgetBytes)}). Ana başlık görseli olarak sayfayı yavaşlatır; daha sade/küçük bir görsel önerilir.`);
  if (isLargeOutput(media.variants)) out.push(`Büyük dosya: en büyük çıktı ${kb(media.variants.reduce((m, v) => Math.max(m, v.bytes), 0))} (öneri ≤ ${kb(SITE_MEDIA_LIMITS.largeOutputBytes)}).`);
  return out;
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * Görsel yükler ya da (`replaceId`) mevcut görselin dosyasını değiştirir. FormData: file, alt, title?, replaceId?.
 * 4 MB üstü dosyalar istemciden /admin/site/medya/yukle rotasıyla gelir (sunucu eylemi gövde sınırı); kapı burada.
 */
export async function uploadSiteMedia(form: FormData): Promise<SiteMediaActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  const rl = await checkRateLimit(`site-media-upload:${staff.id}`, { limit: 30, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık yükleme yaptınız; birkaç dakika sonra tekrar deneyin." };

  const file = form.get("file");
  if (!(file instanceof Blob)) return { error: "Dosya seçin." };
  const sizeErr = checkInputSize(file.size);
  if (sizeErr) return { error: sizeErr };
  const alt = checkAlt(form.get("alt"));
  if (!alt.ok) return { error: alt.error };
  const title = clip(form.get("title"), SITE_MEDIA_LIMITS.titleMax) || null;
  const replaceRaw = form.get("replaceId");
  const replaceId = typeof replaceRaw === "string" && replaceRaw ? replaceRaw : null;
  if (replaceId && !SITE_MEDIA_ID_RE.test(replaceId)) return { error: "Değiştirilecek görsel bulunamadı." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniff = sniffSiteMedia(bytes);
  if (!sniff.ok) return { error: sniff.error };

  const existing = replaceId ? await readSiteMedia(replaceId) : null;
  if (replaceId && !existing) return { error: "Değiştirilecek görsel bulunamadı." };

  const used = await usedBytes();
  if (used === null) return { error: SETUP };

  let processed;
  try {
    processed = await processSiteImage(Buffer.from(bytes), sniff.type);
  } catch (e) {
    return { error: e instanceof ImageProcessError ? e.message : "Görsel işlenemedi." };
  }
  const quotaErr = checkQuota({ usedBytes: used, incomingBytes: processed.bytes, replacingBytes: existing?.bytes ?? 0 });
  if (quotaErr) return { error: quotaErr };

  const id = existing?.id ?? randomUUID();
  if (!(await uploadVariants(id, processed.variants))) return { error: "Görsel depoya yazılamadı; tekrar deneyin." };
  const variants = processed.variants.map(({ file: f, w, h, format, bytes: b }) => ({ file: f, w, h, format, bytes: b }));
  const row = { alt: alt.alt, title, w: processed.w, h: processed.h, bytes: processed.bytes, mime: sniff.mime, variants, lqip: processed.lqip };
  const saved = existing ? await replaceSiteMediaFiles(id, row) : await insertSiteMedia(id, row, staff.id);
  if (!saved) {
    await removeVariantFiles(id, variants.map((v) => v.file));
    return { error: "Görsel kaydı yazılamadı; tekrar deneyin." };
  }
  // Değiştirmede eski dosyalar kaldırılır (yeni adlar içerik sürümü taşır; kalıcı önbellekteki eski adlar zaten değişmez).
  if (existing) await removeVariantFiles(id, existing.variants.map((v) => v.file).filter((f) => !variants.some((v) => v.file === f)));

  const media: SiteMediaRow = { id, ...row, usedBy: existing?.usedBy ?? [], createdAt: existing?.createdAt ?? new Date(now()).toISOString() };
  const warnings = warningsFor(media);
  await logPlatformActivity({
    actorId: staff.id,
    action: existing ? "site_media.replace" : "site_media.upload",
    entityType: "site_media",
    entityId: id,
    meta: { w: processed.w, h: processed.h, bytes: processed.bytes, inputBytes: bytes.length, mime: sniff.mime, heroBudgetOver: heroBudget(variants).over },
  });
  refresh(Boolean(existing));
  return { ok: true, media, warnings };
}

/** Alt metin / başlık düzenleme (alt metin zorunlu). */
export async function updateSiteMediaAlt(id: string, altInput: string, titleInput?: string): Promise<SiteMediaActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  if (!SITE_MEDIA_ID_RE.test(String(id))) return { error: "Görsel bulunamadı." };
  const alt = checkAlt(altInput);
  if (!alt.ok) return { error: alt.error };
  const title = clip(titleInput, SITE_MEDIA_LIMITS.titleMax) || null;
  const existing = await readSiteMedia(id);
  if (!existing) return { error: "Görsel bulunamadı." };
  if (!(await updateSiteMediaText(id, alt.alt, title))) return { error: "Kaydedilemedi; tekrar deneyin." };
  await logPlatformActivity({ actorId: staff.id, action: "site_media.alt_update", entityType: "site_media", entityId: id, meta: { altLength: alt.alt.length } });
  refresh(((await currentUsage()).get(id) ?? []).some((u) => u.startsWith("sitecontent.live")));
  return { ok: true, media: { ...existing, alt: alt.alt, title } };
}

/** Siler. Yayında ya da taslakta kullanılan görsel SİLİNEMEZ (kullanım yapılandırmalardan o an hesaplanır). */
export async function deleteSiteMedia(id: string): Promise<SiteMediaActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  if (!SITE_MEDIA_ID_RE.test(String(id))) return { error: "Görsel bulunamadı." };
  const existing = await readSiteMedia(id);
  if (!existing) return { error: "Görsel bulunamadı." };
  const usage = (await currentUsage()).get(id) ?? [];
  if (usage.length) return { error: `Bu görsel kullanımda: ${usage.map(usageLabel).join(", ")}. Önce o alandan kaldırın ya da “Değiştir” ile yeni dosya yükleyin.` };
  if (!(await deleteSiteMediaRow(id))) return { error: "Silinemedi; tekrar deneyin." };
  await removeVariantFiles(id, existing.variants.map((v) => v.file));
  await logPlatformActivity({ actorId: staff.id, action: "site_media.delete", entityType: "site_media", entityId: id, meta: { bytes: existing.bytes } });
  refresh(false);
  return { ok: true };
}

/** `used_by` sütununu yayın/taslak yapılandırmasından yeniden hesaplar (Medya ekranındaki "Kullanımı yenile"). */
export async function refreshSiteMediaUsage(): Promise<SiteMediaActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  const list = await listSiteMedia();
  if (list.status !== "ok") return { error: list.status === "missing" ? SETUP : list.error };
  await syncUsedBy(list.items, await currentUsage());
  refresh(false);
  return { ok: true };
}

/**
 * Kalite kapısı: hero görseli ilk ekran bütçesini aşarken taslak kaydı "Yine de kaydet" ile yapılırsa gerekçe zorunludur
 * ve denetim kaydına yazılır (kayıt engellenmez; karar izlenebilir kalır).
 */
export async function acknowledgeHeroBudget(mediaId: string, reasonInput: string): Promise<SiteMediaActionResult> {
  const staff = await requireWriter();
  if (!staff) return { error: READONLY };
  const reason = clip(reasonInput, 300);
  if (reason.length < 5) return { error: "Gerekçe yazın (en az 5 karakter)." };
  if (!SITE_MEDIA_ID_RE.test(String(mediaId))) return { error: "Görsel bulunamadı." };
  const media = await readSiteMedia(mediaId);
  if (!media) return { error: "Görsel bulunamadı." };
  const hb = heroBudget(media.variants);
  await logPlatformActivity({ actorId: staff.id, action: "site_media.hero_budget_override", entityType: "site_media", entityId: mediaId, meta: { bytes: hb.bytes, limit: SITE_MEDIA_LIMITS.heroBudgetBytes, reason } });
  return { ok: true };
}
