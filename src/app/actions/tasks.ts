"use server";

import type { ActionOutcome } from "@/lib/action-outcome";
import { revalidatePath } from "next/cache";
import { DAY_MS, now, parseTrLocalDateTime, trDayStartMs } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";
import { validateTenantReferences } from "@/lib/tenant-references";
import { actionErrorMessage } from "@/lib/action-errors";
import { afterSafe } from "@/lib/after-safe";
import { idsDigest, notifyAssignment } from "@/lib/assignment-notify";
import { trDayKey } from "@/lib/clock";
import { duePresetMs, isDuePreset, type DuePreset } from "@/lib/due-presets";

export type TaskResult = { error?: string; ok?: boolean; id?: string };

const KINDS = ["followup", "call", "visit", "document", "other"];
const PRIORITIES = ["low", "normal", "high"];
/**
 * EİDS aksiyon motorunun sistem görevleri (src/lib/eids/actions.ts): elle oluşturulmaz; düzenlemede türleri ve "Acil"
 * öncelikleri korunur. Kaldırma görevi (eids_takedown) yalnız kontrol listesinden kapanır (DB tetiği de engeller).
 */
const SYSTEM_KINDS = ["eids_publish", "eids_takedown"];
const SYSTEM_PRIORITIES = ["urgent"];
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
  deal_id?: string | null;
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
    // Anlaşma bağı zincir boyunca korunur (anlaşma detayındaki görev listesi kopyayı da görür).
    deal_id: task.deal_id ?? null,
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
  // İsteğe bağlı anlaşma bağı (anlaşma kapanış sihirbazı): yalnız aynı ofisin anlaşması kabul edilir.
  const dealId = String(formData.get("deal_id") ?? "").trim();
  const recurrenceRaw = String(formData.get("recurrence") ?? "").trim();

  if (!title) return { error: "Görev başlığı zorunlu." };
  if (!KINDS.includes(kind)) return { error: "Geçersiz görev türü." };
  if (!PRIORITIES.includes(priority)) return { error: "Geçersiz öncelik." };
  if (recurrenceRaw && !RECURRENCES.includes(recurrenceRaw)) return { error: "Geçersiz tekrar periyodu." };
  // Tekrar yalnız terminli görevde anlamlı — termin yoksa sessizce yok say.
  const recurrence = dueRaw && recurrenceRaw ? recurrenceRaw : null;

  const references = await validateTenantReferences(gate.tenantId, {
    customerId: customerId || null,
    propertyId: propertyId || null,
    profileId: assignedTo || null,
  });
  if (!references.ok) return { error: references.error };

  const supabase = await createClient();
  if (dealId) {
    const { data: ownDeal } = await supabase
      .from("deals")
      .select("id")
      .eq("id", dealId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (!ownDeal) return { error: "Anlaşma bulunamadı." };
  }
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      tenant_id: gate.tenantId,
      title,
      notes: notes || null,
      kind,
      priority,
      status: "open",
      deal_id: dealId || null,
      due_at: dueRaw ? (parseTrLocalDateTime(dueRaw)?.toISOString() ?? null) : null,
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
    return { error: actionErrorMessage(error, "Görev oluşturulamadı.") };
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
      href: `/app/gorevler?gorev=${data.id}`,
      kind: "info",
    });
  }

  revalidatePath("/app/gorevler");
  if (customerId) revalidatePath(`/app/musteriler/${customerId}`);
  if (dealId) revalidatePath(`/app/anlasmalar/${dealId}`);
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
  // Anlaşma bağı yalnız alan formda varsa değişir ("" = bağı kaldır); eski formlar dokunmaz.
  const dealField = formData.has("deal_id") ? String(formData.get("deal_id") ?? "").trim() : undefined;

  if (!title) return { error: "Görev başlığı zorunlu." };
  if (!KINDS.includes(kind) && !SYSTEM_KINDS.includes(kind)) return { error: "Geçersiz görev türü." };
  if (!PRIORITIES.includes(priority) && !SYSTEM_PRIORITIES.includes(priority)) return { error: "Geçersiz öncelik." };
  if (recurrenceRaw && !RECURRENCES.includes(recurrenceRaw)) return { error: "Geçersiz tekrar periyodu." };

  const references = await validateTenantReferences(gate.tenantId, {
    profileId: assignedTo || null,
  });
  if (!references.ok) return { error: references.error };

  const supabase = await createClient();
  // Sistem görevinin türü değişmez, normal görev sistem türüne çevrilemez (kaldırma görevi tür değiştirerek kapatılamaz).
  const { data: current } = await supabase.from("tasks").select("kind").eq("id", id).eq("tenant_id", gate.tenantId).maybeSingle();
  if (!current) return { error: "Görev bulunamadı." };
  const currentKind = String((current as { kind: string }).kind);
  if (kind !== currentKind && (SYSTEM_KINDS.includes(currentKind) || SYSTEM_KINDS.includes(kind))) {
    return { error: "Bu görevin türü değiştirilemez: EİDS görevleri sistem tarafından açılır." };
  }
  if (dealField) {
    const { data: ownDeal } = await supabase
      .from("deals")
      .select("id")
      .eq("id", dealField)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (!ownDeal) return { error: "Anlaşma bulunamadı." };
  }
  const { error } = await supabase
    .from("tasks")
    .update({
      title,
      notes: notes || null,
      kind,
      priority,
      due_at: dueRaw ? (parseTrLocalDateTime(dueRaw)?.toISOString() ?? null) : null,
      // Termin silinirse tekrar da düşer (terminsiz tekrar anlamsız).
      recurrence: dueRaw && recurrenceRaw ? recurrenceRaw : null,
      ...(assignedTo ? { assigned_to: assignedTo } : {}),
      ...(dealField !== undefined ? { deal_id: dealField || null } : {}),
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("updateTask", error);
    return { error: actionErrorMessage(error, "Görev güncellenemedi.") };
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
  if (dealField) revalidatePath(`/app/anlasmalar/${dealField}`);
  return { ok: true, id };
}

const REMINDER_DAYS = [1, 3, 7, 14];

/**
 * Tek tık hatırlatıcı (talep/müşteri detayı): N gün sonra 09:00'da (TR) vadeli takip
 * görevi açar, kullanıcıya atanır. Saat sunucuda hesaplanır (istemci saatine güvenilmez).
 */
export async function createFollowupReminder(input: {
  customerId: string;
  title: string;
  days: number;
  dealId?: string | null;
}): Promise<TaskResult> {
  const gate = await requirePermission("tasks", "create");
  if (!gate.ok) return { error: gate.error };
  const days = Number(input?.days);
  if (!REMINDER_DAYS.includes(days)) return { error: "Geçersiz hatırlatma süresi." };
  const title = String(input?.title ?? "").trim().slice(0, 200);
  if (!title) return { error: "Hatırlatma başlığı zorunlu." };
  const customerId = String(input?.customerId ?? "").trim();
  const references = await validateTenantReferences(gate.tenantId, { customerId: customerId || null });
  if (!references.ok) return { error: references.error };

  const supabase = await createClient();
  const dealId = String(input?.dealId ?? "").trim();
  if (dealId) {
    const { data: ownDeal } = await supabase.from("deals").select("id").eq("id", dealId).eq("tenant_id", gate.tenantId).maybeSingle();
    if (!ownDeal) return { error: "Anlaşma bulunamadı." };
  }
  // TR gün başı + N gün + 09:00 (UTC+3 → 06:00Z)
  const dueAt = new Date(trDayStartMs(now()) + days * DAY_MS + 9 * 3_600_000).toISOString();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      tenant_id: gate.tenantId,
      title,
      kind: "followup",
      priority: "normal",
      status: "open",
      due_at: dueAt,
      assigned_to: gate.userId,
      customer_id: customerId || null,
      deal_id: dealId || null,
      created_by: gate.userId,
    })
    .select("id")
    .single();
  if (error) {
    console.error("createFollowupReminder", error);
    return { error: actionErrorMessage(error, "Hatırlatma oluşturulamadı.") };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "task.create",
    entityType: "task",
    entityId: data.id,
    newValue: { title, kind: "followup", reminder_days: days },
  });
  revalidatePath("/app/gorevler");
  if (customerId) revalidatePath(`/app/musteriler/${customerId}`);
  return { ok: true, id: data.id };
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
    .select("id, title, notes, kind, priority, status, due_at, assigned_to, customer_id, property_id, deal_id, recurrence, recurrence_parent_id")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  // Kaldırma görevi yalnız kontrol listesinden kapanır (/app/gorevler/eids/<id>).
  if (task?.kind === "eids_takedown") return { nextDueAt: null };

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
export async function completeTasksBulk(formData: FormData): Promise<ActionOutcome> {
  const gate = await requirePermission("tasks", "edit");
  if (!gate.ok) return { error: gate.error };

  const ids = [...new Set(formData.getAll("ids").map((v) => String(v).trim()).filter(Boolean))].slice(0, 200);
  if (ids.length === 0) return { error: "Görev seçin." };

  const supabase = await createClient();
  // Tekrarlı satırları tamamlamadan ÖNCE oku (kopyalanacak alanlar).
  const { data: recurring } = await supabase
    .from("tasks")
    .select("id, title, notes, kind, priority, status, due_at, assigned_to, customer_id, property_id, deal_id, recurrence, recurrence_parent_id")
    .in("id", ids)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "open")
    .not("recurrence", "is", null);

  const { error } = await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .in("id", ids)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "open")
    // Kaldırma görevi toplu tamamlanmaz: bekleyen kalemli tek görev tüm seçimi DB tetiğinde düşürürdü.
    .neq("kind", "eids_takedown");

  if (error) {
    console.error("completeTasksBulk", error);
    return { error: actionErrorMessage(error, "Görevler tamamlanamadı.") };
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
  return { ok: true };
}

const BULK_ASSIGN_LIMIT = 200;

export type BulkAssignTasksResult = { ok?: boolean; error?: string; updatedCount?: number };

/**
 * Toplu sorumlu değiştirme (bkz. `bulkAssignCustomers` deseni): seçili AÇIK görevler aynı ekip üyesine devredilir.
 * Kapı `tasks.edit` (tekil `updateTask` ile aynı); kimlikler ofis süzgecinden geçer; hedef bu ofisin AKTİF üyesi
 * olmalı. Tek denetim kaydı (`task.reassign`, toplu temsil) ve el değiştiren görev varsa hedefe tek seferlik bildirim.
 */
export async function bulkAssignTasks(ids: string[], assignedTo: string): Promise<BulkAssignTasksResult> {
  const gate = await requirePermission("tasks", "edit");
  if (!gate.ok) return { error: gate.error };
  const list = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id).trim()).filter(Boolean))];
  if (!list.length) return { error: "Görev seçilmedi." };
  if (list.length > BULK_ASSIGN_LIMIT) return { error: `Tek seferde en fazla ${BULK_ASSIGN_LIMIT} görev güncellenebilir.` };
  const target = String(assignedTo ?? "").trim();
  if (!target) return { error: "Sorumlu seçin." };

  const supabase = await createClient();
  const [targetRes, beforeRes] = await Promise.all([
    supabase.from("profiles").select("id").eq("id", target).eq("tenant_id", gate.tenantId).eq("is_active", true).maybeSingle(),
    supabase.from("tasks").select("id, assigned_to").in("id", list).eq("tenant_id", gate.tenantId).eq("status", "open"),
  ]);
  if (!targetRes.data) return { error: "Seçilen ekip üyesi bu ofiste aktif değil." };
  const previous = (beforeRes.data ?? []) as { id: string; assigned_to: string | null }[];
  const validIds = previous.map((t) => t.id);
  if (!validIds.length) return { error: "Güncellenecek açık görev bulunamadı." };
  const movedCount = previous.filter((t) => (t.assigned_to ?? "") !== target).length;

  const { error } = await supabase
    .from("tasks")
    .update({ assigned_to: target })
    .in("id", validIds)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("bulkAssignTasks", error);
    return { error: actionErrorMessage(error, "Sorumlu değiştirilemedi.") };
  }
  if (target !== gate.userId && movedCount > 0) {
    await notifyAssignment({
      tenantId: gate.tenantId,
      userId: target,
      title: movedCount === 1 ? "Size 1 görev devredildi" : `Size ${movedCount} görev devredildi`,
      body: "Toplu atama ile görevler size devredildi. Görev listenizi açıp terminleri kontrol edin.",
      href: "/app/gorevler",
      dedupeKey: `task-bulk-assign:${target}:${idsDigest(validIds)}:${trDayKey()}`,
    });
  }
  afterSafe(() => logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "task.reassign",
    entityType: "task",
    oldValue: { previous },
    newValue: { ids: validIds, assigned_to: target, count: validIds.length, bulk: true },
  }));

  revalidatePath("/app/gorevler");
  return { ok: true, updatedCount: validIds.length };
}

export async function reopenTask(formData: FormData): Promise<ActionOutcome> {
  const gate = await requirePermission("tasks", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Görev bulunamadı." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ status: "open", completed_at: null })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: actionErrorMessage(error, "Görev yeniden açılamadı.") };
  revalidatePath("/app/gorevler");
  return { ok: true };
}

export async function deleteTask(formData: FormData): Promise<TaskResult> {
  const gate = await requirePermission("tasks", "delete");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Görev bulunamadı." };

  const supabase = await createClient();
  // Kaldırma görevi yasal yükümlülüktür: silinemez (kontrol listesiyle kapanır ya da yetki geri gelince iptal edilir).
  const { data: current } = await supabase.from("tasks").select("kind").eq("id", id).eq("tenant_id", gate.tenantId).maybeSingle();
  if ((current as { kind?: string } | null)?.kind === "eids_takedown") {
    return { error: "İlan kaldırma görevi silinemez. Kontrol listesindeki kalemleri işaretleyerek kapatın." };
  }
  const { data, error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("deleteTask", error);
    return { error: actionErrorMessage(error, "Görev silinemedi. Lütfen tekrar deneyin.") };
  }
  if (!data) return { error: "Görev bulunamadı veya silme yetkiniz yok." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "task.delete",
    entityType: "task",
    entityId: id,
  });
  revalidatePath("/app/gorevler");
  return { ok: true, id };
}

export type RescheduleTasksResult = { ok?: boolean; error?: string; updatedCount?: number; dueAt?: string | null };

/**
 * GA-04 / GA-10 / GA-05: açık görevlerin vadesini hazır seçenekle taşır ("Yarın 10:00", "Pazartesi 10:00", "+1 hafta",
 * "Bugün 18:00"). Toplu çubuk, mobil kaydırma "Yarın" ve arama kuyruğu "Atla (yarın)" AYNI eylemi kullanır.
 * Saat sunucuda hesaplanır (istemci saatine güvenilmez); "+1 hafta" her görevin kendi vadesinden yürür.
 */
export async function rescheduleTasks(ids: string[], preset: DuePreset): Promise<RescheduleTasksResult> {
  const gate = await requirePermission("tasks", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isDuePreset(preset)) return { error: "Geçersiz vade seçeneği." };
  const list = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id).trim()).filter(Boolean))];
  if (!list.length) return { error: "Görev seçilmedi." };
  if (list.length > BULK_ASSIGN_LIMIT) return { error: `Tek seferde en fazla ${BULK_ASSIGN_LIMIT} görev güncellenebilir.` };

  const supabase = await createClient();
  const { data: rows, error: readError } = await supabase
    .from("tasks")
    .select("id, due_at")
    .in("id", list)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "open");
  if (readError) return { error: actionErrorMessage(readError, "Görevler okunamadı.") };
  const nowMs = now();
  const byDue = new Map<string, string[]>();
  for (const r of (rows ?? []) as { id: string; due_at: string | null }[]) {
    const ms = duePresetMs(preset, nowMs, r.due_at ? Date.parse(r.due_at) : null);
    if (ms == null) continue;
    const iso = new Date(ms).toISOString();
    byDue.set(iso, [...(byDue.get(iso) ?? []), r.id]);
  }
  if (byDue.size === 0) {
    return { error: preset === "today18" && duePresetMs("today18", nowMs) == null ? "Bugün 18:00 geçti; başka bir seçenek seçin." : "Taşınacak açık görev bulunamadı." };
  }

  let updatedCount = 0;
  for (const [dueAt, group] of byDue) {
    const { error } = await supabase.from("tasks").update({ due_at: dueAt }).in("id", group).eq("tenant_id", gate.tenantId).eq("status", "open");
    if (error) {
      console.error("rescheduleTasks", error);
      return { error: actionErrorMessage(error, "Vade taşınamadı.") };
    }
    updatedCount += group.length;
  }
  afterSafe(() =>
    logActivity({
      tenantId: gate.tenantId,
      actorId: gate.userId,
      action: "task.reschedule",
      entityType: "task",
      ...(updatedCount === 1 ? { entityId: [...byDue.values()][0]![0] } : {}),
      newValue: { ids: [...byDue.values()].flat(), preset, count: updatedCount },
    }),
  );
  revalidatePath("/app/gorevler");
  revalidatePath("/app");
  return { ok: true, updatedCount, dueAt: byDue.size === 1 ? [...byDue.keys()][0]! : null };
}

export type SettleCallTasksResult = {
  ok?: boolean;
  error?: string;
  /** Kapatılan açık arama görevi sayısı ("Ulaşıldı"). */
  closed?: number;
  /** "Geri ara": mevcut açık arama görevinin vadesi taşındı (yenisi açılmadı). */
  moved?: boolean;
  /** "Geri ara": açık görev yoktu, yenisi açıldı. */
  created?: boolean;
};

/**
 * GA-05: görüşme sonucu müşterinin AÇIK arama görevlerini yönetir (tek kuyruk kuralı).
 *  - reached: müşterinin açık `call` görevleri tamamlanır (tekrarlı olanın sonraki kopyası üretilir).
 *  - callback: açık arama görevi varsa EN ESKİ vadeli olanın vadesi taşınır (görev birikmez); yoksa yenisi açılır.
 *  - unreached: görev açık kalır (hâlâ aranacak).
 */
export async function settleCustomerCallTasks(input: {
  customerId: string;
  outcome: "reached" | "unreached" | "callback";
  /** callback: "YYYY-MM-DDTHH:mm" (TR). */
  dueLocal?: string;
  title?: string;
  notes?: string;
}): Promise<SettleCallTasksResult> {
  const customerId = String(input?.customerId ?? "").trim();
  if (!customerId) return { error: "Müşteri bulunamadı." };
  const outcome = input?.outcome;
  if (outcome === "unreached") return { ok: true, closed: 0 };
  if (outcome !== "reached" && outcome !== "callback") return { error: "Geçersiz sonuç." };

  const gate = await requirePermission("tasks", outcome === "reached" ? "edit" : "create");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const { data: open, error: readError } = await supabase
    .from("tasks")
    .select("id, title, notes, kind, priority, status, due_at, assigned_to, customer_id, property_id, deal_id, recurrence, recurrence_parent_id")
    .eq("tenant_id", gate.tenantId)
    .eq("customer_id", customerId)
    .eq("kind", "call")
    .eq("status", "open")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(50);
  if (readError) return { error: actionErrorMessage(readError, "Arama görevleri okunamadı.") };
  const tasks = (open ?? []) as RecurringSource[];

  if (outcome === "reached") {
    if (tasks.length === 0) return { ok: true, closed: 0 };
    const ids = tasks.map((t) => t.id);
    const { data: closedRows, error } = await supabase
      .from("tasks")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .in("id", ids)
      .eq("tenant_id", gate.tenantId)
      .eq("status", "open")
      .select("id");
    if (error) return { error: actionErrorMessage(error, "Arama görevleri kapatılamadı.") };
    for (const t of tasks) await spawnNextRecurring(supabase, gate.tenantId, gate.userId, t);
    const closed = (closedRows ?? []).length;
    afterSafe(() =>
      logActivity({
        tenantId: gate.tenantId,
        actorId: gate.userId,
        action: "task.complete_bulk",
        entityType: "task",
        newValue: { count: closed, source: "contact_outcome", customer_id: customerId },
      }),
    );
    revalidatePath("/app/gorevler");
    revalidatePath("/app/arama-listesi");
    return { ok: true, closed };
  }

  const due = parseTrLocalDateTime(String(input.dueLocal ?? ""));
  if (!due) return { error: "Geri arama zamanı geçersiz." };
  const first = tasks[0];
  if (first) {
    const note = String(input.notes ?? "").trim();
    const { error } = await supabase
      .from("tasks")
      .update({
        due_at: due.toISOString(),
        ...(note ? { notes: [first.notes, note].filter(Boolean).join("\n").slice(0, 4000) } : {}),
      })
      .eq("id", first.id)
      .eq("tenant_id", gate.tenantId);
    if (error) return { error: actionErrorMessage(error, "Geri arama görevi güncellenemedi.") };
    revalidatePath("/app/gorevler");
    revalidatePath("/app/arama-listesi");
    return { ok: true, moved: true };
  }
  const fd = new FormData();
  fd.set("title", String(input.title ?? "Geri ara").slice(0, 200));
  fd.set("kind", "call");
  fd.set("priority", "normal");
  fd.set("customer_id", customerId);
  fd.set("due_at", String(input.dueLocal));
  if (input.notes) fd.set("notes", String(input.notes));
  const res = await createTask({}, fd);
  if (res.error) return { error: res.error };
  revalidatePath("/app/arama-listesi");
  return { ok: true, created: true };
}
