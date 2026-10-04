"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { setPlatformSetting } from "@/lib/platform-settings";
import { AI_COST_TABLE_SETTING_KEY, parseCostTable, serializeCostTable } from "@/lib/ai/credits/cost";
import { resetMeterCaches } from "@/lib/ai/credits/meter";

/** AI maliyet tablosunu (model/jeton -> kredi) platform ayarına yazar. Boş gönderim = varsayılana dön. */
export async function saveAiCostTable(formData: FormData): Promise<void> {
  const staff = await requirePlatformModule("billing");
  const raw = String(formData.get("table") ?? "").trim();

  let value: string | null = null;
  if (raw) {
    try {
      JSON.parse(raw);
    } catch {
      redirect("/admin/ai-kullanim?hata=json");
    }
    value = serializeCostTable(parseCostTable(raw));
  }

  const ok = await setPlatformSetting(AI_COST_TABLE_SETTING_KEY, value, staff.id);
  if (!ok) redirect("/admin/ai-kullanim?hata=kayit");
  resetMeterCaches();
  await logPlatformActivity({
    actorId: staff.id,
    action: "ai_credits.cost_table_update",
    entityType: "platform_setting",
    meta: { reset: value === null },
  });
  revalidatePath("/admin/ai-kullanim");
  redirect("/admin/ai-kullanim?kaydedildi=1");
}
