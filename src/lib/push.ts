import type WebPush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

let configured: typeof WebPush | null = null;

/**
 * web-push (~110 KB) yalnız gerçekten push gönderilirken yüklenir: bildirim üreten (notify.ts) her sayfa/eylem
 * modülünün soğuk başlangıç paketini şişirmez. VAPID anahtarı yoksa paket hiç yüklenmez.
 */
async function ensureConfigured(): Promise<typeof WebPush | null> {
  if (configured) return configured;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return null;
  const mod = await import("web-push");
  const webpush = (mod.default ?? mod) as typeof WebPush;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:destek@emlaksoft.com.tr",
    pub,
    priv,
  );
  configured = webpush;
  return configured;
}

export type PushPayload = {
  title: string;
  body?: string;
  href?: string;
};

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

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          JSON.stringify(payload),
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("id", s.id);
        }
      }
    }),
  );
}

export function pushConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}
