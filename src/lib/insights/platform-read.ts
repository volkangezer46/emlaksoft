import "server-only";
import { now } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { createClient } from "@/lib/supabase/server";
import { PLATFORM_INSIGHT_SELECT, selectPlatformReadable, type PlatformInsight, type PlatformInsightDbRow } from "@/lib/insights/platform-readable";

/**
 * PLATFORM İÇGÖRÜ OKUYUCUSU (/admin ana ekran "Dikkat gerektirenler").
 *
 * - Kapı: `requirePlatformModule("dashboard")` (personel değilse yönlendirir; try/catch DIŞINDA, redirect yutulmaz).
 * - RLS'li oturum istemcisi (admin client YOK): politika `staff_id = auth.uid() AND is_platform_staff()`;
 *   ayrıca `staff_id = staff.id` ile daraltılır. tenant_id/entity_id seçilmez.
 * - Hata / tablo yok (migration uygulanmadı) / veri yok -> BOŞ DİZİ. Asla fırlatmaz, asla içgörü uydurmaz.
 */
export async function getPlatformInsights(opts?: { limit?: number }): Promise<PlatformInsight[]> {
  const staff = await requirePlatformModule("dashboard");
  try {
    const limit = Math.min(20, Math.max(1, Math.trunc(opts?.limit ?? 5) || 5));
    const supabase = await createClient();
    const nowMs = now();
    const { data, error } = await supabase
      .from("platform_insights")
      .select(PLATFORM_INSIGHT_SELECT)
      .eq("staff_id", staff.id)
      .in("state", ["new", "seen", "snoozed"])
      .gt("valid_until", new Date(nowMs).toISOString())
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(Math.min(100, limit * 6));
    if (error || !data) return [];
    return selectPlatformReadable(data as PlatformInsightDbRow[], nowMs, staff.role, limit);
  } catch {
    return [];
  }
}
