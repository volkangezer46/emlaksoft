"use server";

import { revalidatePath } from "next/cache";
import { daysFromNowIso } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { createClient } from "@/lib/supabase/server";
import { isMissingSchemaError } from "@/lib/insights/facts";
import { INSIGHT_DISMISS_REASONS, type InsightDismissReason } from "@/lib/insights/types";

export type PlatformInsightActionResult = { ok?: boolean; error?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETTABLE = ["seen", "snoozed", "dismissed"] as const;
type SettableState = (typeof SETTABLE)[number];

/**
 * Platform içgörüsünü görüldü / ertele / yoksay yapar. Yalnız personelin KENDİ satırı: kısıt veritabanındaki
 * `platform_insight_set_state` RPC'sindedir (auth.uid() + is_platform_staff); doğrudan tablo güncellemesi kapalıdır.
 */
export async function setPlatformInsightState(
  insightId: string,
  state: SettableState,
  opts?: { reason?: InsightDismissReason; snoozeDays?: number },
): Promise<PlatformInsightActionResult> {
  await requirePlatformModule("dashboard");
  if (!UUID.test(insightId)) return { error: "Geçersiz öneri." };
  if (!(SETTABLE as readonly string[]).includes(state)) return { error: "Geçersiz durum." };
  if (opts?.reason !== undefined && !(INSIGHT_DISMISS_REASONS as readonly string[]).includes(opts.reason)) {
    return { error: "Geçersiz yoksay nedeni." };
  }
  const snoozeDays = Math.min(30, Math.max(1, Math.trunc(opts?.snoozeDays ?? 1) || 1));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_insight_set_state", {
    p_id: insightId,
    p_state: state,
    p_reason: state === "dismissed" ? (opts?.reason ?? null) : null,
    p_snooze_until: state === "snoozed" ? daysFromNowIso(snoozeDays) : null,
  });
  if (error) {
    console.error("setPlatformInsightState", error.code);
    return {
      error: isMissingSchemaError(error)
        ? "Platform önerileri henüz etkin değil (veritabanı güncellemesi bekleniyor)."
        : "Öneri güncellenemedi. Lütfen tekrar deneyin.",
    };
  }
  if (data !== true) return { error: "Öneri bulunamadı ya da zaten kapatılmış." };
  revalidatePath("/admin");
  return { ok: true };
}
