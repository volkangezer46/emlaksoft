"use server";

import { readPreviewDraft } from "@/app/onizleme/ana-sayfa/draft";
import { now } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { createPreviewToken, isPreviewTtl, DEFAULT_PREVIEW_TTL_HOURS } from "@/lib/preview-token";
import { checkRateLimit } from "@/lib/rate-limit";

export type PreviewLinkResult = { ok: true; path: string; expiresAt: string; ttlHours: number } | { ok: false; error: string };

/**
 * Kayıtlı taslağın gerçek sayfa önizlemesi için imzalı bağlantı üretir (/onizleme/ana-sayfa?t=...). Personel oturumu
 * (sitecontent modülü; operasyon da salt okur ve önizleyebilir). Bağlantı oturumsuz açılır, yalnız bu taslağı gösterir;
 * taslak değişince geçersiz olur. Kaydedilmemiş editör değişiklikleri bağlantıya girmez (önce taslak kaydedilir).
 */
export async function createSiteContentPreviewLink(ttlHours: unknown): Promise<PreviewLinkResult> {
  const staff = await requirePlatformModule("sitecontent");
  const rl = await checkRateLimit(`site-content-preview:${staff.id}`, { limit: 60, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { ok: false, error: "Çok sık bağlantı ürettiniz; birkaç dakika sonra tekrar deneyin." };

  const ttl = isPreviewTtl(ttlHours) ? ttlHours : DEFAULT_PREVIEW_TTL_HOURS;
  const { hash } = await readPreviewDraft();
  const signed = createPreviewToken({ surface: "sitecontent", draftHash: hash, ttlHours: ttl, nowMs: now() });
  if (!signed) return { ok: false, error: "Önizleme bağlantısı kapalı: sunucuda PLATFORM_SECRETS_KEY veya CRON_SECRET tanımlı değil." };

  await logPlatformActivity({ actorId: staff.id, action: "site_content.preview_link", entityType: "site_content", entityId: "draft", meta: { ttlHours: ttl } });
  return { ok: true, path: `/onizleme/ana-sayfa?t=${encodeURIComponent(signed.token)}`, expiresAt: new Date(signed.exp * 1000).toISOString(), ttlHours: ttl };
}
