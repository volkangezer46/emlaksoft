"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { isDefinitionCategory, isSystemDefinitionValue, type DefinitionCategory } from "@/lib/definition-defaults";
import { countDefinitionUsage } from "@/lib/definition-usage";

export type DefinitionResult = { ok?: boolean; error?: string; id?: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

type OwnRow = { id: string; category: string; value: string; label: string; color: string | null; sort_order: number; is_active: boolean };

function invalidate(tenantId: string) {
  revalidatePath("/app/ayarlar/tanimlar");
  revalidateTag(`definitions:${tenantId}`, "max");
  revalidateTag("definitions", "max");
}

/** Ofise ait tek tanım satırı (tenant filtresiyle). */
async function loadOwn(id: string, tenantId: string): Promise<OwnRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("definitions")
    .select("id, category, value, label, color, sort_order, is_active")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return (data as OwnRow | null) ?? null;
}

function audit(
  gate: { tenantId: string; userId: string },
  action: string,
  entityId: string | null,
  oldValue: Record<string, unknown> | null,
  newValue: Record<string, unknown> | null,
) {
  return logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action,
    entityType: "definition",
    entityId,
    oldValue,
    newValue,
  });
}

/** Ofise özel yeni tanım ekler (dropdown seçeneği). */
export async function addDefinition(_prev: DefinitionResult, fd: FormData): Promise<DefinitionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const category = String(fd.get("category") ?? "").trim();
  const label = String(fd.get("label") ?? "").trim();
  let value = String(fd.get("value") ?? "").trim();
  if (!value) value = label; // değer verilmezse etiketi kullan

  if (!isDefinitionCategory(category)) return { error: "Geçersiz kategori." };
  if (!label) return { error: "Etiket zorunludur." };
  if (label.length > 120 || value.length > 120) {
    return { error: "Etiket ve değer en fazla 120 karakter olabilir." };
  }

  const supabase = await createClient();
  // sonraki sıra numarası
  const { data: last, error: orderError } = await supabase
    .from("definitions")
    .select("sort_order")
    .eq("category", category)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderError) {
    console.error("addDefinition sort lookup", { code: orderError.code || "unknown" });
    return { error: "Tanım sırası güvenli şekilde belirlenemedi." };
  }
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
  await audit(gate, "definition.create", data.id, null, { category, value, label });
  invalidate(gate.tenantId);
  return { ok: true, id: data.id };
}

/**
 * Ofise özel tanımı pasifleştirir/aktifleştirir. Global (tenant_id null) tanımlara
 * dokunmaz; sistem anahtarları (kodun dallandığı değerler) pasifleştirilemez.
 */
export async function toggleDefinition(id: string, active: boolean): Promise<DefinitionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(id)) return { error: "Tanım kaydı geçersiz." };
  const row = await loadOwn(id, gate.tenantId);
  if (!row) return { error: "Tanım bulunamadı veya sistem tanımı değiştirilemez." };
  if (!active && isSystemDefinitionValue(row.category, row.value)) {
    return { error: "Bu değer sistem tarafından kullanıldığı için gizlenemez." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("definitions")
    .update({ is_active: active })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id")
    .maybeSingle();
  if (error) return { error: "Güncellenemedi." };
  if (!data) return { error: "Tanım bulunamadı veya sistem tanımı değiştirilemez." };
  await audit(gate, active ? "definition.activate" : "definition.deactivate", id, { is_active: row.is_active }, {
    category: row.category,
    value: row.value,
    is_active: active,
  });
  invalidate(gate.tenantId);
  return { ok: true };
}

/** Ofise özel tanımın etiketini günceller (inline rename). Global tanımlara dokunmaz. */
export async function renameDefinition(id: string, label: string): Promise<DefinitionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(id)) return { error: "Tanım kaydı geçersiz." };
  const trimmed = label.trim();
  if (!trimmed) return { error: "Etiket zorunludur." };
  if (trimmed.length > 120) return { error: "Etiket en fazla 120 karakter olabilir." };
  const row = await loadOwn(id, gate.tenantId);
  if (!row) return { error: "Tanım bulunamadı veya sistem tanımı değiştirilemez." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("definitions")
    .update({ label: trimmed })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id")
    .maybeSingle();
  if (error) return { error: "Güncellenemedi." };
  if (!data) return { error: "Tanım bulunamadı veya sistem tanımı değiştirilemez." };
  await audit(gate, "definition.rename", id, { label: row.label }, { category: row.category, value: row.value, label: trimmed });
  invalidate(gate.tenantId);
  return { ok: true };
}

/** Ofise özel tanımın rozet rengini günceller (boş = rengi kaldır). */
export async function setDefinitionColor(id: string, color: string | null): Promise<DefinitionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(id)) return { error: "Tanım kaydı geçersiz." };
  const next = color ? color.trim() : null;
  if (next && !COLOR_RE.test(next)) return { error: "Renk #rrggbb biçiminde olmalıdır." };
  const row = await loadOwn(id, gate.tenantId);
  if (!row) return { error: "Tanım bulunamadı veya sistem tanımı değiştirilemez." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("definitions")
    .update({ color: next })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id")
    .maybeSingle();
  if (error) return { error: "Güncellenemedi." };
  if (!data) return { error: "Tanım bulunamadı veya sistem tanımı değiştirilemez." };
  await audit(gate, "definition.color", id, { color: row.color }, { category: row.category, value: row.value, color: next });
  invalidate(gate.tenantId);
  return { ok: true };
}

/**
 * Ofise özel tanımı sıralamada bir adım yukarı/aşağı taşır. Global tanımların
 * sıra numarası ofis tarafından değiştirilemediğinden yalnız ofise özel satırlar
 * kendi aralarında yer değiştirir (ofis satırları global'lerden sonra gelir).
 */
export async function moveDefinition(id: string, direction: "up" | "down"): Promise<DefinitionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(id)) return { error: "Tanım kaydı geçersiz." };
  if (direction !== "up" && direction !== "down") return { error: "Geçersiz yön." };
  const row = await loadOwn(id, gate.tenantId);
  if (!row) return { error: "Tanım bulunamadı veya sistem tanımı sıralanamaz." };

  const supabase = await createClient();
  const { data: own, error } = await supabase
    .from("definitions")
    .select("id, sort_order, created_at")
    .eq("tenant_id", gate.tenantId)
    .eq("category", row.category)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error || !own) return { error: "Sıralama okunamadı." };

  const { data: globals } = await supabase
    .from("definitions")
    .select("sort_order")
    .is("tenant_id", null)
    .eq("category", row.category)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const base = globals?.sort_order ?? 0;

  const list = own.map((r) => ({ id: r.id as string, sort_order: r.sort_order as number }));
  const idx = list.findIndex((r) => r.id === id);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= list.length) return { ok: true }; // zaten uçta
  [list[idx], list[swapWith]] = [list[swapWith], list[idx]];

  // Yeniden numaralandır (eşit sort_order durumlarını da düzeltir); yalnız değişenleri yaz.
  for (let i = 0; i < list.length; i++) {
    const target = base + i + 1;
    const before = own.find((r) => r.id === list[i].id)?.sort_order;
    if (before === target) continue;
    const { error: upErr } = await supabase
      .from("definitions")
      .update({ sort_order: target })
      .eq("id", list[i].id)
      .eq("tenant_id", gate.tenantId);
    if (upErr) return { error: "Sıralama güncellenemedi." };
  }
  await audit(gate, "definition.reorder", id, null, { category: row.category, value: row.value, direction });
  invalidate(gate.tenantId);
  return { ok: true };
}

/**
 * Ofise özel tanımı siler. Sistem anahtarları ve kayıtlarda kullanımdaki değerler
 * silinemez (önce gizlenmeli); referans sayılamazsa güvenli tarafta engellenir.
 */
export async function deleteDefinition(id: string): Promise<DefinitionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(id)) return { error: "Tanım kaydı geçersiz." };
  const row = await loadOwn(id, gate.tenantId);
  if (!row) return { error: "Tanım bulunamadı veya sistem tanımı silinemez." };
  if (isSystemDefinitionValue(row.category, row.value)) {
    return { error: "Bu değer sistem tarafından kullanıldığı için silinemez." };
  }
  const supabase = await createClient();
  const used = await countDefinitionUsage(supabase, gate.tenantId, row.category as DefinitionCategory, row.value);
  if (used === null) return { error: "Kullanım durumu doğrulanamadı; silme güvenlik için durduruldu." };
  if (used > 0) {
    return { error: `Bu değer ${used} kayıtta kullanılıyor; silinemez. Listeden kaldırmak için "Gizle" seçeneğini kullanın.` };
  }
  const { data, error } = await supabase
    .from("definitions")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id")
    .maybeSingle();
  if (error) return { error: "Tanım silinemedi." };
  if (!data) return { error: "Tanım bulunamadı veya sistem tanımı silinemez." };
  await audit(gate, "definition.delete", id, { category: row.category, value: row.value, label: row.label }, null);
  invalidate(gate.tenantId);
  return { ok: true };
}
