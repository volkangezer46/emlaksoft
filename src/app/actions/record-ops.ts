"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { revalidateTenantData } from "@/lib/revalidate";
import { copyTitle } from "@/lib/record-copy";
import { actionErrorMessage } from "@/lib/action-errors";

/**
 * Genel kayıt işlemleri: "Silindi · Geri al" (çöp kutusu altyapısı: deleted_at) ve "Kaydı çoğalt".
 * Çoğaltma kişisel/yasal olarak kayda ÖZGÜ alanları KOPYALAMAZ: portföyde malik/yetki/EİDS no/ada-parsel/medya/portal
 * yayını; sözleşmede imzacılar/imza/kira bağı; otomasyonda çalışma sayacı. Kopyalar taslak/pasif doğar.
 */

export type RecordOpResult = { ok?: boolean; error?: string; id?: string };

const UUID = /^[0-9a-f-]{36}$/i;

/** Yumuşak silinen müşteri/portföyü geri alır (silme yetkisi gerekir). */
export async function restoreDeletedRecord(entity: "customer" | "property", id: string): Promise<RecordOpResult> {
  const gate = await requirePermission(entity === "customer" ? "customers" : "properties", "delete");
  if (!gate.ok) return { error: gate.error };
  if (!UUID.test(id)) return { error: "Kayıt bulunamadı." };
  const supabase = await createClient();
  const table = entity === "customer" ? "customers" : "properties";
  const { data, error } = await supabase
    .from(table)
    .update(entity === "customer" ? { deleted_at: null } : { deleted_at: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .not("deleted_at", "is", null)
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: actionErrorMessage(error, "Kayıt geri alınamadı.") };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: `${entity}.restore`, entityType: entity, entityId: id });
  revalidatePath("/app/ayarlar/cop-kutusu");
  revalidatePath(entity === "customer" ? "/app/musteriler" : "/app/portfoyler");
  revalidateTenantData(gate.tenantId);
  return { ok: true, id };
}

/** Portföyü taslak olarak çoğaltır (yeni kod, danışman = işlemi yapan). */
export async function duplicateProperty(id: string): Promise<RecordOpResult> {
  const gate = await requirePermission("properties", "create");
  if (!gate.ok) return { error: gate.error };
  if (!UUID.test(id)) return { error: "Portföy bulunamadı." };
  const supabase = await createClient();
  const { data: src } = await supabase
    .from("properties")
    .select("title, property_code, transaction_type, property_type, list_price, commission_rate, province_id, district_id, neighborhood_id, branch_id, address_line, features, price_health")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!src) return { error: "Portföy bulunamadı." };
  const stamp = new Date().toISOString().slice(2, 7).replace("-", "");
  const code = `ES-${stamp}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const { data, error } = await supabase
    .from("properties")
    .insert({
      tenant_id: gate.tenantId,
      property_code: code,
      title: copyTitle(src.title ?? src.property_code ?? "Portföy", 200),
      transaction_type: src.transaction_type,
      property_type: src.property_type,
      status: "draft",
      list_price: src.list_price,
      commission_rate: src.commission_rate,
      province_id: src.province_id,
      district_id: src.district_id,
      neighborhood_id: src.neighborhood_id,
      branch_id: src.branch_id,
      address_line: src.address_line,
      features: src.features ?? {},
      price_health: src.price_health,
      assigned_to: gate.userId,
      created_by: gate.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("duplicateProperty", error?.code);
    return { error: "Portföy çoğaltılamadı." };
  }
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "property.duplicate", entityType: "property", entityId: data.id, newValue: { from: id } });
  revalidatePath("/app/portfoyler");
  revalidateTenantData(gate.tenantId);
  return { ok: true, id: data.id };
}

/** Sözleşmeyi taslak olarak çoğaltır (imzacı/imza/kira bağı kopyalanmaz). */
export async function duplicateContract(id: string): Promise<RecordOpResult> {
  const gate = await requirePermission("contracts", "create");
  if (!gate.ok) return { error: gate.error };
  if (!UUID.test(id)) return { error: "Sözleşme bulunamadı." };
  const supabase = await createClient();
  const { data: src } = await supabase
    .from("contracts")
    .select("title, contract_type, body, property_id, customer_id")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!src) return { error: "Sözleşme bulunamadı." };
  const { data, error } = await supabase
    .from("contracts")
    .insert({
      tenant_id: gate.tenantId,
      created_by: gate.userId,
      title: copyTitle(src.title ?? "Sözleşme", 200),
      contract_type: src.contract_type,
      body: src.body,
      property_id: src.property_id,
      customer_id: src.customer_id,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("duplicateContract", error?.code);
    return { error: "Sözleşme çoğaltılamadı." };
  }
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "contract.duplicate", entityType: "contract", entityId: data.id, newValue: { from: id } });
  revalidatePath("/app/sozlesmeler");
  return { ok: true, id: data.id };
}

/** Otomasyonu PASİF olarak çoğaltır (çalışma sayacı sıfır); kullanıcı inceleyip açar. */
export async function duplicateAutomation(id: string): Promise<RecordOpResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID.test(id)) return { error: "Otomasyon bulunamadı." };
  const supabase = await createClient();
  const { data: src } = await supabase
    .from("automations")
    .select("name, description, trigger_type, trigger_config, conditions, actions")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!src) return { error: "Otomasyon bulunamadı." };
  const { data, error } = await supabase
    .from("automations")
    .insert({
      tenant_id: gate.tenantId,
      name: copyTitle(src.name ?? "Otomasyon", 120),
      description: src.description,
      trigger_type: src.trigger_type,
      trigger_config: src.trigger_config,
      conditions: src.conditions,
      actions: src.actions,
      status: "inactive",
      run_count: 0,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("duplicateAutomation", error?.code);
    return { error: "Otomasyon çoğaltılamadı." };
  }
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "automation.duplicate", entityType: "automation", entityId: data.id, newValue: { from: id } });
  revalidatePath("/app/otomasyonlar");
  return { ok: true, id: data.id };
}
