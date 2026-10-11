import "server-only";
import { afterSafe } from "@/lib/after-safe";
import { createClient } from "@/lib/supabase/server";
import { closeCallPriorityForCustomer } from "@/lib/insights/store";

/**
 * Olay anında kapatma: arama (`calls`) ya da iletişim kaydı (`communications`) eklendiğinde müşterinin açık "Bugün ara"
 * kartı motor turunu (cron) beklemeden kapanır. Çağıranın oturumuyla, dar `insight_close_call_priority` RPC'si üzerinden
 * çalışır (service_role kullanılmaz; ofis oturumdan çözülür).
 *
 * ASLA fırlatmaz: kullanıcı akışı (arama kaydı) öneri kapatma hatasından etkilenmez.
 */
export async function closeCallPriorityOnContact(customerId: string | null | undefined): Promise<void> {
  if (!customerId) return;
  try {
    await closeCallPriorityForCustomer(await createClient(), customerId);
  } catch (e) {
    console.error("close-on-contact", e instanceof Error ? e.message : "hata");
  }
}

/** Yanıt gönderildikten SONRA çalıştırır (`afterSafe` = `after()` + hata yakalama); kullanıcı akışını geciktirmez. */
export function closeCallPriorityAfterContact(customerId: string | null | undefined): void {
  if (!customerId) return;
  afterSafe(() => closeCallPriorityOnContact(customerId), "call_priority kapatma");
}
