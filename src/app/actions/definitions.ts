"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";

export type DefinitionResult = { ok?: boolean; error?: string; id?: string };

const CATEGORIES = ["customer_type", "customer_source", "property_type", "transaction_type", "contract_type"] as const;

/** Ofise özel yeni tanım ekler (dropdown seçeneği). */
export async function addDefinition(_prev: DefinitionResult, fd: FormData): Promise<DefinitionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const category = String(fd.get("category") ?? "").trim();
  const label = String(fd.get("label") ?? "").trim();
  let value = String(fd.get("value") ?? "").trim();
  if (!value) value = label; // değer verilmezse etiketi kullan

  if (!(CATEGORIES as readonly string[]).includes(category)) return { error: "Geçersiz kategori." };
  if (!label) return { error: "Etiket zorunludur." };

  const supabase = await createClient();
  // sonraki sıra numarası
  const { data: last } = await supabase
    .from("definitions")
    .select("sort_order")
    .eq("category", category)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = (last?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("definitions")
    .insert({ tenant_id: gate.tenantId, category, value, label, sort_order: nextSort })
    .select("id")
    .single();

  if (error || !data) {
    console.error("addDefinition", error);
    return { error: "Tanım eklenemedi (aynı değer zaten olabilir)." };
  }
  revalidatePath("/app/ayarlar/tanimlar");
  return { ok: true, id: data.id };
}

/** Ofise özel tanımı pasifleştirir/aktifleştirir. Global (tenant_id null) tanımlara dokunmaz. */
export async function toggleDefinition(id: string, active: boolean): Promise<DefinitionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { error } = await supabase
    .from("definitions")
    .update({ is_active: active })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: "Güncellenemedi." };
  revalidatePath("/app/ayarlar/tanimlar");
  return { ok: true };
}

/** Ofise özel tanımı siler. */
export async function deleteDefinition(id: string): Promise<DefinitionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  await supabase.from("definitions").delete().eq("id", id).eq("tenant_id", gate.tenantId);
  revalidatePath("/app/ayarlar/tanimlar");
  return { ok: true };
}
