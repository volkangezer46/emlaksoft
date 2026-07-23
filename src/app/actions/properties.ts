"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { computePriceHealth } from "@/lib/price-health";

export type PropertyResult = { error?: string; ok?: boolean };

const STATUSES = ["draft", "live", "reserved", "sold", "rented", "archived"];

export async function createProperty(formData: FormData): Promise<PropertyResult> {
  const gate = await requirePermission("properties", "create");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const title = String(formData.get("title") ?? "").trim();
  const transactionType = String(formData.get("transaction_type") ?? "").trim();
  const propertyType = String(formData.get("property_type") ?? "").trim();
  const provinceId = String(formData.get("province_id") ?? "").trim();
  const branchId = String(formData.get("branch_id") ?? "").trim();
  const addressLine = String(formData.get("address_line") ?? "").trim();
  const rooms = String(formData.get("rooms") ?? "").trim();
  const sqmValue = Number(String(formData.get("sqm") ?? "").replace(",", "."));
  const rawPrice = String(formData.get("list_price") ?? "").replace(/[^\d.,]/g, "");
  const priceValue = Number(rawPrice.replace(/\./g, "").replace(",", "."));
  const commissionValue = Number(String(formData.get("commission_rate") ?? "").replace(",", "."));

  if (!title || !transactionType || !propertyType) {
    return { error: "Başlık, işlem türü ve portföy türü zorunlu." };
  }
  if (!Number.isFinite(priceValue) || priceValue <= 0) {
    return { error: "Geçerli bir liste fiyatı girin." };
  }

  const stamp = new Date().toISOString().slice(2, 7).replace("-", "");
  const suffix = crypto.randomUUID().slice(0, 6).toUpperCase();
  const propertyCode = `ES-${stamp}-${suffix}`;

  let districtHint: string | null = null;
  if (provinceId) {
    const { data: prov } = await supabase.from("geo_provinces").select("name").eq("id", provinceId).maybeSingle();
    districtHint = prov?.name ?? null;
  }
  const health = computePriceHealth({
    listPrice: priceValue,
    sqm: Number.isFinite(sqmValue) ? sqmValue : null,
    districtHint,
  });

  const { data, error } = await supabase
    .from("properties")
    .insert({
      tenant_id: gate.tenantId,
      property_code: propertyCode,
      title,
      transaction_type: transactionType,
      property_type: propertyType,
      status: "draft",
      list_price: priceValue,
      commission_rate: Number.isFinite(commissionValue) ? commissionValue : null,
      province_id: provinceId || null,
      branch_id: branchId || null,
      address_line: addressLine || null,
      features: {
        rooms: rooms || null,
        sqm: Number.isFinite(sqmValue) ? sqmValue : null,
      },
      price_health: health.health,
      assigned_to: gate.userId,
      created_by: gate.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createProperty", error);
    return { error: "Portföy eklenemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.create",
    entityType: "property",
    entityId: data.id,
    newValue: { property_code: propertyCode, title },
  });

  revalidatePath("/app/portfoyler");
  revalidatePath(`/app/portfoyler/${data.id}`);
  revalidatePath("/app");
  return { ok: true };
}

export async function updateProperty(formData: FormData): Promise<PropertyResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Portföy bulunamadı." };

  const title = String(formData.get("title") ?? "").trim();
  const transactionType = String(formData.get("transaction_type") ?? "").trim();
  const propertyType = String(formData.get("property_type") ?? "").trim();
  const provinceId = String(formData.get("province_id") ?? "").trim();
  const branchId = String(formData.get("branch_id") ?? "").trim();
  const hasBranch = formData.has("branch_id");
  const addressLine = String(formData.get("address_line") ?? "").trim();
  const rooms = String(formData.get("rooms") ?? "").trim();
  const sqmValue = Number(String(formData.get("sqm") ?? "").replace(",", "."));
  const rawPrice = String(formData.get("list_price") ?? "").replace(/[^\d.,]/g, "");
  const priceValue = Number(rawPrice.replace(/\./g, "").replace(",", "."));
  const commissionValue = Number(String(formData.get("commission_rate") ?? "").replace(",", "."));
  const minRaw = String(formData.get("min_price") ?? "").replace(/[^\d.,]/g, "");
  const minValue = minRaw ? Number(minRaw.replace(/\./g, "").replace(",", ".")) : null;

  if (!title || !transactionType || !propertyType) {
    return { error: "Başlık, işlem türü ve portföy türü zorunlu." };
  }
  if (!Number.isFinite(priceValue) || priceValue <= 0) {
    return { error: "Geçerli bir liste fiyatı girin." };
  }

  const supabase = await createClient();
  let districtHint: string | null = null;
  if (provinceId) {
    const { data: prov } = await supabase.from("geo_provinces").select("name").eq("id", provinceId).maybeSingle();
    districtHint = prov?.name ?? null;
  }
  const health = computePriceHealth({
    listPrice: priceValue,
    sqm: Number.isFinite(sqmValue) ? sqmValue : null,
    districtHint,
  });

  const updatePatch: Record<string, unknown> = {
    title,
    transaction_type: transactionType,
    property_type: propertyType,
    list_price: priceValue,
    min_price: minValue != null && Number.isFinite(minValue) ? minValue : null,
    commission_rate: Number.isFinite(commissionValue) ? commissionValue : null,
    province_id: provinceId || null,
    address_line: addressLine || null,
    features: {
      rooms: rooms || null,
      sqm: Number.isFinite(sqmValue) ? sqmValue : null,
    },
    price_health: health.health,
    updated_at: new Date().toISOString(),
  };
  if (hasBranch) updatePatch.branch_id = branchId || null;

  const { error } = await supabase
    .from("properties")
    .update(updatePatch)
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("updateProperty", error);
    return { error: "Portföy güncellenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.update",
    entityType: "property",
    entityId: id,
    newValue: { title, list_price: priceValue },
  });

  revalidatePath("/app/portfoyler");
  revalidatePath(`/app/portfoyler/${id}`);
  revalidatePath("/app");
  return { ok: true };
}

export async function setPropertyStatus(formData: FormData): Promise<void> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return;

  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!id || !STATUSES.includes(status)) return;

  const supabase = await createClient();
  await supabase
    .from("properties")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.status",
    entityType: "property",
    entityId: id,
    newValue: { status },
  });

  revalidatePath("/app/portfoyler");
  revalidatePath(`/app/portfoyler/${id}`);
  revalidatePath("/app");
}

export async function deleteProperty(formData: FormData): Promise<void> {
  const gate = await requirePermission("properties", "delete");
  if (!gate.ok) return;
  const id = String(formData.get("id") ?? "").trim();
  const redirectTo = String(formData.get("redirect_to") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("properties")
    .update({ deleted_at: new Date().toISOString(), status: "archived", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("deleteProperty", error);
    return;
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.delete",
    entityType: "property",
    entityId: id,
  });
  revalidatePath("/app/portfoyler");
  revalidatePath("/app");
  if (redirectTo) redirect(redirectTo);
}

/** Danışman (assigned_to) yeniden atama. */
export async function reassignProperty(formData: FormData): Promise<void> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return;
  const id = String(formData.get("id") ?? "").trim();
  const assignedTo = String(formData.get("assigned_to") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("properties")
    .update({ assigned_to: assignedTo || null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("reassignProperty", error);
    return;
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.reassign",
    entityType: "property",
    entityId: id,
    newValue: { assigned_to: assignedTo || null },
  });
  revalidatePath("/app/portfoyler");
  revalidatePath(`/app/portfoyler/${id}`);
}
