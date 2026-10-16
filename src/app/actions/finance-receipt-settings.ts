"use server";

import { revalidateTenantData } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";

/**
 * Fiş okuma ayarları (Muhasebe > Ayarlar). Ana anahtar `ocr_enabled` (varsayılan KAPALI) tüm sunucu tarafı okumayı açar
 * (yerel katmanlar: karekod, XML, PDF metni, yerel OCR — dosya sunucudan çıkmaz). Yapay zekâ katmanı AYRI açık onaydır
 * (`ocr_ai_enabled`, varsayılan KAPALI); ana anahtar kapanınca o da kapanır. Yetki: `expenses:edit`.
 */

export type ReceiptSettingsResult = { ok: true } | { ok: false; error: string };

const PATHS = ["/app/giderler"] as const;

export async function saveReceiptReadingSettings(input: { enabled: boolean; aiEnabled: boolean }): Promise<ReceiptSettingsResult> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  if (typeof input?.enabled !== "boolean" || typeof input?.aiEnabled !== "boolean") return { ok: false, error: "Ayar okunamadı; sayfayı yenileyin." };
  const enabled = input.enabled;
  const aiEnabled = enabled && input.aiEnabled;

  const supabase = await createClient();
  const base = await supabase.rpc("finance_settings_save", { p: { ocr_enabled: enabled } });
  if (base.error) {
    const forbidden = base.error.code === "42501" || (base.error.message ?? "").includes("forbidden");
    return { ok: false, error: forbidden ? "Bu işlem için yetkiniz yok." : actionErrorMessage(base.error, "Fiş okuma ayarı kaydedilemedi.") };
  }
  const ai = await supabase.rpc("finance_settings_set_ocr_ai", { p_enabled: aiEnabled });
  if (ai.error && aiEnabled) return { ok: false, error: "Yapay zekâ seçeneği veritabanı güncellemesi uygulandıktan sonra açılabilir. Yerel okuma kaydedildi." };

  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "finance.receipt_reading.settings", entityType: "finance_settings", newValue: { ocr_enabled: enabled, ocr_ai_enabled: aiEnabled } });
  revalidateTenantData(gate.tenantId, PATHS);
  return { ok: true };
}
