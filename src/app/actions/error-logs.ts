"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";

export type ErrorLogResult = { ok?: boolean; error?: string };

/**
 * Hata kaydını "çözüldü" işaretle.
 *
 * SİLMİYOR: Aynı hata tekrar ederse yeni bir satır açılıp yeniden görünmesi
 * gerekiyor — `logError` yalnızca `resolved_at IS NULL` satırları arıyor.
 * Silmek, geçmişi de yok eder; hangi hatanın ne zaman kapandığı denetim
 * açısından değerli.
 */
export async function resolveErrorLog(id: string): Promise<ErrorLogResult> {
  const staff = await requirePlatformModule("sistem");
  if (!staff) return { error: "Yetki yok." };
  if (!id) return { error: "Kayıt bulunamadı." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("error_logs")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { error: "İşaretlenemedi." };

  revalidatePath("/admin/hatalar");
  return { ok: true };
}
