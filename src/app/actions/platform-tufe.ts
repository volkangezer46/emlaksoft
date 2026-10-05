"use server";

import { revalidatePath } from "next/cache";
import { guardPlatformAction } from "@/lib/platform-guards";
import { logPlatformActivity } from "@/lib/platform-activity";
import { setPlatformSetting } from "@/lib/platform-settings";
import { TUFE_SETTING_KEY, serializeTufeTable, validateTufeTable } from "@/lib/tufe";
import { loadTufeTable } from "@/lib/tufe-server";

export type TufeSaveResult = { ok?: boolean; error?: string };

/**
 * TÜFE tablosunu kaydeder (platform_settings 'tufe.table'). YALNIZ süper admin; yazma hız sınırlıdır.
 * Girdi: JSON metni `table` alanında ({ entries: { "YYYY-MM": { rate, official } }, verifiedAt, source }).
 * Resmi işaretli satır varsa doğrulama tarihi + kaynak zorunludur. Eski/yeni tablo denetim kaydına yazılır.
 */
export async function saveTufeTable(fd: FormData): Promise<TufeSaveResult> {
  const gate = await guardPlatformAction({
    module: "sistem",
    roles: ["super_admin"],
    rate: { key: "platform-tufe", limit: 10, windowSec: 600 },
  });
  if ("error" in gate) return { error: gate.error };

  let parsed: { entries?: Record<string, { rate: unknown; official: unknown }>; verifiedAt?: unknown; source?: unknown };
  try {
    parsed = JSON.parse(String(fd.get("table") ?? ""));
  } catch {
    return { error: "Tablo okunamadı. Sayfayı yenileyip tekrar deneyin." };
  }
  const v = validateTufeTable({ entries: parsed.entries ?? {}, verifiedAt: parsed.verifiedAt, source: parsed.source });
  if (!v.ok) return { error: v.error };

  const before = await loadTufeTable();
  const ok = await setPlatformSetting(TUFE_SETTING_KEY, serializeTufeTable(v.table), gate.staff.id);
  if (!ok) return { error: "TÜFE tablosu kaydedilemedi. Lütfen tekrar deneyin." };

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "platform_settings.tufe_update",
    entityType: "platform_settings",
    meta: {
      beforeMonths: Object.keys(before.entries).length,
      afterMonths: Object.keys(v.table.entries).length,
      officialMonths: Object.values(v.table.entries).filter((e) => e.official).length,
      verifiedAt: v.table.verifiedAt,
      source: v.table.source,
    },
  });

  revalidatePath("/admin/ayarlar/tufe");
  revalidatePath("/app/kira-artis");
  return { ok: true };
}
