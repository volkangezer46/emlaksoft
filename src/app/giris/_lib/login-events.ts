import { createAdminClient } from "@/lib/supabase/admin";
import { notifyIfNewDevice } from "@/lib/office-security/new-device";

/**
 * Giriş günlüğü — her giriş denemesi login_events'e yazılır.
 * Yazma yalnız service_role (RLS'de insert policy yok); hata olursa giriş
 * akışını asla bloklamaz (best-effort).
 */
export type LoginEventResult = "success" | "failed" | "2fa_pending" | "2fa_failed";

export async function logLoginEvent(input: {
  userId?: string | null;
  tenantId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  result: LoginEventResult;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    // DG7: ofis "yeni cihaz bildirimi" açıksa bu giriş önceki başarılı girişlerle karşılaştırılır (satır yazılmadan önce).
    if (input.result === "success" && input.userId && input.tenantId) {
      await notifyIfNewDevice(admin, {
        userId: input.userId,
        tenantId: input.tenantId,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      });
    }
    const { error } = await admin.from("login_events").insert({
      user_id: input.userId ?? null,
      tenant_id: input.tenantId ?? null,
      ip: input.ip ? input.ip.slice(0, 100) : null,
      user_agent: input.userAgent ? input.userAgent.slice(0, 300) : null,
      result: input.result,
    });
    if (error) console.error("logLoginEvent", error.message);
  } catch (e) {
    // Tablo henüz oluşmadıysa (migration uygulanmadı) giriş yine çalışır
    console.error("logLoginEvent", e);
  }
}
