"use server";

import { logPlatformActivity } from "@/lib/platform-activity";
import { checkAlt, SITE_MEDIA_LIMITS } from "@/lib/site-media/quota";
import { deleteSiteMediaRow, readSiteMedia, removeVariantFiles, updateSiteMediaText } from "@/lib/site-media/store";
import { SITE_MEDIA_ID_RE } from "@/lib/site-media/types";
import {
  clipText,
  refreshSiteMediaCaches,
  requireSiteMediaWriter,
  runSiteMediaUpload,
  SITE_MEDIA_READONLY as READONLY,
  type SiteMediaActionResult,
} from "@/lib/site-media/upload";
import { usageLabel } from "@/lib/site-media/usage";
import { readSiteMediaUsageStrict } from "@/lib/site-media/usage-server";

/**
 * Site medya kütüphanesi eylemleri (modül `sitecontent`; yazma süper admin, operasyon salt okur — site içeriğiyle aynı).
 * Yükleme çekirdeği `src/lib/site-media/upload.ts` (eylem ve /admin/site/medya/yukle rotası ortak; önbellek yenileme
 * bağlama göre). Alt metin zorunlu, kota 1 GB / dosya 8 MB. Her yazma `logPlatformActivity`'ye düşer.
 * Kullanımdaki medya silinemez; "Değiştir" kimliği sabit tutar (yapılandırma değişmeden yeni görsel yayına girer).
 * `used_by` sütunu site içeriği yazmalarında eşitlenir (`syncSiteMediaUsage`); silme kapısı her zaman anlık hesaplar.
 */

/** Sunucu eylemi olarak yükleme (4 MB gövde sınırı; ekranlar 8 MB için rotayı kullanır). */
export async function uploadSiteMedia(form: FormData): Promise<SiteMediaActionResult> {
  // Kapı eylemde de açık (çekirdek ayrıca denetler; rota yolu yalnız çekirdekten geçer).
  if (!(await requireSiteMediaWriter())) return { error: READONLY };
  return runSiteMediaUpload(form, "action");
}

/** Alt metin / başlık düzenleme (alt metin zorunlu). */
export async function updateSiteMediaAlt(id: string, altInput: string, titleInput?: string): Promise<SiteMediaActionResult> {
  const staff = await requireSiteMediaWriter();
  if (!staff) return { error: READONLY };
  if (!SITE_MEDIA_ID_RE.test(String(id))) return { error: "Görsel bulunamadı." };
  const alt = checkAlt(altInput);
  if (!alt.ok) return { error: alt.error };
  const title = clipText(titleInput, SITE_MEDIA_LIMITS.titleMax) || null;
  const existing = await readSiteMedia(id);
  if (!existing) return { error: "Görsel bulunamadı." };
  if (!(await updateSiteMediaText(id, alt.alt, title))) return { error: "Kaydedilemedi; tekrar deneyin." };
  await logPlatformActivity({ actorId: staff.id, action: "site_media.alt_update", entityType: "site_media", entityId: id, meta: { altLength: alt.alt.length } });
  // Kullanım okunamazsa yayında sayılır (ana sayfa da yenilenir; fazladan yenileme zararsız).
  const usage = await readSiteMediaUsageStrict().then((u) => u.get(id) ?? [], () => ["sitecontent.live"]);
  refreshSiteMediaCaches(usage.some((u) => u.startsWith("sitecontent.live")), "action");
  return { ok: true, media: { ...existing, alt: alt.alt, title } };
}

/**
 * Siler. Yayında ya da taslakta kullanılan görsel SİLİNEMEZ (kullanım yapılandırmalardan o an SIKI okumayla hesaplanır;
 * okuma başarısızsa silme reddedilir: "okunamadı" "kullanılmıyor" sayılmaz).
 */
export async function deleteSiteMedia(id: string): Promise<SiteMediaActionResult> {
  const staff = await requireSiteMediaWriter();
  if (!staff) return { error: READONLY };
  if (!SITE_MEDIA_ID_RE.test(String(id))) return { error: "Görsel bulunamadı." };
  const existing = await readSiteMedia(id);
  if (!existing) return { error: "Görsel bulunamadı." };
  let usage: string[];
  try {
    usage = (await readSiteMediaUsageStrict()).get(id) ?? [];
  } catch {
    return { error: "Görselin kullanım bilgisi okunamadı; güvenlik için silinmedi. Biraz sonra tekrar deneyin." };
  }
  if (usage.length) return { error: `Bu görsel kullanımda: ${usage.map(usageLabel).join(", ")}. Önce o alandan kaldırın ya da “Değiştir” ile yeni dosya yükleyin.` };
  if (!(await deleteSiteMediaRow(id))) return { error: "Silinemedi; tekrar deneyin." };
  await removeVariantFiles(id, existing.variants.map((v) => v.file));
  await logPlatformActivity({ actorId: staff.id, action: "site_media.delete", entityType: "site_media", entityId: id, meta: { bytes: existing.bytes } });
  refreshSiteMediaCaches(false, "action");
  return { ok: true };
}

// Hero bütçe aşımı gerekçesi (kalite kapısı) artık SUNUCUDA, site içeriği taslak kaydında zorunlu tutulur ve denetim
// kaydına yazılır: src/app/actions/site-content.ts heroBudgetGate (istemci yalnız gerekçeyi toplar).
