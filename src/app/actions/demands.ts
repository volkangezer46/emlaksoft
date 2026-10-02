"use server";

import { revalidatePath } from "next/cache";
import { revalidateTenantData } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { dispatchAutomationEvent } from "@/lib/automation-engine";
import { triggerPlaybooks } from "@/lib/playbook-trigger";
import { parseMoneyInput } from "@/lib/money-input";
import { isDemandStatus } from "@/lib/workflow-state";

export type DemandResult = { error?: string; ok?: boolean; id?: string };

function revalidateDemandPaths(tenantId: string, customerId: string) {
  revalidatePath("/app/talepler");
  revalidatePath("/app/eslestirme");
  revalidatePath(`/app/musteriler/${customerId}`);
  revalidatePath("/app/musteriler");
  revalidateTenantData(tenantId);
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
  const districtId = String(formData.get("district_id") ?? "").trim();
  const neighborhoodId = String(formData.get("neighborhood_id") ?? "").trim();
  const rooms = String(formData.get("rooms") ?? "").trim();
  const urgency = String(formData.get("urgency") ?? "").trim();
  const budgetMinResult = parseMoneyInput(formData.get("budget_min"), { allowZero: true, max: 100_000_000_000 });
  const budgetMaxResult = parseMoneyInput(formData.get("budget_max"), { allowZero: true, max: 100_000_000_000 });
  const minSqmRaw = String(formData.get("min_sqm") ?? "").trim();
  const minSqm = minSqmRaw ? Number(minSqmRaw.replace(",", ".")) : null;

  if (!customerId) return { error: "Müşteri bulunamadı." };
  if (!transactionType) return { error: "İşlem türü zorunlu." };
  if (!budgetMinResult.ok || !budgetMaxResult.ok) return { error: "Bütçe alanlarından biri geçersiz." };
  const budgetMin = budgetMinResult.value;
  const budgetMax = budgetMaxResult.value;
  if (minSqm != null && (!Number.isFinite(minSqm) || minSqm <= 0 || minSqm > 1_000_000)) {
    return { error: "Geçerli bir minimum metrekare girin." };
  }
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
      district_id: districtId || null,
      neighborhood_id: neighborhoodId || null,
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

  // Otomasyon tetikle — hata ana işlemi asla bozmasın
  try {
    await dispatchAutomationEvent(gate.tenantId, "new_demand", {
      entityType: "demand",
      entityId: data.id,
      customerId,
      assignedTo: gate.userId,
      fields: { transaction_type: transactionType, property_type: propertyType || null },
    });
  } catch (e) {
    console.error("automation new_demand", e);
  }

  // İş akışı (playbook) tetikle — çok adımlı görev paketi; hata ana işlemi bozmaz
  await triggerPlaybooks({
    tenantId: gate.tenantId,
    event: "talep_olusturuldu",
    actorId: gate.userId,
    entity: {
      type: "demand",
      id: data.id,
      ownerId: gate.userId,
      customerId,
      fields: { transaction_type: transactionType, property_type: propertyType || null },
    },
  });

  revalidateDemandPaths(gate.tenantId, customerId);
  return { ok: true, id: data.id };
}

export async function updateDemand(
  _prev: DemandResult,
  formData: FormData,
): Promise<DemandResult> {
  const gate = await requirePermission("demands", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  const transactionType = String(formData.get("transaction_type") ?? "").trim();
  const propertyType = String(formData.get("property_type") ?? "").trim();
  const provinceId = String(formData.get("province_id") ?? "").trim();
  const districtId = String(formData.get("district_id") ?? "").trim();
  const neighborhoodId = String(formData.get("neighborhood_id") ?? "").trim();
  const rooms = String(formData.get("rooms") ?? "").trim();
  const urgency = String(formData.get("urgency") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const budgetMinResult = parseMoneyInput(formData.get("budget_min"), { allowZero: true, max: 100_000_000_000 });
  const budgetMaxResult = parseMoneyInput(formData.get("budget_max"), { allowZero: true, max: 100_000_000_000 });
  const minSqmRaw = String(formData.get("min_sqm") ?? "").trim();
  const minSqm = minSqmRaw ? Number(minSqmRaw.replace(",", ".")) : null;

  if (!id) return { error: "Talep bulunamadı." };
  if (!transactionType) return { error: "İşlem türü zorunlu." };
  if (status && !isDemandStatus(status)) return { error: "Geçersiz talep durumu." };
  if (!budgetMinResult.ok || !budgetMaxResult.ok) return { error: "Bütçe alanlarından biri geçersiz." };
  const budgetMin = budgetMinResult.value;
  const budgetMax = budgetMaxResult.value;
  if (minSqm != null && (!Number.isFinite(minSqm) || minSqm <= 0 || minSqm > 1_000_000)) {
    return { error: "Geçerli bir minimum metrekare girin." };
  }
  if (budgetMin != null && budgetMax != null && budgetMin > budgetMax) {
    return { error: "Minimum bütçe, maksimumdan büyük olamaz." };
  }

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("customer_demands")
    .update({
      transaction_type: transactionType,
      property_type: propertyType || null,
      province_id: provinceId || null,
      district_id: districtId || null,
      neighborhood_id: neighborhoodId || null,
      budget_min: budgetMin,
      budget_max: budgetMax,
      rooms: rooms || null,
      min_sqm: minSqm != null && Number.isFinite(minSqm) ? minSqm : null,
      urgency: urgency || null,
      ...(status ? { status } : {}),
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id, customer_id")
    .maybeSingle();

  if (error) {
    console.error("updateDemand", error);
    return { error: "Talep güncellenemedi." };
  }
  if (!updated) return { error: "Talep bulunamadı veya başka bir ofise ait." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "demand.update",
    entityType: "customer_demand",
    entityId: id,
    newValue: { transaction_type: transactionType, status: status || undefined },
  });

  revalidateDemandPaths(gate.tenantId, updated.customer_id);
  return { ok: true, id };
}

export async function setDemandStatus(formData: FormData): Promise<DemandResult> {
  const gate = await requirePermission("demands", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!id || !isDemandStatus(status)) return { error: "Geçersiz durum." };

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("customer_demands")
    .update({ status })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id, customer_id")
    .maybeSingle();

  if (error) {
    console.error("setDemandStatus", error);
    return { error: "Durum güncellenemedi." };
  }
  if (!updated) return { error: "Talep bulunamadı veya başka bir ofise ait." };

  revalidateDemandPaths(gate.tenantId, updated.customer_id);
  return { ok: true, id };
}
