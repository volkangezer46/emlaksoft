"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SettingsResult = { error?: string; ok?: boolean };

export async function updateTenantInfo(formData: FormData): Promise<SettingsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Oturum bulunamadı." };
  const tenantId = (user.app_metadata?.tenant_id as string | undefined) ?? null;
  if (!tenantId) return { error: "Ofis bilgisi bulunamadı." };

  const name        = String(formData.get("name")         ?? "").trim();
  const taxOffice   = String(formData.get("tax_office")   ?? "").trim();
  const taxNumber   = String(formData.get("tax_number")   ?? "").trim();
  const licenseNo   = String(formData.get("license_no")   ?? "").trim();
  const brandColor  = String(formData.get("brand_color")  ?? "").trim();
  const iban        = String(formData.get("iban")         ?? "").trim().replace(/\s/g, "");
  const phone       = String(formData.get("phone")        ?? "").trim();
  const addressLine = String(formData.get("address_line") ?? "").trim();
  const city        = String(formData.get("city")         ?? "").trim();
  const website     = String(formData.get("website")      ?? "").trim();

  if (!name) return { error: "Ofis adı zorunlu." };

  // IBAN format kontrolü — TR ile başlayan 26 karakter (opsiyonel)
  if (iban && !/^TR\d{24}$/i.test(iban)) {
    return { error: "IBAN formatı geçersiz. Örnek: TR330006100519786457841326" };
  }

  const { error } = await supabase
    .from("tenants")
    .update({
      name,
      tax_office:   taxOffice   || null,
      tax_number:   taxNumber   || null,
      license_no:   licenseNo   || null,
      brand_color:  brandColor  || null,
      iban:         iban        || null,
      phone:        phone       || null,
      address_line: addressLine || null,
      city:         city        || null,
      website:      website     || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tenantId);

  if (error) {
    console.error("updateTenantInfo", error);
    return { error: "Ofis bilgileri güncellenemedi." };
  }

  revalidatePath("/app/ayarlar");
  revalidatePath("/app");
  return { ok: true };
}
