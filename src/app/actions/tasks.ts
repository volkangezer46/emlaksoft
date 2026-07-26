"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";

export type TaskResult = { error?: string; ok?: boolean; id?: string };

const KINDS = ["followup", "call", "visit", "document", "other"];
const PRIORITIES = ["low", "normal", "high"];
const RECURRENCES = ["daily", "weekly", "biweekly", "monthly"];

/**
 * Bir sonraki terminin ISO karşılığı — hesap MEVCUT due_at üzerinden yürür
 * (Date.now yok, saat dilimi kayması yok: gün/hafta sabit ms, ay UTC parça
 * aritmetiği). Ay eklerken gün taşması clamp'lenir (31 Oca → 28/29 Şub).
 */
function nextDueIso(dueIso: string, recurrence: string): string {
  const d = new Date(dueIso);
  const DAY = 86_400_000;
  if (recurrence === "daily") return new Date(d.getTime() + DAY).toISOString();
  if (recurrence === "weekly") return new Date(d.getTime() + 7 * DAY).toISOString();
  if (recurrence === "biweekly") return new Date(d.getTime() + 14 * DAY).toISOString();
  // monthly — Date.UTC(y, m+2, 0) = bir sonraki ayın son günü
  const lastDayOfNextMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0)).getUTCDate();
  const nd = new Date(d.getTime());
  nd.setUTCMonth(d.getUTCMonth() + 1, Math.min(d.getUTCDate(), lastDayOfNextMonth));
  return nd.toISOString();
}

type RecurringSource = {
  id: string;
  title: string;
  notes: string | null;
  kind: string;
  priority: string;
  due_at: string | null;
  assigned_to: string | null;
  customer_id: string | null;
  property_id: string | null;
  recurrence: string | null;
  recurrence_parent_id: string | null;
};

/**
 * Tamamlanan tekrarlı görevden SONRAKİ kopyayı üretir; ürettiyse yeni due_at
 * ISO'sunu döndürür, üretmediyse null.
 *
 * Zincir kuralı: her kopya KÖKE bağlanır (eski görevin parent'ı varsa o taşınır,
 * yoksa eski görevin kendisi köktür) — zincir hiç derinleşmez.
 * Mükerrer freni: aynı köke bağlı (kökün kendisi dahil) AÇIK görev varsa üretme.
 */
async function spawnNextRecurring(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  userId: string,
  task: RecurringSource,
): Promise<string | null> {
  if (!task.recurrence || !RECURRENCES.includes(task.recurrence) || !task.due_at) return null;

  const rootId = task.recurrence_parent_id ?? task.id;

  const { data: openCopies, error: copyErr } = await supabase
    .from("tasks")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .or(`recurrence_parent_id.eq.${rootId},id.eq.${rootId}`)
    .neq("id", task.id)
    .limit(1);
  if (copyErr || (openCopies ?? []).length > 0) return null;

  const dueAt = nextDueIso(task.due_at, task.recurrence);
  const { error } = await supabase.from("tasks").insert({
    tenant_id: tenantId,
    title: task.title,
    notes: task.notes,
    kind: task.kind,
    priority: task.priority,
    status: "open",
    due_at: dueAt,
    assigned_to: task.assigned_to,
    customer_id: task.customer_id,
    property_id: task.property_id,
    recurrence: task.recurrence,
    recurrence_parent_id: rootId,
    created_by: userId,
  });
  if (error) {
    console.error("spawnNextRecurring", error);
    return null;
  }
  return dueAt;
}

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
  const recurrenceRaw = String(formData.get("recurrence") ?? "").trim();

  if (!title) return { error: "Görev başlığı zorunlu." };
  if (!KINDS.includes(kind)) return { error: "Geçersiz görev türü." };
  if (!PRIORITIES.includes(priority)) return { error: "Geçersiz öncelik." };
  if (recurrenceRaw && !RECURRENCES.includes(recurrenceRaw)) return { error: "Geçersiz tekrar periyodu." };
  // Tekrar yalnız terminli görevde anlamlı — termin yoksa sessizce yok say.
  const recurrence = dueRaw && recurrenceRaw ? recurrenceRaw : null;

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
      recurrence,
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
  const recurrenceRaw = String(formData.get("recurrence") ?? "").trim();

  if (!title) return { error: "Görev başlığı zorunlu." };
  if (!KINDS.includes(kind)) return { error: "Geçersiz görev türü." };
  if (!PRIORITIES.includes(priority)) return { error: "Geçersiz öncelik." };
  if (recurrenceRaw && !RECURRENCES.includes(recurrenceRaw)) return { error: "Geçersiz tekrar periyodu." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({
      title,
      notes: notes || null,
      kind,
      priority,
      due_at: dueRaw ? new Date(dueRaw).toISOString() : null,
      // Termin silinirse tekrar da düşer (terminsiz tekrar anlamsız).
      recurrence: dueRaw && recurrenceRaw ? recurrenceRaw : null,
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

export type CompleteTaskResult = { nextDueAt: string | null };

export async function completeTask(formData: FormData): Promise<CompleteTaskResult> {
  const gate = await requirePermission("tasks", "edit");
  if (!gate.ok) return { nextDueAt: null };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { nextDueAt: null };

  const supabase = await createClient();
  // Tekrar üretimi için satırı tamamlamadan ÖNCE oku (kopyalanacak alanlar).
  const { data: task } = await supabase
    .from("tasks")
    .select("id, title, notes, kind, priority, status, due_at, assigned_to, customer_id, property_id, recurrence, recurrence_parent_id")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  // Tekrarlı görev: sonraki kopya (yalnız açıkken tamamlananlar için).
  let nextDueAt: string | null = null;
  if (task && task.status === "open") {
    nextDueAt = await spawnNextRecurring(supabase, gate.tenantId, gate.userId, task as RecurringSource);
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "task.complete",
    entityType: "task",
    entityId: id,
    ...(nextDueAt ? { newValue: { next_due_at: nextDueAt } } : {}),
  });
  revalidatePath("/app/gorevler");
  return { nextDueAt };
}

/**
 * Toplu tamamlama: /app/gorevler listesindeki checkbox seçimi.
 * Tek UPDATE ile .in() — yalnız açık görevler; kapalı olanlar dokunulmaz.
 */
export async function completeTasksBulk(formData: FormData): Promise<void> {
  const gate = await requirePermission("tasks", "edit");
  if (!gate.ok) return;

  const ids = [...new Set(formData.getAll("ids").map((v) => String(v).trim()).filter(Boolean))].slice(0, 200);
  if (ids.length === 0) return;

  const supabase = await createClient();
  // Tekrarlı satırları tamamlamadan ÖNCE oku (kopyalanacak alanlar).
  const { data: recurring } = await supabase
    .from("tasks")
    .select("id, title, notes, kind, priority, status, due_at, assigned_to, customer_id, property_id, recurrence, recurrence_parent_id")
    .in("id", ids)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "open")
    .not("recurrence", "is", null);

  const { error } = await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .in("id", ids)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "open");

  if (error) {
    console.error("completeTasksBulk", error);
    return;
  }

  // Sonraki kopyalar — kayıt başına SIRAYLA: aynı zincirden birden çok görev
  // seçildiyse ilk üretilen açık kopya sonrakiler için mükerrer frenini çeker.
  for (const t of recurring ?? []) {
    await spawnNextRecurring(supabase, gate.tenantId, gate.userId, t as RecurringSource);
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "task.complete_bulk",
    entityType: "task",
    newValue: { count: ids.length },
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
