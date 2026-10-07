"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { actionErrorMessage } from "@/lib/action-errors";

export type ErrorLogResult = { ok?: boolean; error?: string; count?: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BULK_LIMIT = 100;

function refresh() {
  revalidatePath("/admin/hatalar");
  revalidatePath("/admin/sistem");
}

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
  if (!id || !UUID_RE.test(id)) return { error: "Kayıt bulunamadı." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("error_logs")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { error: "İşaretlenemedi." };

  await logPlatformActivity({
    actorId: staff.id,
    action: "error_log.resolve",
    entityType: "error_log",
    entityId: id,
  });
  refresh();
  return { ok: true };
}

/** Çözüldü işaretini geri al: kayıt yeniden açık listesine düşer. */
export async function reopenErrorLog(id: string): Promise<ErrorLogResult> {
  const staff = await requirePlatformModule("sistem");
  if (!id || !UUID_RE.test(id)) return { error: "Kayıt bulunamadı." };

  const admin = createAdminClient();
  const { error } = await admin.from("error_logs").update({ resolved_at: null }).eq("id", id);
  if (error) return { error: actionErrorMessage(error, "Yeniden açılamadı.") };

  await logPlatformActivity({
    actorId: staff.id,
    action: "error_log.reopen",
    entityType: "error_log",
    entityId: id,
  });
  refresh();
  return { ok: true };
}

/** Seçili açık hataları toplu "çözüldü" yap (en çok 100). */
export async function resolveErrorLogs(ids: string[]): Promise<ErrorLogResult> {
  const staff = await requirePlatformModule("sistem");
  const clean = [...new Set((ids ?? []).filter((v) => typeof v === "string" && UUID_RE.test(v)))];
  if (clean.length === 0) return { error: "Hata seçilmedi." };
  if (clean.length > BULK_LIMIT) return { error: `Tek seferde en fazla ${BULK_LIMIT} kayıt işlenebilir.` };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("error_logs")
    .update({ resolved_at: new Date().toISOString() })
    .in("id", clean)
    .is("resolved_at", null)
    .select("id");
  if (error) return { error: actionErrorMessage(error, "Toplu işlem başarısız.") };

  const count = data?.length ?? 0;
  await logPlatformActivity({
    actorId: staff.id,
    action: "error_log.bulk_resolve",
    entityType: "error_log",
    meta: { count },
  });
  refresh();
  return { ok: true, count };
}
