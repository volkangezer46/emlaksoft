"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";

export type DueResult = { ok?: boolean; error?: string; id?: string };

export async function createDue(_prev: DueResult, fd: FormData): Promise<DueResult> {
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return { error: gate.error };

  const title      = String(fd.get("title") ?? "").trim();
  const amount     = parseFloat(String(fd.get("amount") ?? "0"));
  const period     = String(fd.get("period") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const dueDate    = String(fd.get("due_date") ?? "").trim() || null;
  const propertyId = String(fd.get("property_id") ?? "").trim() || null;
  const notes      = String(fd.get("notes") ?? "").trim() || null;

  if (!title) return { error: "Başlık zorunludur." };
  if (isNaN(amount) || amount <= 0) return { error: "Geçerli bir tutar girin." };

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

export async function toggleDuePaid(id: string, paid: boolean): Promise<DueResult> {
  const gate = await requirePermission("expenses", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("property_dues")
    .update({ status: paid ? "paid" : "unpaid", paid_at: paid ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: "Durum güncellenemedi." };
  revalidatePath("/app/aidat");
  return { ok: true };
}

export async function deleteDue(id: string): Promise<DueResult> {
  const gate = await requirePermission("expenses", "delete");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  await supabase.from("property_dues").delete().eq("id", id).eq("tenant_id", gate.tenantId);
  revalidatePath("/app/aidat");
  return { ok: true };
}

export async function listDues() {
  const gate = await requirePermission("expenses", "view");
  if (!gate.ok) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("property_dues")
    .select("id, title, amount, period, due_date, status, notes, property:properties(id, property_code, title)")
    .eq("tenant_id", gate.tenantId)
    .order("period", { ascending: false })
    .limit(300);
  return data ?? [];
}
