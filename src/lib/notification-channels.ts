import "server-only";
import { pushConfigured } from "@/lib/push";
import { isTenantSmsAvailable } from "@/lib/messaging/tenant-providers";

/**
 * Bildirim kanallarının bu ortamda/ofiste açık olup olmadığı (ayarlar ekranındaki "bu kanal kapalı" uyarısı için).
 *  - push: VAPID anahtarları (NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY) tanımlı mı; yoksa bildirimler yalnız zile düşer.
 *  - sms: ofisin Netgsm entegrasyonu (platform yedeği yalnız açıkça izinliyse) hazır mı; yoksa müşteriye otomatik SMS gitmez.
 * Hata durumunda kanal "kapalı" sayılır (iyimser gösterim yok).
 */
export type NotificationChannels = { push: boolean; sms: boolean };

export async function loadNotificationChannels(tenantId: string | null | undefined): Promise<NotificationChannels> {
  const sms = tenantId ? await isTenantSmsAvailable(tenantId).catch(() => false) : false;
  return { push: pushConfigured(), sms };
}
