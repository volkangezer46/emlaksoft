"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import { parsePhone, PHONE_ERROR_MESSAGE } from "@/lib/phone";

export type OnboardingSetupResult = { error?: string; ok?: boolean };

/**
 * Kurulum sihirbazı — ofis profili (telefon, şehir, ruhsat no). Yalnız bu üç mevcut
 * tenants alanını günceller; ofis adı, IBAN vb. ayarlar sayfasındaki formda kalır.
 */
export async function saveOfficeProfile(formData: FormData): Promise<OnboardingSetupResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40);
  const city = String(formData.get("city") ?? "").trim().slice(0, 80);
  const licenseNo = String(formData.get("license_no") ?? "").trim().slice(0, 60);

  if (!phone && !city && !licenseNo) return { error: "En az bir alanı doldurun." };
  const parsedPhone = phone ? parsePhone(phone) : null;
  if (parsedPhone && !parsedPhone.ok) return { error: parsedPhone.error ?? PHONE_ERROR_MESSAGE };

  const patch: Record<string, string> = { updated_at: new Date(now()).toISOString() };
  if (parsedPhone?.ok) patch.phone = parsedPhone.stored;
  if (city) patch.city = city;
  if (licenseNo) patch.license_no = licenseNo;

  const supabase = await createClient();
  const { error } = await supabase.from("tenants").update(patch).eq("id", gate.tenantId);
  if (error) {
    console.error("saveOfficeProfile", error);
    return { error: "Ofis profili kaydedilemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "settings.update",
    entityType: "tenant",
    entityId: gate.tenantId,
    newValue: { phone: parsedPhone?.stored || null, city: city || null, license_no: licenseNo || null },
  });

  revalidatePath("/app/baslangic");
  revalidatePath("/app/ayarlar");
  return { ok: true };
}
