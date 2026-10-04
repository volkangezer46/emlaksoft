"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import { validateVitrinInput, isMissingColumnError, type VitrinSettings } from "@/lib/vitrin-settings-logic";

export type VitrinSettingsResult = { ok?: boolean; error?: string; settings?: VitrinSettings };

const UNAVAILABLE = "Vitrin ayarları bu ortamda henüz etkin değil (veritabanı güncellemesi bekleniyor).";

/**
 * Ofis vitrin ayarlarını kaydeder (tenants.vitrin_*). RLS'li kullanıcı client'ı: yalnız kendi ofisi.
 * Arama görünürlüğü onayı (vitrin_seo_optin) yalnız açıkça işaretlenirse açılır; kapalıyken sitemap'e girmez.
 */
export async function saveVitrinSettings(_prev: VitrinSettingsResult, formData: FormData): Promise<VitrinSettingsResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const v = validateVitrinInput({
    intro: formData.get("intro"),
    enabled: formData.get("enabled"),
    showPhone: formData.get("showCall"),
    showLeadForm: formData.get("showLeadForm"),
    showValuation: formData.get("showValuation"),
    seoOptin: formData.get("seoOptin"),
  });
  if (!v.ok) return { error: v.error };
  const s = v.settings;

  const supabase = await createClient();
  const { error } = await supabase
    .from("tenants")
    .update({
      vitrin_intro: s.intro,
      vitrin_enabled: s.enabled,
      vitrin_show_phone: s.showPhone,
      vitrin_show_lead_form: s.showLeadForm,
      vitrin_show_valuation: s.showValuation,
      vitrin_seo_optin: s.seoOptin,
      updated_at: new Date(now()).toISOString(),
    })
    .eq("id", gate.tenantId);
  if (error) {
    if (isMissingColumnError(error)) return { error: UNAVAILABLE };
    console.error("saveVitrinSettings", error);
    return { error: "Vitrin ayarları kaydedilemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "settings.vitrin_update",
    entityType: "tenant",
    entityId: gate.tenantId,
    newValue: { ...s, intro: s.intro ? "[var]" : null },
  });

  revalidatePath("/app/ayarlar/vitrin");
  revalidatePath("/app/ayarlar");
  revalidateTag("vitrin", "max");
  revalidateTag(`vitrin:${gate.tenantId}`, "max");
  revalidateTag("seo-sitemap", "max");
  return { ok: true, settings: s };
}
