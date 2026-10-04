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
import {
  DEMAND_FIELD_NAMES,
  demandValuesFromFormData,
  parseDemandCriteria,
  parseDemandValues,
  type DemandCriteria,
} from "@/lib/demand-criteria";
import { pruneRequiredKeys, validateGeoChain } from "@/lib/demand-geo";
import { findSimilarOpenDemands } from "@/lib/duplicate-finders";

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
  if (!customerId) return { error: "Müşteri bulunamadı." };

  // Doğrulama ortak (müşteri formu, talep formu ve canlı önizleme aynı parse'ı kullanır).
  const parsed = parseDemandValues(demandValuesFromFormData(formData));
  if (!parsed.ok) return { error: parsed.error };
  const { columns, criteria } = parsed;
  const transactionType = columns.transaction_type;
  const propertyType = columns.property_type ?? "";

  const supabase = await createClient();

  const geoError = await validateGeoChain(supabase, {
    province_id: columns.province_id,
    district_id: columns.district_id,
    neighborhood_id: columns.neighborhood_id,
  });
  if (geoError) return { error: geoError };

  const { data: customer } = await supabase
    .from("customers")
    .select("id, tenant_id")
    .eq("id", customerId)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!customer) return { error: "Müşteri bu ofise ait değil." };

  // Giriş anı mükerrer kontrolü: aynı müşterinin benzer açık talebi varsa kasıtlı onay (allow_duplicate=1) gerekir.
  if (String(formData.get("allow_duplicate") ?? "") !== "1") {
    const dups = await findSimilarOpenDemands(
      supabase,
      {
        tenantId: gate.tenantId,
        customerId,
        transactionType,
        propertyType,
        districtId: columns.district_id ?? "",
      },
      { userId: gate.userId, officeWide: false },
    );
    if (dups.length > 0) {
      return {
        error:
          "Bu müşterinin benzer bir açık talebi var. Formdaki uyarıyı inceleyin; yine de yeni talep açmak için \"Yine de yeni talep\" seçin.",
      };
    }
  }

  const { data, error } = await supabase
    .from("customer_demands")
    .insert({
      tenant_id: gate.tenantId,
      customer_id: customerId,
      ...columns,
      criteria,
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

  // Mevcut kayıt: gönderilmeyen alanlar (bölge, kriterler) SİLİNMEZ, olduğu gibi korunur (B13).
  const { data: existing } = await supabase
    .from("customer_demands")
    .select("id, province_id, district_id, neighborhood_id, criteria")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!existing) return { error: "Talep bulunamadı veya başka bir ofise ait." };

  const posted = (...names: string[]) => names.find((n) => formData.has(n));
  const pick = (current: string | null, ...names: string[]) => {
    const name = posted(...names);
    return name ? String(formData.get(name) ?? "").trim() || null : current;
  };
  const geo = {
    province_id: pick(existing.province_id, "demand_province_id", "province_id") ?? (provinceId || null),
    district_id: pick(existing.district_id, "demand_district_id", "district_id") ?? (districtId || null),
    neighborhood_id: pick(existing.neighborhood_id, "demand_neighborhood_id", "neighborhood_id") ?? (neighborhoodId || null),
  };
  // il/ilçe/mahalle gerçek hiyerarşiye uymalı (yalnız biçim değil)
  const geoChanged =
    geo.province_id !== existing.province_id ||
    geo.district_id !== existing.district_id ||
    geo.neighborhood_id !== existing.neighborhood_id;
  if (geoChanged) {
    const geoError = await validateGeoChain(supabase, geo);
    if (geoError) return { error: geoError };
  }

  // Kriter alanları (ek bölge, kat, ısıtma, olmazsa olmaz...) gönderildiyse tam parse; aksi halde mevcut
  // kriterler korunur ve değeri kalmayan "zorunlu" anahtarlar düşürülür.
  const criteriaOnly = DEMAND_FIELD_NAMES.filter(
    (n) => !["transaction_type", "property_type", "urgency", "budget_min", "budget_max", "rooms", "min_sqm"].includes(n),
  );
  const criteriaPosted = criteriaOnly.some((n) => formData.has(n));
  let criteriaUpdate: DemandCriteria | undefined;
  let columnOverride: Record<string, unknown> | undefined;
  if (criteriaPosted) {
    const values = demandValuesFromFormData(formData);
    values.demand_province_id = geo.province_id ?? "";
    values.demand_district_id = geo.district_id ?? "";
    values.demand_neighborhood_id = geo.neighborhood_id ?? "";
    const parsed = parseDemandValues(values);
    if (!parsed.ok) return { error: parsed.error };
    const { transaction_type: _t, ...cols } = parsed.columns;
    void _t;
    columnOverride = cols;
    criteriaUpdate = parsed.criteria;
  } else {
    criteriaUpdate = pruneRequiredKeys(parseDemandCriteria(existing.criteria), {
      property_type: propertyType || null,
      budget_min: budgetMin,
      budget_max: budgetMax,
      rooms: rooms || null,
      min_sqm: minSqm != null && Number.isFinite(minSqm) ? minSqm : null,
      ...geo,
    });
  }

  const { data: updated, error } = await supabase
    .from("customer_demands")
    .update({
      transaction_type: transactionType,
      property_type: propertyType || null,
      province_id: geo.province_id,
      district_id: geo.district_id,
      neighborhood_id: geo.neighborhood_id,
      budget_min: budgetMin,
      budget_max: budgetMax,
      rooms: rooms || null,
      min_sqm: minSqm != null && Number.isFinite(minSqm) ? minSqm : null,
      urgency: urgency || null,
      ...columnOverride,
      criteria: criteriaUpdate,
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

const DEMAND_BULK_LIMIT = 200;

/** Seçili talepleri tek durumda toplar (ör. kapat / aktif yap). Yalnız aynı ofisin talepleri güncellenir. */
export async function bulkSetDemandStatus(ids: string[], status: string): Promise<DemandResult & { updatedCount?: number }> {
  const gate = await requirePermission("demands", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isDemandStatus(status)) return { error: "Geçersiz durum." };
  const list = [...new Set((ids ?? []).map((i) => String(i).trim()).filter(Boolean))];
  if (list.length === 0) return { error: "Talep seçilmedi." };
  if (list.length > DEMAND_BULK_LIMIT) return { error: `Tek seferde en fazla ${DEMAND_BULK_LIMIT} talep güncellenebilir.` };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_demands")
    .update({ status })
    .in("id", list)
    .eq("tenant_id", gate.tenantId)
    .select("id, customer_id");
  if (error) {
    console.error("bulkSetDemandStatus", error);
    return { error: "Talepler güncellenemedi." };
  }
  const rows = data ?? [];
  if (rows.length === 0) return { error: "Güncellenecek talep bulunamadı." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "demand.bulk_status",
    entityType: "demand",
    newValue: { ids: rows.map((r) => r.id), status, count: rows.length },
  });
  revalidatePath("/app/talepler");
  revalidatePath("/app/eslestirme");
  revalidatePath("/app/musteriler");
  for (const cid of new Set(rows.map((r) => r.customer_id))) revalidatePath(`/app/musteriler/${cid}`);
  revalidateTenantData(gate.tenantId);
  return { ok: true, updatedCount: rows.length };
}

export type DemandDeleteImpact = {
  ok?: boolean;
  error?: string;
  total: number;
  /** Kapalı olmayan (hâlâ aranan) talepler. */
  openDemands: number;
  /** Ağda paylaşılan talepler: silinince paylaşım da kalkar (cascade). */
  networkShares: number;
};

/** Silme öncesi bağlı kayıt özeti (kalıcı silme: talepler çöp kutusuna girmez). */
export async function getDemandDeleteImpact(ids: string[]): Promise<DemandDeleteImpact> {
  const empty: DemandDeleteImpact = { total: 0, openDemands: 0, networkShares: 0 };
  const gate = await requirePermission("demands", "delete");
  if (!gate.ok) return { ...empty, error: gate.error };
  const list = [...new Set((ids ?? []).map((i) => String(i).trim()).filter(Boolean))].slice(0, DEMAND_BULK_LIMIT);
  if (list.length === 0) return { ...empty, ok: true };
  const supabase = await createClient();
  const head = { count: "exact" as const, head: true };
  const [all, open, shares] = await Promise.all([
    supabase.from("customer_demands").select("id", head).eq("tenant_id", gate.tenantId).in("id", list),
    supabase.from("customer_demands").select("id", head).eq("tenant_id", gate.tenantId).in("id", list).neq("status", "closed"),
    supabase.from("network_demands").select("id", head).eq("tenant_id", gate.tenantId).in("demand_id", list),
  ]);
  return { ok: true, total: all.count ?? 0, openDemands: open.count ?? 0, networkShares: shares.count ?? 0 };
}

/** Seçili talepleri KALICI siler (geri alınamaz; arayüz özetle onay ister). */
export async function bulkDeleteDemands(ids: string[]): Promise<DemandResult & { deletedCount?: number }> {
  const gate = await requirePermission("demands", "delete");
  if (!gate.ok) return { error: gate.error };
  const list = [...new Set((ids ?? []).map((i) => String(i).trim()).filter(Boolean))];
  if (list.length === 0) return { error: "Talep seçilmedi." };
  if (list.length > DEMAND_BULK_LIMIT) return { error: `Tek seferde en fazla ${DEMAND_BULK_LIMIT} talep silinebilir.` };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_demands")
    .delete()
    .in("id", list)
    .eq("tenant_id", gate.tenantId)
    .select("id, customer_id");
  if (error) {
    console.error("bulkDeleteDemands", error);
    return { error: "Talepler silinemedi." };
  }
  const rows = data ?? [];
  if (rows.length === 0) return { error: "Silinecek talep bulunamadı." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "demand.bulk_delete",
    entityType: "demand",
    newValue: { ids: rows.map((r) => r.id), count: rows.length },
  });
  revalidatePath("/app/talepler");
  revalidatePath("/app/eslestirme");
  revalidatePath("/app/musteriler");
  for (const cid of new Set(rows.map((r) => r.customer_id))) revalidatePath(`/app/musteriler/${cid}`);
  revalidateTenantData(gate.tenantId);
  return { ok: true, deletedCount: rows.length };
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
