"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";

export type DemandResult = { error?: string; ok?: boolean; id?: string };

function parseMoney(raw: FormDataEntryValue | null): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function revalidateDemandPaths(customerId: string) {
  revalidatePath("/app/talepler");
  revalidatePath("/app/eslestirme");
  revalidatePath(`/app/musteriler/${customerId}`);
  revalidatePath("/app/musteriler");
}

export async function createDemand(
  _prev: DemandResult,
  formData: FormData,
): Promise<DemandResult> {
  const gate = await requirePermission("demands", "create");
  if (!gate.ok) return { error: gate.error };

  const customerId = String(formData.get("customer_id") ?? "").trim();
  const transactionType = String(formData.get("transaction_type") ?? "").trim();
  const propertyType = String(formData.get("property_type") ?? "").trim();
  const provinceId = String(formData.get("province_id") ?? "").trim();
  const rooms = String(formData.get("rooms") ?? "").trim();
  const urgency = String(formData.get("urgency") ?? "").trim();
  const budgetMin = parseMoney(formData.get("budget_min"));
  const budgetMax = parseMoney(formData.get("budget_max"));
  const minSqmRaw = String(formData.get("min_sqm") ?? "").trim();
  const minSqm = minSqmRaw ? Number(minSqmRaw.replace(",", ".")) : null;

  if (!customerId) return { error: "Müşteri bulunamadı." };
  if (!transactionType) return { error: "İşlem türü zorunlu." };
  if (budgetMin != null && budgetMax != null && budgetMin > budgetMax) {
    return { error: "Minimum bütçe, maksimumdan büyük olamaz." };
  }

  const supabase = await createClient();

  const { data: customer } = await supabase
    .from("customers")
    .select("id, tenant_id")
    .eq("id", customerId)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!customer) return { error: "Müşteri bu ofise ait değil." };

  const { data, error } = await supabase
    .from("customer_demands")
    .insert({
      tenant_id: gate.tenantId,
      customer_id: customerId,
      transaction_type: transactionType,
      property_type: propertyType || null,
      province_id: provinceId || null,
      budget_min: budgetMin,
      budget_max: budgetMax,
      rooms: rooms || null,
      min_sqm: minSqm != null && Number.isFinite(minSqm) ? minSqm : null,
      urgency: urgency || null,
      status: "active",
    })
    .select("id")
    .single();

  if (error) {
    console.error("createDemand", error);
    return { error: "Talep kaydedilemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "demand.create",
    entityType: "customer_demand",
    entityId: data.id,
    newValue: { customer_id: customerId, transaction_type: transactionType },
  });

  revalidateDemandPaths(customerId);
  return { ok: true, id: data.id };
}

export async function updateDemand(
  _prev: DemandResult,
  formData: FormData,
): Promise<DemandResult> {
  const gate = await requirePermission("demands", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  const customerId = String(formData.get("customer_id") ?? "").trim();
  const transactionType = String(formData.get("transaction_type") ?? "").trim();
  const propertyType = String(formData.get("property_type") ?? "").trim();
  const provinceId = String(formData.get("province_id") ?? "").trim();
  const rooms = String(formData.get("rooms") ?? "").trim();
  const urgency = String(formData.get("urgency") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const budgetMin = parseMoney(formData.get("budget_min"));
  const budgetMax = parseMoney(formData.get("budget_max"));
  const minSqmRaw = String(formData.get("min_sqm") ?? "").trim();
  const minSqm = minSqmRaw ? Number(minSqmRaw.replace(",", ".")) : null;

  if (!id) return { error: "Talep bulunamadı." };
  if (!transactionType) return { error: "İşlem türü zorunlu." };
  if (budgetMin != null && budgetMax != null && budgetMin > budgetMax) {
    return { error: "Minimum bütçe, maksimumdan büyük olamaz." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("customer_demands")
    .update({
      transaction_type: transactionType,
      property_type: propertyType || null,
      province_id: provinceId || null,
      budget_min: budgetMin,
      budget_max: budgetMax,
      rooms: rooms || null,
      min_sqm: minSqm != null && Number.isFinite(minSqm) ? minSqm : null,
      urgency: urgency || null,
      ...(status ? { status } : {}),
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("updateDemand", error);
    return { error: "Talep güncellenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "demand.update",
    entityType: "customer_demand",
    entityId: id,
    newValue: { transaction_type: transactionType, status: status || undefined },
  });

  if (customerId) revalidateDemandPaths(customerId);
  else {
    revalidatePath("/app/talepler");
    revalidatePath("/app/eslestirme");
  }
  return { ok: true, id };
}

export async function setDemandStatus(formData: FormData): Promise<DemandResult> {
  const gate = await requirePermission("demands", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  const customerId = String(formData.get("customer_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const allowed = new Set(["new", "active", "matched", "closed"]);
  if (!id || !allowed.has(status)) return { error: "Geçersiz durum." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("customer_demands")
    .update({ status })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("setDemandStatus", error);
    return { error: "Durum güncellenemedi." };
  }

  if (customerId) revalidateDemandPaths(customerId);
  else {
    revalidatePath("/app/talepler");
    revalidatePath("/app/eslestirme");
  }
  return { ok: true, id };
}
