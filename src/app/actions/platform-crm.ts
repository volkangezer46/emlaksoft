"use server";

import { revalidatePath } from "next/cache";
import { updateTenantPlanStatus } from "@/app/actions/platform";
import { extendTrial } from "@/app/actions/platform-trial";
import { officeAdminCan } from "@/lib/admin/office-admin-access";
import {
  ADMIN_VIEW_PARAMS,
  cleanTagName,
  isCrmMissing,
  isLifecycleStage,
  isNoteCategory,
  isTagColor,
  sanitizeViewParams,
  type AdminSavedView,
} from "@/lib/admin/platform-crm";
import { canChangeTrial } from "@/lib/billing/admin-billing-fixes";
import { now, parseTrLocalDateTime } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import type { PlatformRole } from "@/lib/platform-access";
import { logPlatformActivity } from "@/lib/platform-activity";
import { notifyPlatformStaff } from "@/lib/platform-notify";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * OFİS CRM eylemleri (AD5): etiket tanımları, ofis etiketleri, sorumlu personel (CSM), yaşam döngüsü aşaması,
 * yapılandırılmış notlar, takip görevleri, toplu işlemler ve admin kayıtlı görünümleri.
 *
 * Kapı: her eylem `requirePlatformModule("tenants")`; eylem bazında rol kuralı (etiket TANIMI süper admin + ops;
 * toplu deneme `canChangeTrial`; toplu durum `plan_status`, askı/iptal yalnız süper admin). Ofisin müşteri verisi
 * hiçbir eylemde okunmaz. Her ofis değişikliği `platform_audit_logs`'a (entity_id = ofis) yazılır → Ofis 360 zaman
 * çizelgesinde görünür. Tablolar yoksa (migration bekliyor) anlaşılır hata döner.
 */

export type CrmActionResult = { ok?: boolean; error?: string; message?: string; id?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DENIED = "Bu işlem için yetkiniz yok.";
const NOT_READY = "Ofis CRM kurulumu bekliyor (veritabanı güncellemesi henüz uygulanmadı).";
const BULK_MAX = 100;
const nowIsoOf = () => new Date(now()).toISOString();

const uuid = (v: unknown): string => (typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim() : "");
const text = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};

/** Tek kaynak service_role istemcisi (kapıdan SONRA çağrılır). */
function db() {
  return createAdminClient();
}

function failMessage(err: { code?: string; message?: string } | null, fallback: string): string {
  if (isCrmMissing(err)) return NOT_READY;
  if (err?.code === "23505") return "Bu adla bir kayıt zaten var.";
  return fallback;
}

const canManageTags = (role: PlatformRole) => role === "super_admin" || role === "ops";

function revalidateCrm(tenantId?: string) {
  revalidatePath("/admin/tenants");
  if (tenantId) revalidatePath(`/admin/tenants/${tenantId}`);
}

// ---------------------------------------------------------------------------
// Etiket tanımları (adminden CRUD)
// ---------------------------------------------------------------------------

export async function saveTenantTag(formData: FormData): Promise<CrmActionResult> {
  const staff = await requirePlatformModule("tenants");
  if (!canManageTags(staff.role)) return { error: DENIED };
  const id = uuid(text(formData, "id"));
  const name = cleanTagName(text(formData, "name"));
  const color = text(formData, "color") || "brand";
  if (!name) return { error: "Etiket adı 1-40 karakter olmalı." };
  if (!isTagColor(color)) return { error: "Geçersiz renk." };
  const admin = db();
  const res = id
    ? await admin.from("tenant_tags").update({ name, color, updated_at: nowIsoOf() }).eq("id", id).select("id").maybeSingle()
    : await admin.from("tenant_tags").insert({ name, color, created_by: staff.id }).select("id").single();
  if (res.error || !res.data) return { error: failMessage(res.error, "Etiket kaydedilemedi. Sayfayı yenileyip tekrar deneyin.") };
  await logPlatformActivity({ actorId: staff.id, action: id ? "tenant_tag.update" : "tenant_tag.create", entityType: "tenant_tag", entityId: res.data.id, meta: { name, color } });
  revalidateCrm();
  return { ok: true, id: res.data.id, message: id ? "Etiket güncellendi." : "Etiket oluşturuldu." };
}

export async function deleteTenantTag(formData: FormData): Promise<CrmActionResult> {
  const staff = await requirePlatformModule("tenants");
  if (!canManageTags(staff.role)) return { error: DENIED };
  const id = uuid(text(formData, "id"));
  if (!id) return { error: "Etiket bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  const admin = db();
  const { data, error } = await admin.from("tenant_tags").delete().eq("id", id).select("name");
  if (error) return { error: failMessage(error, "Etiket silinemedi. Sayfayı yenileyip tekrar deneyin.") };
  if (!data || data.length === 0) return { error: "Etiket bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  await logPlatformActivity({ actorId: staff.id, action: "tenant_tag.delete", entityType: "tenant_tag", entityId: id, meta: { name: (data[0] as { name: string }).name } });
  revalidateCrm();
  return { ok: true, message: "Etiket silindi; ofislerden de kaldırıldı." };
}

// ---------------------------------------------------------------------------
// Tek ofis: etiketler, sorumlu, aşama
// ---------------------------------------------------------------------------

async function tenantExists(admin: ReturnType<typeof db>, tenantId: string): Promise<boolean> {
  const { data } = await admin.from("tenants").select("id").eq("id", tenantId).maybeSingle();
  return Boolean(data);
}

export async function setTenantTags(tenantId: string, tagIds: string[]): Promise<CrmActionResult> {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "note")) return { error: DENIED };
  const id = uuid(tenantId);
  if (!id) return { error: "Ofis bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  const wanted = [...new Set((Array.isArray(tagIds) ? tagIds : []).map(uuid).filter(Boolean))].slice(0, 30);
  const admin = db();
  if (!(await tenantExists(admin, id))) return { error: "Ofis bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  const cur = await admin.from("tenant_tag_links").select("tag_id").eq("tenant_id", id);
  if (cur.error) return { error: failMessage(cur.error, "Etiketler okunamadı. Sayfayı yenileyip tekrar deneyin.") };
  const have = new Set(((cur.data ?? []) as { tag_id: string }[]).map((r) => r.tag_id));
  const add = wanted.filter((t) => !have.has(t));
  const remove = [...have].filter((t) => !wanted.includes(t));
  if (add.length) {
    const ins = await admin.from("tenant_tag_links").insert(add.map((tag_id) => ({ tenant_id: id, tag_id, created_by: staff.id })));
    if (ins.error) return { error: failMessage(ins.error, "Etiket eklenemedi (etiket silinmiş olabilir).") };
  }
  if (remove.length) {
    const del = await admin.from("tenant_tag_links").delete().eq("tenant_id", id).in("tag_id", remove);
    if (del.error) return { error: failMessage(del.error, "Etiket kaldırılamadı. Sayfayı yenileyip tekrar deneyin.") };
  }
  if (add.length || remove.length) {
    await logPlatformActivity({ actorId: staff.id, action: "tenant.crm_tags", entityType: "tenant", entityId: id, meta: { added: add, removed: remove } });
  }
  revalidateCrm(id);
  return { ok: true, message: "Etiketler kaydedildi." };
}

/** CRM satırını (yoksa) açar ve verilen alanları yazar. Sağlık alanları bu yoldan YAZILMAZ. */
async function upsertCrm(admin: ReturnType<typeof db>, tenantId: string, patch: Record<string, unknown>, staffId: string) {
  return admin
    .from("platform_tenant_crm")
    .upsert({ tenant_id: tenantId, ...patch, updated_by: staffId, updated_at: nowIsoOf() }, { onConflict: "tenant_id" });
}

export async function setTenantAccountOwner(tenantId: string, ownerStaffId: string | null): Promise<CrmActionResult> {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "note")) return { error: DENIED };
  const id = uuid(tenantId);
  if (!id) return { error: "Ofis bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  const owner = ownerStaffId ? uuid(ownerStaffId) : "";
  if (ownerStaffId && !owner) return { error: "Personel bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  const admin = db();
  const [{ data: tenant }, staffRow] = await Promise.all([
    admin.from("tenants").select("id, name").eq("id", id).maybeSingle(),
    owner ? admin.from("platform_staff").select("id, full_name").eq("id", owner).eq("is_active", true).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!tenant) return { error: "Ofis bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  if (owner && !staffRow.data) return { error: "Personel bulunamadı ya da pasif." };
  const { error } = await upsertCrm(admin, id, { account_owner_staff_id: owner || null }, staff.id);
  if (error) return { error: failMessage(error, "Sorumlu kaydedilemedi. Sayfayı yenileyip tekrar deneyin.") };
  await logPlatformActivity({ actorId: staff.id, action: "tenant.crm_owner", entityType: "tenant", entityId: id, meta: { owner: owner || null } });
  if (owner && owner !== staff.id) {
    await notifyPlatformStaff({
      staffId: owner,
      title: "Ofis sorumluluğu atandı",
      body: `${(tenant as { name: string }).name} ofisinin sorumlusu olarak atandınız.`,
      href: `/admin/tenants/${id}?sekme=iliski`,
      kind: "info",
      meta: { source: "platform_crm", tenant_id: id },
    });
  }
  revalidateCrm(id);
  return { ok: true, message: owner ? "Sorumlu atandı." : "Sorumlu kaldırıldı." };
}

export async function setTenantLifecycleStage(tenantId: string, stage: string | null): Promise<CrmActionResult> {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "note")) return { error: DENIED };
  const id = uuid(tenantId);
  if (!id) return { error: "Ofis bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  if (stage !== null && !isLifecycleStage(stage)) return { error: "Geçersiz aşama." };
  const admin = db();
  if (!(await tenantExists(admin, id))) return { error: "Ofis bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  const { error } = await upsertCrm(admin, id, { lifecycle_stage: stage }, staff.id);
  if (error) return { error: failMessage(error, "Aşama kaydedilemedi. Sayfayı yenileyip tekrar deneyin.") };
  await logPlatformActivity({ actorId: staff.id, action: "tenant.crm_stage", entityType: "tenant", entityId: id, meta: { stage } });
  revalidateCrm(id);
  return { ok: true, message: "Aşama kaydedildi." };
}

// ---------------------------------------------------------------------------
// Notlar (kategori, sabitleme, düzenleme)
// ---------------------------------------------------------------------------

export async function saveTenantCrmNote(formData: FormData): Promise<CrmActionResult> {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "note")) return { error: DENIED };
  const noteId = uuid(text(formData, "id"));
  const tenantId = uuid(text(formData, "tenant_id"));
  const category = text(formData, "category") || "genel";
  const body = text(formData, "body").replace(/\r\n/g, "\n");
  const pinned = text(formData, "pinned") === "1";
  if (!tenantId) return { error: "Ofis bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  if (!isNoteCategory(category)) return { error: "Geçersiz kategori." };
  if (body.length < 3 || body.length > 2000) return { error: "Not 3-2000 karakter olmalı." };
  const admin = db();
  const nowIso = nowIsoOf();
  // Düzenleme silmeyle aynı kural: yalnız yazarı ya da süper admin (başkasının notu sessizce değiştirilemez).
  let editQ = admin.from("platform_tenant_notes").update({ category, body, pinned, edited_by: staff.id, edited_at: nowIso }).eq("id", noteId ?? "").eq("tenant_id", tenantId);
  if (staff.role !== "super_admin") editQ = editQ.eq("author_staff_id", staff.id);
  const res = noteId
    ? await editQ.select("id").maybeSingle()
    : (await tenantExists(admin, tenantId))
      ? await admin.from("platform_tenant_notes").insert({ tenant_id: tenantId, category, body, pinned, author_staff_id: staff.id }).select("id").single()
      : { data: null, error: null };
  if (res.error || !res.data) return { error: res.error ? failMessage(res.error, "Not kaydedilemedi. Sayfayı yenileyip tekrar deneyin.") : noteId ? "Not bulunamadı ya da yalnız yazarı düzenleyebilir." : "Ofis bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  await logPlatformActivity({ actorId: staff.id, action: "tenant.crm_note", entityType: "tenant", entityId: tenantId, meta: { note_id: res.data.id, category, pinned, edit: Boolean(noteId) } });
  revalidateCrm(tenantId);
  return { ok: true, id: res.data.id, message: noteId ? "Not güncellendi." : "Not eklendi." };
}

export async function setTenantCrmNotePinned(noteId: string, pinned: boolean): Promise<CrmActionResult> {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "note")) return { error: DENIED };
  const id = uuid(noteId);
  if (!id) return { error: "Not bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  const admin = db();
  const { data, error } = await admin.from("platform_tenant_notes").update({ pinned: Boolean(pinned) }).eq("id", id).select("tenant_id").maybeSingle();
  if (error || !data) return { error: error ? failMessage(error, "Not güncellenemedi. Sayfayı yenileyip tekrar deneyin.") : "Not bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  const tenantId = (data as { tenant_id: string }).tenant_id;
  // Sabitleme ekip görünümüdür (not içeriği değişmez): not yetkisi olan herkes yapar, ama denetim kaydına düşer.
  await logPlatformActivity({ actorId: staff.id, action: "tenant.crm_note", entityType: "tenant", entityId: tenantId, meta: { note_id: id, pinned: Boolean(pinned) } });
  revalidateCrm(tenantId);
  return { ok: true, message: pinned ? "Not sabitlendi." : "Sabitleme kaldırıldı." };
}

export async function deleteTenantCrmNote(noteId: string): Promise<CrmActionResult> {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "note")) return { error: DENIED };
  const id = uuid(noteId);
  if (!id) return { error: "Not bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  const admin = db();
  // Yalnız yazarı ya da süper admin siler.
  let q = admin.from("platform_tenant_notes").delete().eq("id", id);
  if (staff.role !== "super_admin") q = q.eq("author_staff_id", staff.id);
  const { data, error } = await q.select("tenant_id");
  if (error) return { error: failMessage(error, "Not silinemedi. Sayfayı yenileyip tekrar deneyin.") };
  if (!data || data.length === 0) return { error: "Not bulunamadı ya da yalnız yazarı silebilir." };
  const tenantId = (data[0] as { tenant_id: string }).tenant_id;
  await logPlatformActivity({ actorId: staff.id, action: "tenant.crm_note", entityType: "tenant", entityId: tenantId, meta: { note_id: id, deleted: true } });
  revalidateCrm(tenantId);
  return { ok: true, message: "Not silindi." };
}

// ---------------------------------------------------------------------------
// Takip görevleri (vadesi gelen sorumlunun bildirim kutusuna düşer: gorev-hatirlat cron adımı)
// ---------------------------------------------------------------------------

export async function createPlatformTask(formData: FormData): Promise<CrmActionResult> {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "note")) return { error: DENIED };
  const tenantId = uuid(text(formData, "tenant_id"));
  const title = text(formData, "title");
  const body = text(formData, "body").slice(0, 1000) || null;
  const assignee = uuid(text(formData, "assignee")) || staff.id;
  const dueRaw = text(formData, "due_at");
  const due = dueRaw ? parseTrLocalDateTime(dueRaw) : null;
  if (title.length < 2 || title.length > 160) return { error: "Görev başlığı 2-160 karakter olmalı." };
  if (dueRaw && !due) return { error: "Geçersiz hatırlatma tarihi." };
  const admin = db();
  const [tenantOk, assigneeRow] = await Promise.all([
    tenantId ? tenantExists(admin, tenantId) : Promise.resolve(true),
    admin.from("platform_staff").select("id").eq("id", assignee).eq("is_active", true).maybeSingle(),
  ]);
  if (!tenantOk) return { error: "Ofis bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  if (!assigneeRow.data) return { error: "Sorumlu personel bulunamadı ya da pasif." };
  const { data, error } = await admin
    .from("platform_tasks")
    .insert({ tenant_id: tenantId || null, title, body, assignee_staff_id: assignee, due_at: due ? due.toISOString() : null, created_by: staff.id })
    .select("id")
    .single();
  if (error || !data) return { error: failMessage(error, "Görev kaydedilemedi. Sayfayı yenileyip tekrar deneyin.") };
  if (tenantId) await logPlatformActivity({ actorId: staff.id, action: "tenant.crm_task", entityType: "tenant", entityId: tenantId, meta: { task_id: data.id, title, assignee, due_at: due?.toISOString() ?? null } });
  if (assignee !== staff.id) {
    await notifyPlatformStaff({
      staffId: assignee,
      title: "Size görev atandı",
      body: title,
      href: tenantId ? `/admin/tenants/${tenantId}?sekme=iliski` : "/admin/bildirimler",
      kind: "info",
      meta: { source: "platform_task", task_id: data.id },
    });
  }
  revalidateCrm(tenantId || undefined);
  return { ok: true, id: data.id, message: "Görev oluşturuldu." };
}

export async function setPlatformTaskDone(taskId: string, done: boolean): Promise<CrmActionResult> {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "note")) return { error: DENIED };
  const id = uuid(taskId);
  if (!id) return { error: "Görev bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  const admin = db();
  const nowIso = nowIsoOf();
  const { data, error } = await admin
    .from("platform_tasks")
    .update(done ? { status: "done", done_at: nowIso, updated_at: nowIso } : { status: "open", done_at: null, notified_at: null, updated_at: nowIso })
    .eq("id", id)
    .select("tenant_id, title")
    .maybeSingle();
  if (error || !data) return { error: error ? failMessage(error, "Görev güncellenemedi. Sayfayı yenileyip tekrar deneyin.") : "Görev bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  const t = data as { tenant_id: string | null; title: string };
  if (t.tenant_id) await logPlatformActivity({ actorId: staff.id, action: "tenant.crm_task", entityType: "tenant", entityId: t.tenant_id, meta: { task_id: id, title: t.title, status: done ? "done" : "open" } });
  revalidateCrm(t.tenant_id ?? undefined);
  return { ok: true, message: done ? "Görev tamamlandı." : "Görev yeniden açıldı." };
}

export async function deletePlatformTask(taskId: string): Promise<CrmActionResult> {
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "note")) return { error: DENIED };
  const id = uuid(taskId);
  if (!id) return { error: "Görev bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  const admin = db();
  let q = admin.from("platform_tasks").delete().eq("id", id);
  if (staff.role !== "super_admin") q = q.or(`created_by.eq.${staff.id},assignee_staff_id.eq.${staff.id}`);
  const { data, error } = await q.select("tenant_id, title");
  if (error) return { error: failMessage(error, "Görev silinemedi. Sayfayı yenileyip tekrar deneyin.") };
  if (!data || data.length === 0) return { error: "Görev bulunamadı ya da silme yetkiniz yok." };
  const t = data[0] as { tenant_id: string | null; title: string };
  if (t.tenant_id) await logPlatformActivity({ actorId: staff.id, action: "tenant.crm_task", entityType: "tenant", entityId: t.tenant_id, meta: { task_id: id, title: t.title, deleted: true } });
  revalidateCrm(t.tenant_id ?? undefined);
  return { ok: true, message: "Görev silindi." };
}

// ---------------------------------------------------------------------------
// Toplu işlem (ofis listesi çoklu seçim)
// ---------------------------------------------------------------------------

export type BulkTenantOp =
  | { op: "tag_add"; tagId: string }
  | { op: "tag_remove"; tagId: string }
  | { op: "owner"; staffId: string | null }
  | { op: "trial_extend"; days: number; reason: string }
  | { op: "status"; status: string };

export type BulkTenantResult = { ok?: boolean; error?: string; done: number; failed: { id: string; name: string; error: string }[]; message?: string };

const BULK_STATUSES = new Set(["active", "trial", "past_due", "suspended", "cancelled"]);

export async function bulkTenantAction(tenantIds: string[], action: BulkTenantOp): Promise<BulkTenantResult> {
  const staff = await requirePlatformModule("tenants");
  const ids = [...new Set((Array.isArray(tenantIds) ? tenantIds : []).map(uuid).filter(Boolean))];
  if (ids.length === 0) return { error: "Ofis seçin.", done: 0, failed: [] };
  if (ids.length > BULK_MAX) return { error: `Tek seferde en çok ${BULK_MAX} ofis seçilebilir.`, done: 0, failed: [] };
  const op = action?.op;

  // Rol kapısı işlem türüne göre (UI de aynı kuralla düğmeyi gizler).
  if (op === "trial_extend" && !canChangeTrial(staff.role)) return { error: DENIED, done: 0, failed: [] };
  if (op === "status") {
    const st = (action as { status: string }).status;
    if (!BULK_STATUSES.has(st)) return { error: "Geçersiz durum.", done: 0, failed: [] };
    if (!officeAdminCan(staff.role, "plan_status")) return { error: DENIED, done: 0, failed: [] };
    if ((st === "suspended" || st === "cancelled") && staff.role !== "super_admin") return { error: "Toplu askıya alma/iptal yalnız süper admin.", done: 0, failed: [] };
  }
  if ((op === "tag_add" || op === "tag_remove" || op === "owner") && !officeAdminCan(staff.role, "note")) return { error: DENIED, done: 0, failed: [] };
  if (!op || !["tag_add", "tag_remove", "owner", "trial_extend", "status"].includes(op)) return { error: "Geçersiz işlem.", done: 0, failed: [] };

  const admin = db();
  const { data: tenantRows, error: readError } = await admin.from("tenants").select("id, name, status").in("id", ids);
  if (readError) return { error: "Ofisler okunamadı. Sayfayı yenileyip tekrar deneyin.", done: 0, failed: [] };
  const tenants = (tenantRows ?? []) as { id: string; name: string; status: string }[];
  const nameOf = new Map(tenants.map((t) => [t.id, t.name]));
  const failed: BulkTenantResult["failed"] = ids.filter((id) => !nameOf.has(id)).map((id) => ({ id, name: "—", error: "Ofis bulunamadı. Sayfayı yenileyip tekrar deneyin." }));
  const present = tenants.map((t) => t.id);
  let done = 0;

  if (action.op === "tag_add" || action.op === "tag_remove") {
    const tagId = uuid(action.tagId);
    if (!tagId) return { error: "Etiket seçin.", done: 0, failed: [] };
    const { data: tag, error: tagErr } = await admin.from("tenant_tags").select("id, name").eq("id", tagId).maybeSingle();
    if (tagErr || !tag) return { error: tagErr ? failMessage(tagErr, "Etiket okunamadı. Sayfayı yenileyip tekrar deneyin.") : "Etiket bulunamadı. Sayfayı yenileyip tekrar deneyin.", done: 0, failed: [] };
    const res =
      action.op === "tag_add"
        ? await admin.from("tenant_tag_links").upsert(present.map((tenant_id) => ({ tenant_id, tag_id: tagId, created_by: staff.id })), { onConflict: "tenant_id,tag_id", ignoreDuplicates: true })
        : await admin.from("tenant_tag_links").delete().eq("tag_id", tagId).in("tenant_id", present);
    if (res.error) return { error: failMessage(res.error, "Etiket işlemi yapılamadı. Sayfayı yenileyip tekrar deneyin."), done: 0, failed };
    done = present.length;
    await admin.from("platform_audit_logs").insert(
      present.map((tid) => ({
        actor_id: staff.id,
        action: "tenant.crm_tags",
        entity_type: "tenant",
        entity_id: tid,
        meta: { bulk: true, [action.op === "tag_add" ? "added" : "removed"]: [tagId], tag: (tag as { name: string }).name },
      })),
    );
  } else if (action.op === "owner") {
    const owner = action.staffId ? uuid(action.staffId) : "";
    if (action.staffId && !owner) return { error: "Personel bulunamadı. Sayfayı yenileyip tekrar deneyin.", done: 0, failed: [] };
    if (owner) {
      const { data: s } = await admin.from("platform_staff").select("id").eq("id", owner).eq("is_active", true).maybeSingle();
      if (!s) return { error: "Personel bulunamadı ya da pasif.", done: 0, failed: [] };
    }
    const nowIso = nowIsoOf();
    const res = await admin
      .from("platform_tenant_crm")
      .upsert(present.map((tenant_id) => ({ tenant_id, account_owner_staff_id: owner || null, updated_by: staff.id, updated_at: nowIso })), { onConflict: "tenant_id" });
    if (res.error) return { error: failMessage(res.error, "Sorumlu atanamadı. Sayfayı yenileyip tekrar deneyin."), done: 0, failed };
    done = present.length;
    await admin.from("platform_audit_logs").insert(present.map((tid) => ({ actor_id: staff.id, action: "tenant.crm_owner", entity_type: "tenant", entity_id: tid, meta: { bulk: true, owner: owner || null } })));
    if (owner && owner !== staff.id) {
      await notifyPlatformStaff({
        staffId: owner,
        title: "Ofis sorumluluğu atandı",
        body: `${present.length} ofisin sorumlusu olarak atandınız.`,
        href: `/admin/tenants?sorumlu=${owner}`,
        kind: "info",
        meta: { source: "platform_crm", count: present.length },
      });
    }
  } else if (action.op === "trial_extend") {
    const days = Math.trunc(Number(action.days));
    if (!Number.isFinite(days) || days < 1 || days > 90) return { error: "Gün sayısı 1-90 olmalı.", done: 0, failed: [] };
    // Her ofis mevcut, denetimli tekil yoldan (extendTrial: tenants + deneme aboneliği birlikte, `tenant.trial_change` denetimi).
    // Sıralı: aynı anda çok sayıda yazma açılmaz; 20 ofis birkaç saniyede biter.
    for (const t of tenants) {
      if (t.status !== "trial") {
        failed.push({ id: t.id, name: t.name, error: "Deneme durumunda değil." });
        continue;
      }
      const r = await extendTrial(t.id, { days }, action.reason);
      if (r.ok) done += 1;
      else failed.push({ id: t.id, name: t.name, error: r.error ?? "Uzatılamadı. Sayfayı yenileyip tekrar deneyin." });
    }
  } else if (action.op === "status") {
    for (const t of tenants) {
      if (t.status === action.status) {
        done += 1;
        continue;
      }
      const fd = new FormData();
      fd.set("id", t.id);
      fd.set("status", action.status);
      const r = await updateTenantPlanStatus(fd);
      if (r.ok) done += 1;
      else failed.push({ id: t.id, name: t.name, error: r.error ?? "Durum değiştirilemedi. Sayfayı yenileyip tekrar deneyin." });
    }
  }

  revalidateCrm();
  return {
    ok: true,
    done,
    failed,
    message: failed.length ? `${done} ofiste uygulandı, ${failed.length} ofiste uygulanamadı.` : `${done} ofiste uygulandı.`,
  };
}

// ---------------------------------------------------------------------------
// Kayıtlı görünümler (admin kapsamı; personel bazlı)
// ---------------------------------------------------------------------------

export async function createAdminSavedView(route: string, name: string, params: Record<string, string>): Promise<CrmActionResult & { view?: AdminSavedView }> {
  const staff = await requirePlatformModule("tenants");
  if (!ADMIN_VIEW_PARAMS[route]) return { error: "Bu sayfa için görünüm kaydedilemez." };
  const clean = sanitizeViewParams(route, params) ?? {};
  const n = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!n || n.length > 60) return { error: "Görünüm adı 1-60 karakter olmalı." };
  if (Object.keys(clean).length === 0) return { error: "Kaydedilecek etkin süzgeç yok." };
  const { data, error } = await db().from("admin_saved_views").insert({ staff_id: staff.id, route, name: n, params: clean }).select("id").single();
  if (error || !data) return { error: failMessage(error, "Görünüm kaydedilemedi. Sayfayı yenileyip tekrar deneyin.") };
  revalidatePath(route);
  return { ok: true, view: { id: data.id, name: n, params: clean }, message: "Görünüm kaydedildi." };
}

export async function deleteAdminSavedView(id: string): Promise<CrmActionResult> {
  const staff = await requirePlatformModule("tenants");
  const viewId = uuid(id);
  if (!viewId) return { error: "Görünüm bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  const { data, error } = await db().from("admin_saved_views").delete().eq("id", viewId).eq("staff_id", staff.id).select("route");
  if (error) return { error: failMessage(error, "Görünüm silinemedi. Sayfayı yenileyip tekrar deneyin.") };
  if (!data || data.length === 0) return { error: "Görünüm bulunamadı. Sayfayı yenileyip tekrar deneyin." };
  revalidatePath(String((data[0] as { route: string }).route));
  return { ok: true, message: "Görünüm silindi." };
}
