"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import { PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { isOnboardingStepId } from "@/lib/onboarding-checklist";
import {
  parseSkipped,
  serializeSkipped,
  setupSkipCookieName,
  SETUP_COOKIE_MAX_AGE,
  toggleSkipped,
  welcomeDoneCookieName,
} from "@/lib/setup-skip";

export type OnboardingSetupResult = { error?: string; ok?: boolean };

/**
 * Kurulum sihirbazı — ofis bilgileri (ad, telefon, şehir, adres/ilçe, ruhsat no). Yalnız GÖNDERİLEN
 * mevcut tenants alanlarını günceller (gönderilmeyene dokunmaz); IBAN, vergi vb. ayarlar
 * sayfasındaki formda kalır. Ofis adı boş bırakılamaz ama gönderilmezse değişmez.
 */
export async function saveOfficeProfile(formData: FormData): Promise<OnboardingSetupResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40);
  const city = String(formData.get("city") ?? "").trim().slice(0, 80);
  const licenseNo = String(formData.get("license_no") ?? "").trim().slice(0, 60);
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const addressLine = String(formData.get("address_line") ?? "").trim().slice(0, 200);

  if (formData.has("name") && !name) return { error: "Ofis adı boş bırakılamaz." };
  if (!phone && !city && !licenseNo && !name && !addressLine) return { error: "En az bir alanı doldurun." };
  const parsedPhone = phone ? parsePhoneStrict(phone) : null;
  if (parsedPhone && !parsedPhone.ok) return { error: parsedPhone.error ?? PHONE_ERROR_MESSAGE };

  const patch: Record<string, string> = { updated_at: new Date(now()).toISOString() };
  if (parsedPhone?.ok) patch.phone = parsedPhone.stored;
  if (city) patch.city = city;
  if (licenseNo) patch.license_no = licenseNo;
  if (name) patch.name = name;
  if (addressLine) patch.address_line = addressLine;

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
    newValue: {
      name: name || null,
      phone: parsedPhone?.stored || null,
      city: city || null,
      license_no: licenseNo || null,
    },
  });

  revalidatePath("/app/baslangic");
  revalidatePath("/app/ayarlar");
  revalidatePath("/app");
  return { ok: true };
}

/**
 * "Sonra yaparım" tercihi — kullanıcıya özel çerez; veri/şema değişmez. Atlanan adım
 * tamamlanmış sayılmaz, yalnız "sıradaki" önerisinden ve ana ekran şeridinden çıkar.
 */
export async function setSetupStepSkipped(stepId: string, skip: boolean): Promise<OnboardingSetupResult> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return { error: gate.error };
  if (!isOnboardingStepId(stepId)) return { error: "Geçersiz adım." };
  const jar = await cookies();
  const name = setupSkipCookieName(gate.userId);
  const next = toggleSkipped(parseSkipped(jar.get(name)?.value), stepId, skip);
  jar.set(name, serializeSkipped(next), {
    path: "/app",
    maxAge: SETUP_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/app/baslangic");
  revalidatePath("/app");
  return { ok: true };
}

/** Yeni danışman "Hoş geldin" akışı bitti/kapatıldı: bir daha gösterilmez (kullanıcı çerezi). */
export async function completeWelcomeFlow(): Promise<OnboardingSetupResult> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return { error: gate.error };
  const jar = await cookies();
  jar.set(welcomeDoneCookieName(gate.userId), "1", {
    path: "/app",
    maxAge: SETUP_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  return { ok: true };
}

/** Hoş geldin akışı: danışmanın KENDİ telefon numarası (profiles.phone; yalnız kendi satırı). */
export async function saveOwnPhone(formData: FormData): Promise<OnboardingSetupResult> {
  const gate = await requirePermission("dashboard", "view");
  if (!gate.ok) return { error: gate.error };
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40);
  if (!phone) return { error: "Telefon numarası girin." };
  const parsed = parsePhoneStrict(phone);
  if (!parsed.ok) return { error: parsed.error ?? PHONE_ERROR_MESSAGE };
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ phone: parsed.stored })
    .eq("id", gate.userId)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("saveOwnPhone", error);
    return { error: "Telefon kaydedilemedi." };
  }
  revalidatePath("/app/hos-geldin");
  revalidatePath("/app/ekip");
  return { ok: true };
}
