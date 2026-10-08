import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getPlanSupport } from "@/lib/billing/plan-support";
import { isPauseEnabled } from "@/lib/billing/plan-change";
import { PAUSE_BLOCK_MESSAGE, isPausedWriteBlocked } from "@/lib/billing/pause-core";

/**
 * DURAKLATILMIŞ ABONELİKTE SALT-OKUNUR KAPI (yetki kapısı `requirePermission` içinden TEK yerden çağrılır).
 *
 * Duraklatılmış ofiste (subscriptions.pause_started_at dolu) yazma eylemleri (create/edit/delete) reddedilir;
 * okuma ve abonelik/ödeme modülü (devam ettirmek için) serbesttir. Şema hazır değilse (pauseReady=false) HİÇ sorgu
 * atılmaz. Okuma belirsizse (hata) kapı AÇIK kalır: abonelik durumu okunamadı diye tüm ofisin yazması kilitlenmez.
 * Sınır: bu kapı sunucu action'larını korur; tarayıcıdan doğrudan PostgREST yazımı (RLS) bu migration'da kısıtlanmaz.
 */
const isTenantPaused = cache(async (tenantId: string): Promise<boolean> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("subscriptions")
      .select("pause_started_at")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error || !data) return false;
    return Boolean((data as { pause_started_at?: string | null }).pause_started_at);
  } catch (e) {
    console.error("pausedWriteBlock", e instanceof Error ? e.message : "hata");
    return false;
  }
});

/** Duraklatma yüzünden engellenmesi gereken yazma eylemi için hata metni; serbestse null. */
export async function pausedWriteBlock(tenantId: string, mod: string, action: string): Promise<string | null> {
  // Okuma ve abonelik/ödeme modülü: DB'ye hiç gidilmez.
  if (!isPausedWriteBlocked(true, mod, action)) return null;
  try {
    // Hız: duraklatma kapalıyken (varsayılan) her yazma eyleminde abonelik sorgusu atılmaz (bayrak önbellekli okunur).
    // Bayrak sonradan kapatılırsa duraklatılmış ofislerin yazması açılır; cron süresi dolanı zaten devam ettirir.
    if (!(await isPauseEnabled())) return null;
    if (!(await getPlanSupport()).pauseReady) return null;
  } catch {
    return null;
  }
  return (await isTenantPaused(tenantId)) ? PAUSE_BLOCK_MESSAGE : null;
}
