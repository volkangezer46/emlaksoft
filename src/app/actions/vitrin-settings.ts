"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import { validateVitrinInput, isMissingColumnError, type VitrinSettings } from "@/lib/vitrin-settings-logic";
import { actionErrorMessage } from "@/lib/action-errors";

export type VitrinSettingsResult = { ok?: boolean; error?: string; settings?: VitrinSettings };

const UNAVAILABLE = "Vitrin ayarları bu ortamda henüz etkin değil (veritabanı güncellemesi bekleniyor).";
const SEO_META_UNAVAILABLE =
  "Arama başlığı ve açıklaması bu ortamda henüz etkin değil (veritabanı güncellemesi bekleniyor). Alanları boş bırakıp kaydedebilirsiniz.";

/**
 * Ofis vitrin ayarlarını kaydeder (tenants.vitrin_*). RLS'li kullanıcı client'ı: yalnız kendi ofisi.
 * Arama görünürlüğü onayı (vitrin_seo_optin) yalnız açıkça işaretlenirse açılır; kapalıyken sitemap'e girmez.
 * Elle SEO başlığı/açıklaması (vitrin_seo_title ≤70 / vitrin_seo_description ≤160) aynı doğrulamadan geçer; sütunları
 * yoksa (migration bekliyor) boş alanlarla kayıt yine yapılır, dolu alanlar açık hata alır.
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
    seoTitle: formData.get("seoTitle"),
    seoDescription: formData.get("seoDescription"),
  });
  if (!v.ok) return { error: v.error };
  const s = v.settings;

  const supabase = await createClient();
  const base = {
    vitrin_intro: s.intro,
    vitrin_enabled: s.enabled,
    vitrin_show_phone: s.showPhone,
    vitrin_show_lead_form: s.showLeadForm,
    vitrin_show_valuation: s.showValuation,
    vitrin_seo_optin: s.seoOptin,
    updated_at: new Date(now()).toISOString(),
  };
  let { error } = await supabase
    .from("tenants")
    .update({ ...base, vitrin_seo_title: s.seoTitle, vitrin_seo_description: s.seoDescription })
    .eq("id", gate.tenantId);
  // Elle SEO metni sütunları henüz yoksa: alanlar boşken temel ayarlar yine kaydedilir; doluysa açık hata.
  if (error && isMissingColumnError(error)) {
    if (s.seoTitle || s.seoDescription) return { error: SEO_META_UNAVAILABLE };
    ({ error } = await supabase.from("tenants").update(base).eq("id", gate.tenantId));
  }
  if (error) {
    if (isMissingColumnError(error)) return { error: UNAVAILABLE };
    console.error("saveVitrinSettings", error);
    return { error: actionErrorMessage(error, "Vitrin ayarları kaydedilemedi. Lütfen tekrar deneyin.") };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "settings.vitrin_update",
    entityType: "tenant",
    entityId: gate.tenantId,
    newValue: { ...s, intro: s.intro ? "[var]" : null, seoTitle: s.seoTitle ? "[var]" : null, seoDescription: s.seoDescription ? "[var]" : null },
  });

  revalidatePath("/app/ayarlar/vitrin");
  revalidatePath("/app/ayarlar");
  revalidateTag("vitrin", "max");
  revalidateTag(`vitrin:${gate.tenantId}`, "max");
  revalidateTag("seo-sitemap", "max");
  return { ok: true, settings: s };
}
