import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterSafe } from "@/lib/after-safe";
import { now } from "@/lib/clock";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAuthorityEventById } from "./actions";

/**
 * EİDS ANLIK AKIŞ: defter olayı (`applyAuthorityEvent` / `undoAuthorityEvent`) başarıyla yazıldıktan sonra aksiyon motoru
 * AYNI istekte, yanıt gönderildikten hemen sonra (`after()`) çalışır: iptal e-postası işlendiği anda danışmana ACİL
 * kaldırma görevi + bildirim, verme e-postasında yayın görevi açılır (cron'u beklemez).
 *
 * Hata yayını bozmaz: `afterSafe` hatayı yalnız günlüğe yazar; defter yazımı zaten tamamlandı. Kaçan olay gece/2 saatlik
 * cron (`runEidsActionSweep`) ile yeniden işlenir; görev ve bildirim tekil anahtarları (`tasks.dedupe_key`,
 * `notifications.dedupe_key`) çift üretimi engeller.
 *
 * `db`: çağıranın service_role istemcisi (EP3 alıcısı). Verilmezse (oturumlu server action) service_role istemcisi burada
 * açılır; motor görev/bildirimi başka kullanıcılara yazdığından RLS'li oturum istemcisi yetmez. Kiracı ÇAĞIRANIN kapısından
 * (gate.tenantId / alma adresi) gelir ve olay okuması bu kiracıyla süzülür.
 */
export function scheduleAuthorityEventActions(tenantId: string, eventId: string | null | undefined, db?: SupabaseClient): void {
  if (!tenantId || !eventId) return;
  afterSafe(async () => {
    const client = db ?? createAdminClient();
    const r = await runAuthorityEventById(client, tenantId, eventId, now());
    if (r.status === "error") console.error("eids anlık aksiyon", { detail: r.detail ?? null });
  }, "eids anlık aksiyon");
}
