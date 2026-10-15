import "server-only";
import { SUPPORT_MAILTO } from "@/lib/contact-info";
import type WebPush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NotificationTopic, PushAction, PushEntityRef } from "@/lib/notification-topics";

let configured: typeof WebPush | null = null;

/**
 * web-push (~110 KB) yalnız gerçekten push gönderilirken yüklenir: bildirim üreten (notify.ts) her sayfa/eylem
 * modülünün soğuk başlangıç paketini şişirmez. VAPID anahtarı yoksa paket hiç yüklenmez.
 *
 * VAPID anahtarları depoda ÜRETİLMEZ ve tutulmaz: sunucu ortamında (`.env.production`) bir kez yerel olarak üretilir
 * (`npx web-push generate-vapid-keys`) → `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
 * Genel anahtar derleme anında pakete gömüldüğü için anahtar eklenince yeniden derleme gerekir. Anahtar yoksa push
 * sessizce kapalıdır; tercih paneli bunu "push kanalı kapalı" uyarısıyla gösterir. Ayrıntı: docs/DEPLOY.md.
 */
async function ensureConfigured(): Promise<typeof WebPush | null> {
  if (configured) return configured;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return null;
  const mod = await import("web-push");
  const webpush = (mod.default ?? mod) as typeof WebPush;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? SUPPORT_MAILTO,
    pub,
    priv,
  );
  configured = webpush;
  return configured;
}

/**
 * Service worker'a giden yük (public/sw.js okur; her alan orada yeniden doğrulanır/kırpılır).
 * KİŞİSEL VERİ sınırı: başlık/gövde zaten bildirim satırında olan metindir; `tel` yalnız "Ara" eylemi için.
 */
export type PushPayload = {
  title: string;
  body?: string;
  href?: string;
  /** Aynı etiketli yeni bildirim öncekinin YERİNE geçer (yığılma yok). */
  tag?: string;
  /** Etiket aynıyken yeniden titreşim/ses (cevapsız arama gibi acil türler). */
  renotify?: boolean;
  topic?: NotificationTopic;
  kind?: string;
  /** En çok 2 eylem düğmesi (Android/masaüstü). */
  actions?: PushAction[];
  /** `done`/`snooze` eylemlerinin hedef kaydı. */
  entity?: PushEntityRef;
  /** "Ara" eylemi için ham numara; sw.js yalnız rakam/+ kabul eder. */
  tel?: string;
};

type Sub = { id: string; endpoint: string; p256dh: string; auth: string; user_id?: string };

async function deliver(webpush: typeof WebPush, admin: SupabaseClient, subs: Sub[], payload: PushPayload) {
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          TTL: 6 * 3600,
          urgency: payload.kind === "danger" ? "high" : "normal",
          ...(payload.tag ? { topic: pushTopicHeader(payload.tag) } : {}),
        });
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("id", s.id);
        }
      }
    }),
  );
}

/**
 * Web Push `Topic` başlığı: aynı konudaki bekleyen (cihaz çevrimdışıyken kuyruğa giren) mesajı push servisi değiştirir.
 * RFC 8030: en çok 32 karakter, URL-safe base64 alfabesi.
 */
export function pushTopicHeader(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i += 1) h = (Math.imul(h, 31) + tag.charCodeAt(i)) | 0;
  const safe = tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 22);
  return `${safe}${(h >>> 0).toString(36)}`.slice(0, 32);
}

/**
 * Kullanıcının tüm cihazlarına push gönderir (best-effort).
 * VAPID anahtarı yoksa sessizce atlar — sistem çalışmaya devam eder.
 */
export async function sendPushToUser(tenantId: string, userId: string, payload: PushPayload) {
  const webpush = await ensureConfigured();
  if (!webpush) return;

  const admin = createAdminClient();
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);

  if (!subs?.length) return;
  await deliver(webpush, admin, subs as Sub[], payload);
}

/**
 * Toplu push (cron hatırlatmaları): TEK abonelik sorgusu, kullanıcı başına yük. İstemci OLUŞTURMAZ, çağıranın
 * service_role istemcisini alır. Tercih/sessiz saat süzgeci çağıranda uygulanır (`pushAllowed`).
 */
export async function sendPushBatch(
  admin: SupabaseClient,
  items: readonly { tenantId: string; userId: string; payload: PushPayload }[],
): Promise<number> {
  if (items.length === 0) return 0;
  const webpush = await ensureConfigured();
  if (!webpush) return 0;
  const userIds = [...new Set(items.map((i) => i.userId))];
  const tenantIds = [...new Set(items.map((i) => i.tenantId))];
  const subsByUser = new Map<string, Sub[]>();
  for (let i = 0; i < userIds.length; i += 200) {
    const { data } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, user_id, tenant_id")
      .in("tenant_id", tenantIds)
      .in("user_id", userIds.slice(i, i + 200));
    for (const s of (data ?? []) as (Sub & { user_id: string; tenant_id: string })[]) {
      const key = `${s.tenant_id}:${s.user_id}`;
      subsByUser.set(key, [...(subsByUser.get(key) ?? []), s]);
    }
  }
  let sent = 0;
  for (const item of items) {
    const subs = subsByUser.get(`${item.tenantId}:${item.userId}`);
    if (!subs?.length) continue;
    await deliver(webpush, admin, subs, item.payload);
    sent += 1;
  }
  return sent;
}

export function pushConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}
