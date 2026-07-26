import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push";

/**
 * Kiracıya bildirim yaz.
 *
 * NEDEN `actions/` DEĞİL DE `lib/`: Bu fonksiyon `src/app/actions/notifications.ts`
 * içindeydi. O dosya `"use server"` taşıyor, yani ORADAN EXPORT EDİLEN HER
 * FONKSİYON tarayıcıdan çağrılabilen bir uç nokta oluyor.
 *
 * Bu fonksiyonun iki özelliği birleşince sorun çıkıyordu:
 *   1. `tenantId`'yi PARAMETRE olarak alıyor — yani hedefi çağıran seçiyor
 *   2. `createAdminClient()` (service_role) kullanıyor — RLS'i tamamen atlıyor
 *
 * Yetki kontrolü de yoktu. Action kimliğini ele geçiren biri istediği kiracıya
 * istediği içerikte bildirim yazdırabilirdi.
 *
 * `lib/` altına taşınınca artık bir uç nokta DEĞİL: yalnızca sunucu tarafındaki
 * kod import edebiliyor. Çağıran 5 yerin (deals, matching, tasks, workflow,
 * platform-notifications) hepsi kendi yetki kapısını zaten geçiyor.
 *
 * service_role kullanımı burada DOĞRU: bildirim çoğu zaman işlemi yapan
 * kullanıcıdan BAŞKASINA yazılıyor (ör. eşleşme bulununca portföyün
 * danışmanına) ve o satırı kullanıcının kendi oturumu RLS yüzünden yazamaz.
 */
/**
 * Tercih anahtarları — profiles.notification_prefs jsonb'sindeki boolean
 * bayraklar. Eksik anahtar AÇIK sayılır (marketing hariç; onun UI varsayılanı
 * kapalı). Yeni tür ekleyince buraya, UI ROWS'a ve action DEFAULTS'a da ekle.
 */
export type NotifPrefKey =
  | "portal"
  | "appointment"
  | "commission"
  | "digest"
  | "marketing"
  | "priceDrop"
  | "savedSearch"
  | "share"
  | "dunning"
  | "rentOverdue"
  | "network";

export async function notifyTenant(input: {
  tenantId: string;
  userId?: string | null;
  title: string;
  body?: string;
  href?: string;
  kind?: "info" | "success" | "warning" | "danger" | "system";
  /**
   * Verilirse ve hedef KULLANICI bu türü kapattıysa bildirim TAMAMEN atlanır
   * (zil satırı + push) — gunluk-ozet cron'unun `wantsDigest` deseniyle aynı.
   * Tercih kaydı yoksa varsayılan AÇIK. userId'siz (tenant-geneli) bildirimde
   * sunucu tarafında kişi bazlı tercih uygulanamaz; o satırları zil tarafında
   * `filterByNotifPrefs` (notification-prefs.tsx) kullanıcı bazında süzer.
   */
  prefKey?: NotifPrefKey;
}) {
  const admin = createAdminClient();

  if (input.prefKey && input.userId) {
    const { data: profile } = await admin
      .from("profiles")
      .select("notification_prefs")
      .eq("id", input.userId)
      .maybeSingle();
    const prefs = profile?.notification_prefs as Record<string, unknown> | null | undefined;
    if (prefs && typeof prefs === "object" && prefs[input.prefKey] === false) return;
  }

  await admin.from("notifications").insert({
    tenant_id: input.tenantId,
    user_id: input.userId ?? null,
    title: input.title,
    body: input.body ?? null,
    href: input.href ?? null,
    kind: input.kind ?? "info",
  });

  if (input.userId) {
    // Best-effort: VAPID yoksa sessizce atlar, bildirim satırı zaten yazıldı.
    void sendPushToUser(input.tenantId, input.userId, {
      title: input.title,
      body: input.body,
      href: input.href,
    });
  }
}
