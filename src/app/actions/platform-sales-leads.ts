"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { parsePhone, PHONE_ERROR_MESSAGE } from "@/lib/phone";

export type LeadResult = { ok?: boolean; error?: string };

type LeadFields = {
  full_name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  city: string | null;
  team_size: string | null;
  message: string | null;
};

/** Elle girilen aday: `requestDemo` ile aynı alan kuralları (telefon/e-posta doğrulaması, uzunluk sınırları). */
function parseLeadFields(formData: FormData): { fields: LeadFields } | { error: string } {
  const fullName = String(formData.get("full_name") ?? "").trim();
  if (!fullName) return { error: "Ad soyad zorunlu." };
  if (fullName.length > 120) return { error: "Ad soyad en fazla 120 karakter olabilir." };
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!rawPhone && !email) return { error: "Telefon veya e-posta girin." };
  let phone: string | null = null;
  if (rawPhone) {
    const parsed = parsePhone(rawPhone);
    if (!parsed.ok) return { error: parsed.error ?? PHONE_ERROR_MESSAGE };
    phone = parsed.stored;
  }
  if (email && !isValidEmail(email)) return { error: EMAIL_ERROR_MESSAGE };
  const company = String(formData.get("company") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const teamSize = String(formData.get("team_size") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  if (company.length > 160 || city.length > 100 || teamSize.length > 40 || message.length > 2000) {
    return { error: "Form alanlarından biri izin verilen uzunluğu aşıyor." };
  }
  return {
    fields: {
      full_name: fullName,
      phone,
      email: email || null,
      company: company || null,
      city: city || null,
      team_size: teamSize || null,
      message: message || null,
    },
  };
}

/** Telefonla/elle gelen adayı satış hunisine ekler (kaynak: admin_manual). */
export async function createDemoLead(formData: FormData): Promise<LeadResult> {
  const staff = await requirePlatformModule("sales");
  const rl = await checkRateLimit(`sales-lead:create:${staff.id}`, { limit: 40, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık kayıt eklediniz; birkaç dakika sonra tekrar deneyin." };
  const parsed = parseLeadFields(formData);
  if ("error" in parsed) return { error: parsed.error };

  const admin = createAdminClient();
  if (parsed.fields.phone) {
    const { data: dup } = await admin
      .from("demo_requests")
      .select("id, full_name")
      .eq("phone", parsed.fields.phone)
      .limit(1)
      .maybeSingle();
    if (dup) return { error: `Bu telefonla kayıtlı aday var: ${dup.full_name}. Önce onu düzenleyin.` };
  }
  const { data, error } = await admin
    .from("demo_requests")
    .insert({ ...parsed.fields, source: "admin_manual", assigned_to: staff.id })
    .select("id")
    .single();
  if (error) {
    console.error("createDemoLead", error.message);
    return { error: "Aday eklenemedi." };
  }
  await logPlatformActivity({ actorId: staff.id, action: "sales.lead.create", entityType: "demo", entityId: data.id, meta: { source: "admin_manual" } });
  revalidatePath("/admin/satis");
  revalidatePath("/admin");
  return { ok: true };
}

export async function updateDemoLead(formData: FormData): Promise<LeadResult> {
  const staff = await requirePlatformModule("sales");
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Kayıt bulunamadı." };
  const rl = await checkRateLimit(`sales-lead:update:${staff.id}`, { limit: 60, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık güncelleme yaptınız; birkaç dakika sonra tekrar deneyin." };
  const parsed = parseLeadFields(formData);
  if ("error" in parsed) return { error: parsed.error };

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("demo_requests")
    .update({ ...parsed.fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("updateDemoLead", error.message);
    return { error: "Aday güncellenemedi." };
  }
  if (!updated) return { error: "Kayıt bulunamadı." };
  await logPlatformActivity({ actorId: staff.id, action: "sales.lead.update", entityType: "demo", entityId: id });
  revalidatePath("/admin/satis");
  revalidatePath(`/admin/satis/${id}`);
  return { ok: true };
}

/** Spam/yanlış aday silme: yıkıcı, yalnız süper admin; ofise dönüştürülmüş kayıt silinmez. */
export async function deleteDemoLead(formData: FormData): Promise<LeadResult> {
  const staff = await requirePlatformModule("sales");
  if (staff.role !== "super_admin") return { error: "Aday silme yalnız süper admin tarafından yapılabilir." };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Kayıt bulunamadı." };
  const rl = await checkRateLimit(`sales-lead:delete:${staff.id}`, { limit: 30, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık silme yaptınız; birkaç dakika sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: row } = await admin.from("demo_requests").select("id, full_name, status, converted_tenant_id").eq("id", id).maybeSingle();
  if (!row) return { ok: true };
  if (row.converted_tenant_id) return { error: "Ofise dönüştürülmüş aday silinemez." };
  const { error } = await admin.from("demo_requests").delete().eq("id", id).is("converted_tenant_id", null);
  if (error) {
    console.error("deleteDemoLead", error.message);
    return { error: "Aday silinemedi." };
  }
  await logPlatformActivity({ actorId: staff.id, action: "sales.lead.delete", entityType: "demo", entityId: id, meta: { name: row.full_name, status: row.status } });
  revalidatePath("/admin/satis");
  revalidatePath("/admin");
  return { ok: true };
}
