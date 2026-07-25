"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { isValidOptionalTurkishMobile, normalizeTurkishPhone, TR_MOBILE_ERROR_MESSAGE } from "@/lib/phone";

export type CustomerResult = { error?: string; ok?: boolean; id?: string };

/** Boş ise geçerli; dolu ise ISO tarih (YYYY-MM-DD) formatını ve gerçek takvim gününü doğrular. */
function isValidOptionalDate(value: string): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export async function createCustomer(
  _prev: CustomerResult,
  formData: FormData,
): Promise<CustomerResult> {
  const gate = await requirePermission("customers", "create");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const tenantId = gate.tenantId;
  const user = { id: gate.userId };

  const fullName = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim();
  const provinceId = String(formData.get("province_id") ?? "").trim();
  const districtId = String(formData.get("district_id") ?? "").trim();
  const branchId = String(formData.get("branch_id") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const birthDate = String(formData.get("birth_date") ?? "").trim();
  const anniversaryDate = String(formData.get("anniversary_date") ?? "").trim();
  const anniversaryNote = String(formData.get("anniversary_note") ?? "").trim();

  if (!fullName) return { error: "Ad soyad zorunlu." };
  if (!isValidOptionalTurkishMobile(phone)) return { error: TR_MOBILE_ERROR_MESSAGE };
  if (!isValidOptionalDate(birthDate)) return { error: "Doğum tarihi geçersiz." };
  if (!isValidOptionalDate(anniversaryDate)) return { error: "Yıldönümü tarihi geçersiz." };
  const normalizedPhone = phone ? normalizeTurkishPhone(phone) : "";

  const { data, error } = await supabase
    .from("customers")
    .insert({
      tenant_id: tenantId,
      full_name: fullName,
      phone: normalizedPhone || null,
      email: email || null,
      customer_types: type ? [type] : [],
      province_id: provinceId || null,
      district_id: districtId || null,
      branch_id: branchId || null,
      notes: notes || null,
      birth_date: birthDate || null,
      anniversary_date: anniversaryDate || null,
      anniversary_note: anniversaryNote || null,
      assigned_to: user.id,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("createCustomer", error);
    return { error: "Müşteri eklenemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId,
    actorId: gate.userId,
    action: "customer.create",
    entityType: "customer",
    entityId: data.id,
    newValue: { full_name: fullName },
  });

  revalidatePath("/app/musteriler");
  return { ok: true, id: data.id };
}

export async function updateCustomer(
  _prev: CustomerResult,
  formData: FormData,
): Promise<CustomerResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim();
  const provinceId = String(formData.get("province_id") ?? "").trim();
  const districtId = String(formData.get("district_id") ?? "").trim();
  const branchId = String(formData.get("branch_id") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const birthDate = String(formData.get("birth_date") ?? "").trim();
  const anniversaryDate = String(formData.get("anniversary_date") ?? "").trim();
  const anniversaryNote = String(formData.get("anniversary_note") ?? "").trim();

  if (!id) return { error: "Müşteri bulunamadı." };
  if (!fullName) return { error: "Ad soyad zorunlu." };
  if (!isValidOptionalTurkishMobile(phone)) return { error: TR_MOBILE_ERROR_MESSAGE };
  if (!isValidOptionalDate(birthDate)) return { error: "Doğum tarihi geçersiz." };
  if (!isValidOptionalDate(anniversaryDate)) return { error: "Yıldönümü tarihi geçersiz." };
  const normalizedPhone = phone ? normalizeTurkishPhone(phone) : "";

  const supabase = await createClient();
  const updatePatch: Record<string, unknown> = {
    full_name: fullName,
    phone: normalizedPhone || null,
    email: email || null,
    customer_types: type ? [type] : [],
    province_id: provinceId || null,
    district_id: districtId || null,
    notes: notes || null,
    birth_date: birthDate || null,
    anniversary_date: anniversaryDate || null,
    anniversary_note: anniversaryNote || null,
  };
  if (formData.has("branch_id")) updatePatch.branch_id = branchId || null;

  const { error } = await supabase
    .from("customers")
    .update(updatePatch)
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("updateCustomer", error);
    return { error: "Müşteri güncellenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.update",
    entityType: "customer",
    entityId: id,
    newValue: { full_name: fullName },
  });

  revalidatePath("/app/musteriler");
  revalidatePath(`/app/musteriler/${id}`);
  return { ok: true, id };
}

export async function deleteCustomer(formData: FormData): Promise<void> {
  const gate = await requirePermission("customers", "delete");
  if (!gate.ok) return;
  const id = String(formData.get("id") ?? "");
  const redirectTo = String(formData.get("redirect_to") ?? "").trim();
  if (!id) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("deleteCustomer", error);
    return;
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.delete",
    entityType: "customer",
    entityId: id,
  });
  revalidatePath("/app/musteriler");
  if (redirectTo) redirect(redirectTo);
}

/** Danışman (assigned_to) yeniden atama — ekip yönetimi ve devir için. */
export async function reassignCustomer(formData: FormData): Promise<void> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return;
  const id = String(formData.get("id") ?? "").trim();
  const assignedTo = String(formData.get("assigned_to") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ assigned_to: assignedTo || null })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("reassignCustomer", error);
    return;
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.reassign",
    entityType: "customer",
    entityId: id,
    newValue: { assigned_to: assignedTo || null },
  });
  revalidatePath("/app/musteriler");
  revalidatePath(`/app/musteriler/${id}`);
}
