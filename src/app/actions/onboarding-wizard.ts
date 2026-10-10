"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { AGENT_TITLE_MAX } from "@/lib/agent-profile";
import { revalidateTenantData } from "@/lib/revalidate";

export type OnboardingWizardResult = { ok?: boolean; error?: string };

/** Kurulum sihirbazı "Sen" adımı: kullanıcının KENDİ unvanı (profiles.title; yalnız kendi satırı). */
export async function saveOwnTitle(formData: FormData): Promise<OnboardingWizardResult> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return { error: gate.error };
  const title = String(formData.get("title") ?? "").trim().slice(0, AGENT_TITLE_MAX);
  if (!title) return { error: "Unvanını yaz (örn. Kurucu & Gayrimenkul Danışmanı)." };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ title }).eq("id", gate.userId).eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("saveOwnTitle", error);
    return { error: actionErrorMessage(error, "Unvan kaydedilemedi.") };
  }
  revalidatePath("/app/baslangic");
  revalidatePath("/app");
  return { ok: true };
}

/**
 * Kurulum sihirbazı "İlan havuzu" adımı: havuzu aç/kapat anahtarı. Yalnız `tenants.listing_pool_enabled` değişir;
 * mod, eşik ve SLA ayrıntıları İlan havuzu sayfasındaki ayar formundadır (kural satırı yoksa yarı otomatik varsayılan).
 * Yalnız ofis sahibi ve genel müdür (saveListingPoolSettings ile aynı kural).
 */
export async function setListingPoolEnabled(enabled: boolean): Promise<OnboardingWizardResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.role !== "owner" && gate.role !== "gm") return { error: "Havuz ayarını yalnız ofis sahibi ve genel müdür değiştirebilir." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenants")
    .update({ listing_pool_enabled: enabled === true })
    .eq("id", gate.tenantId)
    .select("id");
  if (error || !data?.length) {
    if (error) console.error("setListingPoolEnabled", { code: error.code });
    return { error: "Havuz ayarı kaydedilemedi (veritabanı güncellemesi henüz uygulanmamış olabilir)." };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "listing_pool.settings",
    entityType: "tenant",
    entityId: gate.tenantId,
    newValue: { enabled: enabled === true, by: "setup_wizard" },
  });
  revalidatePath("/app/baslangic");
  revalidatePath("/app/ilan-havuzu");
  revalidatePath("/app/portfoyler");
  revalidatePath("/app");
  revalidateTenantData(gate.tenantId);
  return { ok: true };
}
