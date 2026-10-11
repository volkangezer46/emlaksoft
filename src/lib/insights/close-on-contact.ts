import "server-only";
import { afterSafe } from "@/lib/after-safe";
import { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import { closeCallPriorityForCustomer } from "@/lib/insights/store";

/**
 * Olay anında kapatma: arama (`calls`) ya da iletişim kaydı (`communications`) eklendiğinde müşterinin açık "Bugün ara"
 * kartı motor turunu (cron) beklemeden kapanır. `insights` tablosuna yazma yalnız service_role'dedir (RLS'te yazma
 * politikası yok), bu yüzden tek, dar bir yardımcıdır: yalnız bu kiracı + bu müşteri + `call_priority` + açık satırlar.
 *
 * ASLA fırlatmaz: kullanıcı akışı (arama kaydı) içgörü kapatma hatasından etkilenmez.
 */
export async function closeCallPriorityOnContact(tenantId: string, customerId: string | null | undefined): Promise<void> {
  if (!tenantId || !customerId) return;
  try {
    await closeCallPriorityForCustomer(createAdminClient(), tenantId, customerId, now());
  } catch (e) {
    console.error("close-on-contact", e instanceof Error ? e.message : "hata");
  }
}

/** Yanıt gönderildikten SONRA çalıştırır (`afterSafe` = `after()` + hata yakalama); kullanıcı akışını geciktirmez. */
export function closeCallPriorityAfterContact(tenantId: string, customerId: string | null | undefined): void {
  if (!tenantId || !customerId) return;
  afterSafe(() => closeCallPriorityOnContact(tenantId, customerId), "call_priority kapatma");
}
