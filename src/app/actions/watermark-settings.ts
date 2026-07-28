"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { sanitizeWatermarkSettings, type WatermarkSettings } from "@/lib/watermark";

export type WatermarkSettingsResult = {
  ok?: boolean;
  error?: string;
  settings?: WatermarkSettings;
};

/**
 * Ofisin filigran ayarını kaydeder (tenants.watermark_settings).
 *
 * Ayar YALNIZCA bundan sonra yüklenecek fotoğrafları etkiler; damgalama
 * istemcide yükleme anında yapıldığı için geçmiş görseller değişmez
 * (geriye dönük damgalama bilinçli olarak yok — bkz. dosya sonu notu).
 */
export async function saveWatermarkSettings(
  _prev: WatermarkSettingsResult,
  formData: FormData,
): Promise<WatermarkSettingsResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const settings = sanitizeWatermarkSettings({
    enabled: formData.get("enabled"),
    mode: formData.get("mode"),
    position: formData.get("position"),
    opacity: formData.get("opacity"),
    scale: formData.get("scale"),
    text: formData.get("text"),
    marginPct: formData.get("marginPct"),
  });

  const supabase = await createClient();
  const { error } = await supabase
    .from("tenants")
    .update({ watermark_settings: settings, updated_at: new Date().toISOString() })
    .eq("id", gate.tenantId);

  if (error) {
    console.error("saveWatermarkSettings", error);
    return { error: "Filigran ayarı kaydedilemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "settings.watermark_update",
    entityType: "tenant",
    entityId: gate.tenantId,
    newValue: settings,
  });

  revalidatePath("/app/ayarlar/filigran");
  revalidatePath("/app/ayarlar");
  return { ok: true, settings };
}
