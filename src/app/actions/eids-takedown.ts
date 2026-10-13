"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";
import { now } from "@/lib/clock";
import { canCloseTakedown } from "@/lib/eids/actions-core";
import { restoreOwnSurfaces } from "@/lib/eids/actions";

/**
 * EİDS kaldırma görevi kontrol listesi (kullanıcı oturumu; RLS: görev yetkisiyle oku/işaretle). service_role YOK.
 * Kalem yalnız "bekliyor" iken işaretlenir; eklentinin işaretlediği kalem elle değiştirilmez. Görev, tüm kalemler
 * işaretlenmeden kapanmaz (DB tetiği aynı kuralı ayrıca uygular).
 */

export type TakedownActionResult = { ok?: boolean; error?: string; info?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MANAGEMENT = new Set(["owner", "gm", "branch_manager"]);

function revalidate(taskId: string) {
  revalidatePath("/app/gorevler");
  revalidatePath(`/app/gorevler/eids/${taskId}`);
}

export async function markTakedownItem(itemId: string, status: "removed" | "not_found"): Promise<TakedownActionResult> {
  const gate = await requirePermission("tasks", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(itemId ?? ""))) return { error: "Kontrol listesi kalemi bulunamadı; sayfayı yenileyin." };
  if (status !== "removed" && status !== "not_found") return { error: "Geçersiz işaret; sayfayı yenileyip tekrar deneyin." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("eids_takedown_items")
    .update({ status, verified_by: "manual", done_at: new Date(now()).toISOString(), done_by: gate.userId })
    .eq("id", itemId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "pending")
    .select("id, task_id, target");
  if (error) return { error: actionErrorMessage(error, "Kalem işaretlenemedi") };
  const row = (data ?? [])[0] as { id: string; task_id: string; target: string } | undefined;
  if (!row) return { error: "Kalem zaten işaretlenmiş ya da bulunamadı; sayfayı yenileyin." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "task.eids_takedown_item",
    entityType: "task",
    entityId: row.task_id,
    newValue: { target: row.target, status },
  });
  revalidate(row.task_id);
  return { ok: true };
}

export async function completeTakedownTask(taskId: string): Promise<TakedownActionResult> {
  const gate = await requirePermission("tasks", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(taskId ?? ""))) return { error: "Görev bulunamadı; sayfayı yenileyin." };

  const supabase = await createClient();
  const { data: items, error: iErr } = await supabase.from("eids_takedown_items").select("status").eq("tenant_id", gate.tenantId).eq("task_id", taskId);
  if (iErr) return { error: actionErrorMessage(iErr, "Kontrol listesi okunamadı") };
  if (!canCloseTakedown((items ?? []) as { status: string }[])) {
    return { error: "Görev kapanmadı: kontrol listesinde işaretlenmemiş kalem var. Her yerde ilanı kaldırıp kalemi işaretleyin." };
  }
  const { data, error } = await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date(now()).toISOString() })
    .eq("id", taskId)
    .eq("tenant_id", gate.tenantId)
    .eq("kind", "eids_takedown")
    .eq("status", "open")
    .select("id");
  if (error) {
    if (error.code === "P0001") return { error: "Görev kapanmadı: kontrol listesinde işaretlenmemiş kalem var. Sayfayı yenileyip kalemleri kontrol edin." };
    return { error: actionErrorMessage(error, "Görev kapatılamadı") };
  }
  if (!data || data.length === 0) return { error: "Görev zaten kapalı ya da bulunamadı; sayfayı yenileyin." };

  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "task.complete", entityType: "task", entityId: taskId, newValue: { kind: "eids_takedown" } });
  revalidate(taskId);
  return { ok: true, info: "Kaldırma görevi tamamlandı." };
}

/**
 * Otomatik kapatılan vitrin ve paylaşım bağlantılarını geri açar (yalnız yönetim: yetki geri geldiyse ya da kapatma
 * yanlışsa). Görev açık kalır; portal kalemleri değişmez.
 */
export async function restoreTakedownSurfaces(taskId: string): Promise<TakedownActionResult> {
  const gate = await requirePermission("tasks", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!MANAGEMENT.has(gate.role)) return { error: "Geri alma yalnız ofis sahibi, genel müdür ve şube müdürü içindir; yöneticinizden isteyin." };
  if (!UUID_RE.test(String(taskId ?? ""))) return { error: "Görev bulunamadı; sayfayı yenileyin." };

  const supabase = await createClient();
  const { restored } = await restoreOwnSurfaces(supabase, gate.tenantId, taskId);
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "task.eids_restore_surfaces", entityType: "task", entityId: taskId, newValue: { restored } });
  revalidate(taskId);
  return restored > 0
    ? { ok: true, info: `${restored} yüzey yeniden açıldı (vitrin / paylaşım bağlantısı).` }
    : { error: "Geri açılacak yüzey bulunamadı: vitrin durumu elle değiştirilmiş ya da bağlantılar silinmiş olabilir." };
}
