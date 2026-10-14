import "server-only";
import { randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag, updateTag } from "next/cache";
import { now } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { SITE_CONTENT_CACHE_TAG } from "@/lib/site-content/store";
import { checkAlt, checkInputSize, checkQuota, heroBudget, isLargeOutput, kb, SITE_MEDIA_LIMITS } from "./quota";
import { sniffSiteMedia } from "./sniff";
import { SITE_MEDIA_CACHE_TAG, insertSiteMedia, readSiteMedia, removeVariantFiles, replaceSiteMediaFiles, uploadVariants, usedBytes } from "./store";
import { SITE_MEDIA_ID_RE, type SiteMediaRow } from "./types";
import { ImageProcessError, processSiteImage } from "./variants";

/**
 * Medya yükleme ÇEKİRDEĞİ (yalnız sunucu). İki çağıran var: `uploadSiteMedia` sunucu eylemi ve /admin/site/medya/yukle
 * rotası (8 MB giriş; ekranların TEK yükleme yolu). Önbellek yenileme bağlama göre seçilir: `updateTag` YALNIZ sunucu
 * eyleminde çalışır (rotada fırlatır: Next 16 revalidate.js), rotada `revalidateTag(tag, { expire: 0 })` (anında sona erdirme).
 */
export type SiteMediaActionResult = { ok?: boolean; error?: string; media?: SiteMediaRow; warnings?: string[] };
export type CacheContext = "action" | "route";

export const SITE_MEDIA_READONLY = "Medya kütüphanesini yalnız süper admin değiştirebilir; bu hesap salt okunur.";
export const SITE_MEDIA_SETUP = "Medya kütüphanesi henüz kurulmadı (veritabanı güncellemesi bekliyor).";

export async function requireSiteMediaWriter() {
  const staff = await requirePlatformModule("sitecontent");
  return staff.role === "super_admin" ? staff : null;
}

/** Medya yazmasından sonra önbellekler. `live`: yayındaki hero görseli değişti, ana sayfanın statik çıktısı da yenilenir. */
export function refreshSiteMediaCaches(live: boolean, ctx: CacheContext) {
  const expire = (tag: string) => (ctx === "action" ? updateTag(tag) : revalidateTag(tag, { expire: 0 }));
  expire(SITE_MEDIA_CACHE_TAG);
  revalidatePath("/admin/site/medya");
  revalidatePath("/admin/site/sayfalar/ana-sayfa");
  if (live) {
    expire(SITE_CONTENT_CACHE_TAG);
    revalidatePath("/");
  }
}

/** Yükleme uyarıları: ilk ekran bütçesi (960w AVIF > 120 KB) ve büyük çıktı (> 200 KB). Engellemez. */
function warningsFor(media: Pick<SiteMediaRow, "variants">): string[] {
  const out: string[] = [];
  const hb = heroBudget(media.variants);
  if (hb.over) out.push(`İlk ekran bütçesi aşıldı: 960 px AVIF ${kb(hb.bytes)} (sınır ${kb(SITE_MEDIA_LIMITS.heroBudgetBytes)}). Ana başlık görseli olarak sayfayı yavaşlatır; daha sade/küçük bir görsel önerilir.`);
  if (isLargeOutput(media.variants)) out.push(`Büyük dosya: en büyük çıktı ${kb(media.variants.reduce((m, v) => Math.max(m, v.bytes), 0))} (öneri ≤ ${kb(SITE_MEDIA_LIMITS.largeOutputBytes)}).`);
  return out;
}

export const clipText = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * Görsel yükler ya da (`replaceId`) mevcut görselin dosyasını değiştirir. FormData: file, alt, title?, replaceId?.
 * Kapı burada (sitecontent modülü + süper admin, sniff, sharp, kota, denetim).
 */
export async function runSiteMediaUpload(form: FormData, ctx: CacheContext): Promise<SiteMediaActionResult> {
  const staff = await requireSiteMediaWriter();
  if (!staff) return { error: SITE_MEDIA_READONLY };
  const rl = await checkRateLimit(`site-media-upload:${staff.id}`, { limit: 30, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık yükleme yaptınız; birkaç dakika sonra tekrar deneyin." };

  const file = form.get("file");
  if (!(file instanceof Blob)) return { error: "Dosya seçin." };
  const sizeErr = checkInputSize(file.size);
  if (sizeErr) return { error: sizeErr };
  const alt = checkAlt(form.get("alt"));
  if (!alt.ok) return { error: alt.error };
  const title = clipText(form.get("title"), SITE_MEDIA_LIMITS.titleMax) || null;
  const replaceRaw = form.get("replaceId");
  const replaceId = typeof replaceRaw === "string" && replaceRaw ? replaceRaw : null;
  if (replaceId && !SITE_MEDIA_ID_RE.test(replaceId)) return { error: "Değiştirilecek görsel bulunamadı." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniff = sniffSiteMedia(bytes);
  if (!sniff.ok) return { error: sniff.error };

  const existing = replaceId ? await readSiteMedia(replaceId) : null;
  if (replaceId && !existing) return { error: "Değiştirilecek görsel bulunamadı." };

  const used = await usedBytes();
  if (used === null) return { error: SITE_MEDIA_SETUP };

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
  // Değiştirmede eski dosyalar kaldırılır. Yayındaki HTML eski adlara bir süre daha başvurabilir (statik ana sayfa
  // belleği, ISR, tarayıcı): /medya rotası kayıtta olmayan eski adı aynı kimliğin güncel varyantıyla (kısa önbellek) sunar.
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
  refreshSiteMediaCaches(Boolean(existing), ctx);
  return { ok: true, media, warnings };
}
