"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";

export type TaskResult = { error?: string; ok?: boolean; id?: string };

const KINDS = ["followup", "call", "visit", "document", "other"];
const PRIORITIES = ["low", "normal", "high"];

export async function createTask(_prev: TaskResult, formData: FormData): Promise<TaskResult> {
  const gate = await requirePermission("tasks", "create");
  if (!gate.ok) return { error: gate.error };

  const title = String(formData.get("title") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const kind = String(formData.get("kind") ?? "followup").trim();
  const priority = String(formData.get("priority") ?? "normal").trim();
  const dueRaw = String(formData.get("due_at") ?? "").trim();
  const assignedTo = String(formData.get("assigned_to") ?? "").trim();
  const customerId = String(formData.get("customer_id") ?? "").trim();
  const propertyId = String(formData.get("property_id") ?? "").trim();

  if (!title) return { error: "Görev başlığı zorunlu." };
  if (!KINDS.includes(kind)) return { error: "Geçersiz görev türü." };
  if (!PRIORITIES.includes(priority)) return { error: "Geçersiz öncelik." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      tenant_id: gate.tenantId,
      title,
      notes: notes || null,
      kind,
      priority,
      status: "open",
      due_at: dueRaw ? new Date(dueRaw).toISOString() : null,
      assigned_to: assignedTo || gate.userId,
      customer_id: customerId || null,
      property_id: propertyId || null,
      created_by: gate.userId,
    })
    .select("id")
    .single();

  if (error) {
    console.error("createTask", error);
    return { error: "Görev oluşturulamadı." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "task.create",
    entityType: "task",
    entityId: data.id,
    newValue: { title, kind, priority },
  });

  // Başkasına atandıysa bildir
  if (assignedTo && assignedTo !== gate.userId) {
    await notifyTenant({
      tenantId: gate.tenantId,
      userId: assignedTo,
      title: "Yeni görev atandı",
      body: title,
      href: "/app/gorevler",
      kind: "info",
    });
  }

  revalidatePath("/app/gorevler");
  if (customerId) revalidatePath(`/app/musteriler/${customerId}`);
  return { ok: true, id: data.id };
}

export async function updateTask(_prev: TaskResult, formData: FormData): Promise<TaskResult> {
  const gate = await requirePermission("tasks", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Görev bulunamadı." };

  const title = String(formData.get("title") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const kind = String(formData.get("kind") ?? "followup").trim();
  const priority = String(formData.get("priority") ?? "normal").trim();
  const dueRaw = String(formData.get("due_at") ?? "").trim();
  const assignedTo = String(formData.get("assigned_to") ?? "").trim();

  if (!title) return { error: "Görev başlığı zorunlu." };
  if (!KINDS.includes(kind)) return { error: "Geçersiz görev türü." };
  if (!PRIORITIES.includes(priority)) return { error: "Geçersiz öncelik." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({
      title,
      notes: notes || null,
      kind,
      priority,
      due_at: dueRaw ? new Date(dueRaw).toISOString() : null,
      ...(assignedTo ? { assigned_to: assignedTo } : {}),
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("updateTask", error);
    return { error: "Görev güncellenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "task.update",
    entityType: "task",
    entityId: id,
    newValue: { title, kind, priority },
  });

  revalidatePath("/app/gorevler");
  return { ok: true, id };
}

export async function completeTask(formData: FormData): Promise<void> {
  const gate = await requirePermission("tasks", "edit");
  if (!gate.ok) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "task.complete",
    entityType: "task",
    entityId: id,
  });
  revalidatePath("/app/gorevler");
}

export async function reopenTask(formData: FormData): Promise<void> {
  const gate = await requirePermission("tasks", "edit");
  if (!gate.ok) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from("tasks")
    .update({ status: "open", completed_at: null })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  revalidatePath("/app/gorevler");
}

export async function deleteTask(formData: FormData): Promise<void> {
  const gate = await requirePermission("tasks", "delete");
  if (!gate.ok) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("tasks").delete().eq("id", id).eq("tenant_id", gate.tenantId);
  revalidatePath("/app/gorevler");
}
