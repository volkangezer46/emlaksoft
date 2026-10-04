"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { parseDueInput } from "@/lib/due-input";
import { validateTenantReferences } from "@/lib/tenant-references";

export type DueResult = { ok?: boolean; error?: string; id?: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createDue(_prev: DueResult, fd: FormData): Promise<DueResult> {
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return { error: gate.error };

  const parsed = parseDueInput(fd);
  if (!parsed.ok) return { error: parsed.error };
  const { title, amount, period, dueDate, propertyId, notes } = parsed.value;
  const references = await validateTenantReferences(gate.tenantId, { propertyId });
  if (!references.ok) return { error: references.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("property_dues")
    .insert({
      tenant_id: gate.tenantId,
      created_by: gate.userId,
      property_id: propertyId,
      title,
      amount,
      period,
      due_date: dueDate,
      notes,
      status: "unpaid",
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createDue", error);
    return { error: "Aidat kaydedilemedi." };
  }
  revalidatePath("/app/aidat");
  return { ok: true, id: data.id };
}

/** Aidat düzenleme: başlık, tutar, dönem, son ödeme, not (portföy bağı korunur; yalnız alan gelirse değişir). */
export async function updateDue(_prev: DueResult, fd: FormData): Promise<DueResult> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "Aidat kaydı geçersiz." };
  const parsed = parseDueInput(fd);
  if (!parsed.ok) return { error: parsed.error };
  const { title, amount, period, dueDate, propertyId, notes } = parsed.value;
  if (fd.has("property_id")) {
    const references = await validateTenantReferences(gate.tenantId, { propertyId });
    if (!references.ok) return { error: references.error };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("property_dues")
    .update({
      title,
      amount,
      period,
      due_date: dueDate,
      notes,
      ...(fd.has("property_id") ? { property_id: propertyId } : {}),
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("updateDue", { code: error.code || "unknown" });
    return { error: "Aidat güncellenemedi." };
  }
  if (!data) return { error: "Aidat kaydı bulunamadı." };
  revalidatePath("/app/aidat");
  return { ok: true, id };
}

export async function toggleDuePaid(id: string, paid: boolean): Promise<DueResult> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(id)) return { error: "Aidat kaydı geçersiz." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("property_dues")
    .update({ status: paid ? "paid" : "unpaid", paid_at: paid ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id")
    .maybeSingle();
  if (error) return { error: "Durum güncellenemedi." };
  if (!data) return { error: "Aidat kaydı bulunamadı." };
  revalidatePath("/app/aidat");
  return { ok: true };
}

/**
 * Seçilen aidat kayıtlarını topluca "ödendi" işaretler — toggleDuePaid'in
 * toplu hali. Zaten ödenmiş kayıtlar sessizce atlanır.
 */
export async function markDuesPaidBulk(
  ids: string[],
): Promise<DueResult & { updated?: number }> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };

  const clean = Array.from(
    new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean)),
  ).slice(0, 200);
  if (clean.length === 0) return { error: "En az bir kayıt seçin." };
  if (clean.some((id) => !UUID_RE.test(id))) return { error: "Seçilen aidat kaydı geçersiz." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("property_dues")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .in("id", clean)
    .eq("tenant_id", gate.tenantId)
    .neq("status", "paid")
    .select("id");

  if (error) {
    console.error("markDuesPaidBulk", error);
    return { error: "Kayıtlar güncellenemedi." };
  }

  revalidatePath("/app/aidat");
  return { ok: true, updated: (data ?? []).length };
}

export async function deleteDue(id: string): Promise<DueResult> {
  const gate = await requirePermission("expenses", "delete");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(id)) return { error: "Aidat kaydı geçersiz." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("property_dues")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("deleteDue", { code: error.code || "unknown" });
    return { error: "Aidat silinemedi." };
  }
  if (!data) return { error: "Aidat kaydı bulunamadı." };
  revalidatePath("/app/aidat");
  return { ok: true };
}

export async function listDues() {
  const gate = await requirePermission("expenses", "view");
  if (!gate.ok) throw new Error(gate.error);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("property_dues")
    .select("id, title, amount, period, due_date, status, notes, property:properties!property_dues_property_id_fkey(id, property_code, title)")
    .eq("tenant_id", gate.tenantId)
    .order("period", { ascending: false })
    .limit(300);
  if (error) {
    console.error("listDues", { code: error.code || "unknown" });
    throw new Error("Aidat kayıtları güvenli şekilde yüklenemedi.");
  }
  return data ?? [];
}
