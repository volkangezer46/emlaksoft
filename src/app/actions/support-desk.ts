"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { checkRateLimit } from "@/lib/rate-limit";
import { logPlatformActivity } from "@/lib/platform-activity";
import { notifyPlatformStaff } from "@/lib/platform-notify";
import { actionErrorMessage } from "@/lib/action-errors";
import { clockToMinutes } from "@/lib/support/business-hours";
import { isMissingRelationError } from "@/lib/support/desk-data";
import { parseMacroActions, parseTagList } from "@/lib/support/macro-template";
import { parseSlaMatrixForm } from "@/lib/support/sla-policy";
import { isTicketPriority, isUuid, validateTicketCategory } from "@/lib/support/ticket-contract";

/**
 * Destek masası 2.0 (AD9) server action'ları. Hepsi `requirePlatformModule("tickets")` kapısından geçer;
 * SLA/iş saati/atama kuralı yazımı yalnız süper admin ve operasyon içindir (DESK_MANAGER_ROLES).
 */
export type DeskActionResult = { ok?: boolean; error?: string; tags?: string[]; applied?: string[] };

const DESK_MANAGER_ROLES = ["super_admin", "ops"];
const NOT_INSTALLED = "Destek masası tabloları henüz kurulmadı (migration 20261013004800 bekliyor).";

async function rate(staffId: string, op: string, limit = 60): Promise<string | null> {
  const r = await checkRateLimit(`support-desk:${op}:${staffId}`, { limit, windowSec: 300, failurePolicy: "deny" });
  return r.allowed ? null : "Çok sık işlem yapıldı. Lütfen kısa bir süre sonra yeniden deneyin.";
}

function dbError(error: { code?: string; message?: string } | null, fallback: string): string {
  if (isMissingRelationError(error)) return NOT_INSTALLED;
  return actionErrorMessage(error, fallback);
}

function revalidateDesk() {
  revalidatePath("/admin/tickets/ayarlar");
  revalidatePath("/admin/tickets/raporlar");
}

async function requireDeskManager() {
  const staff = await requirePlatformModule("tickets");
  return { staff, denied: DESK_MANAGER_ROLES.includes(staff.role) ? null : "Destek ayarlarını yalnız süper admin ve operasyon değiştirebilir." };
}

/** SLA matrisi: '*' satırları güncellenir, plana özel satırlar girilenle eşitlenir (boş bırakılan silinir). */
export async function saveSlaMatrix(formData: FormData): Promise<DeskActionResult> {
  const { staff, denied } = await requireDeskManager();
  if (denied) return { error: denied };
  const rl = await rate(staff.id, "sla", 20);
  if (rl) return { error: rl };
  const parsed = parseSlaMatrixForm((name) => String(formData.get(name) ?? ""));
  if (parsed.error) return { error: parsed.error };

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const rows = parsed.entries.map((e) => ({
    plan: e.plan,
    priority: e.priority,
    first_response_minutes: e.firstResponseMinutes,
    resolution_minutes: e.resolutionMinutes,
    updated_by: staff.id,
    updated_at: now,
  }));
  const { error } = await admin.from("support_sla_policies").upsert(rows, { onConflict: "plan,priority" });
  if (error) return { error: dbError(error, "Yanıt süresi hedefleri kaydedilemedi.") };

  const keep = new Set(rows.map((r) => `${r.plan}:${r.priority}`));
  const { data: existing, error: listError } = await admin.from("support_sla_policies").select("id, plan, priority").neq("plan", "*");
  if (listError) return { error: dbError(listError, "Yanıt süresi hedefleri kaydedilemedi.") };
  const stale = (existing ?? []).filter((r) => !keep.has(`${r.plan}:${r.priority}`)).map((r) => r.id);
  if (stale.length) {
    const { error: delError } = await admin.from("support_sla_policies").delete().in("id", stale);
    if (delError) return { error: dbError(delError, "Eski plan satırları silinemedi.") };
  }
  await logPlatformActivity({ actorId: staff.id, action: "support.sla.update", entityType: "support_sla_policies", entityId: null, meta: { rows: rows.length } });
  revalidateDesk();
  return { ok: true };
}

/** İş saatleri: her gün için `open:<gün>` (on), `start:<gün>`, `end:<gün>` ("09:00"). */
export async function saveBusinessHours(formData: FormData): Promise<DeskActionResult> {
  const { staff, denied } = await requireDeskManager();
  if (denied) return { error: denied };
  const rl = await rate(staff.id, "hours", 20);
  if (rl) return { error: rl };
  const now = new Date().toISOString();
  const rows: { weekday: number; is_open: boolean; open_minute: number; close_minute: number; updated_by: string; updated_at: string }[] = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const isOpen = formData.get(`open:${weekday}`) === "on";
    const start = clockToMinutes(String(formData.get(`start:${weekday}`) ?? "09:00"));
    const end = clockToMinutes(String(formData.get(`end:${weekday}`) ?? "18:00"));
    if (start == null || end == null || start >= 1440 || end <= start) {
      return { error: "Her gün için başlangıç saati bitişten önce olmalı (ör. 09:00 - 18:00)." };
    }
    rows.push({ weekday, is_open: isOpen, open_minute: start, close_minute: end, updated_by: staff.id, updated_at: now });
  }
  if (!rows.some((r) => r.is_open)) return { error: "En az bir çalışma günü açık olmalı." };
  const admin = createAdminClient();
  const { error } = await admin.from("support_business_hours").upsert(rows, { onConflict: "weekday" });
  if (error) return { error: dbError(error, "İş saatleri kaydedilemedi.") };
  await logPlatformActivity({ actorId: staff.id, action: "support.hours.update", entityType: "support_business_hours", entityId: null });
  revalidateDesk();
  return { ok: true };
}

export async function addSupportHoliday(formData: FormData): Promise<DeskActionResult> {
  const { staff, denied } = await requireDeskManager();
  if (denied) return { error: denied };
  const day = String(formData.get("day") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return { error: "Geçerli bir tarih seçin." };
  if (label.length < 1 || label.length > 80) return { error: "Tatil adı 1-80 karakter olmalı." };
  const admin = createAdminClient();
  const { error } = await admin.from("support_holidays").upsert({ day, label, created_by: staff.id }, { onConflict: "day" });
  if (error) return { error: dbError(error, "Tatil eklenemedi.") };
  await logPlatformActivity({ actorId: staff.id, action: "support.holiday.add", entityType: "support_holidays", entityId: null, meta: { day } });
  revalidateDesk();
  return { ok: true };
}

export async function deleteSupportHoliday(formData: FormData): Promise<DeskActionResult> {
  const { staff, denied } = await requireDeskManager();
  if (denied) return { error: denied };
  const day = String(formData.get("day") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: "Tatil bulunamadı." };
  const admin = createAdminClient();
  const { error } = await admin.from("support_holidays").delete().eq("day", day);
  if (error) return { error: dbError(error, "Tatil silinemedi.") };
  await logPlatformActivity({ actorId: staff.id, action: "support.holiday.delete", entityType: "support_holidays", entityId: null, meta: { day } });
  revalidateDesk();
  return { ok: true };
}

/** Atama kuralı ekle/güncelle: category (* = tümü), target_role (boş = rol şartı yok), staff_ids[], sort_order, is_active. */
export async function saveAssignmentRule(formData: FormData): Promise<DeskActionResult> {
  const { staff, denied } = await requireDeskManager();
  if (denied) return { error: denied };
  const rl = await rate(staff.id, "rule", 40);
  if (rl) return { error: rl };
  const id = String(formData.get("id") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const targetRole = String(formData.get("target_role") ?? "").trim();
  const staffIds = [...new Set(formData.getAll("staff_ids").map(String).map((s) => s.trim()).filter(Boolean))];
  const sortOrder = Number.parseInt(String(formData.get("sort_order") ?? "100"), 10);
  const isActive = formData.get("is_active") === "on";
  if (id && !isUuid(id)) return { error: "Kural bulunamadı." };
  if (category !== "*" && validateTicketCategory(category)) return { error: "Geçerli bir kategori seçin." };
  if (targetRole && !["super_admin", "ops", "support", "billing"].includes(targetRole)) return { error: "Geçersiz rol." };
  if (staffIds.some((s) => !isUuid(s)) || staffIds.length > 50) return { error: "Geçersiz personel seçimi." };
  if (!targetRole && staffIds.length === 0) return { error: "Bir rol ya da en az bir personel seçin." };
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10_000) return { error: "Sıra 0-10000 arasında olmalı." };

  const admin = createAdminClient();
  const row = {
    category,
    target_role: targetRole || null,
    target_staff_ids: staffIds,
    sort_order: sortOrder,
    is_active: isActive,
    updated_at: new Date().toISOString(),
  };
  const { error } = id
    ? await admin.from("support_assignment_rules").update(row).eq("id", id)
    : await admin.from("support_assignment_rules").insert({ ...row, created_by: staff.id });
  if (error) return { error: dbError(error, "Atama kuralı kaydedilemedi.") };
  await logPlatformActivity({ actorId: staff.id, action: id ? "support.rule.update" : "support.rule.create", entityType: "support_assignment_rules", entityId: id || null, meta: { category } });
  revalidateDesk();
  return { ok: true };
}

export async function deleteAssignmentRule(formData: FormData): Promise<DeskActionResult> {
  const { staff, denied } = await requireDeskManager();
  if (denied) return { error: denied };
  const id = String(formData.get("id") ?? "").trim();
  if (!isUuid(id)) return { error: "Kural bulunamadı." };
  const admin = createAdminClient();
  const { error } = await admin.from("support_assignment_rules").delete().eq("id", id);
  if (error) return { error: dbError(error, "Atama kuralı silinemedi.") };
  await logPlatformActivity({ actorId: staff.id, action: "support.rule.delete", entityType: "support_assignment_rules", entityId: id });
  revalidateDesk();
  return { ok: true };
}

/** Personel izin durumu: yönetici herkes için, personel kendisi için değiştirebilir. */
export async function setStaffAvailability(formData: FormData): Promise<DeskActionResult> {
  const staff = await requirePlatformModule("tickets");
  const staffId = String(formData.get("staff_id") ?? "").trim();
  if (!isUuid(staffId)) return { error: "Personel bulunamadı." };
  if (staffId !== staff.id && !DESK_MANAGER_ROLES.includes(staff.role)) return { error: "Yalnız kendi izin durumunuzu değiştirebilirsiniz." };
  const rl = await rate(staff.id, "availability", 40);
  if (rl) return { error: rl };
  const isAway = formData.get("is_away") === "on";
  const until = String(formData.get("away_until") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim().slice(0, 200);
  let awayUntil: string | null = null;
  if (isAway && until) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return { error: "Geçerli bir dönüş tarihi seçin." };
    // Dönüş günü İstanbul saatiyle 00:00'da (UTC+3) atamaya açılır.
    awayUntil = new Date(`${until}T00:00:00+03:00`).toISOString();
  }
  const admin = createAdminClient();
  const { error } = await admin.from("support_staff_availability").upsert(
    { staff_id: staffId, is_away: isAway, away_until: awayUntil, note: note || null, updated_by: staff.id, updated_at: new Date().toISOString() },
    { onConflict: "staff_id" },
  );
  if (error) return { error: dbError(error, "İzin durumu kaydedilemedi.") };
  await logPlatformActivity({ actorId: staff.id, action: "support.availability.update", entityType: "platform_staff", entityId: staffId, meta: { is_away: isAway } });
  revalidateDesk();
  return { ok: true };
}

/** Bilet etiketleri: `add` ve `remove` virgüllü liste. */
export async function updateTicketTags(formData: FormData): Promise<DeskActionResult> {
  const staff = await requirePlatformModule("tickets");
  const id = String(formData.get("id") ?? "").trim();
  if (!isUuid(id)) return { error: "Destek talebi bulunamadı." };
  const add = parseTagList(String(formData.get("add") ?? ""));
  const remove = parseTagList(String(formData.get("remove") ?? ""));
  if (add.length === 0 && remove.length === 0) return { error: "Etiket girin (harf veya rakamla başlamalı, en çok 32 karakter)." };
  const rl = await rate(staff.id, "tags", 120);
  if (rl) return { error: rl };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("support_update_ticket_tags", { p_ticket_id: id, p_actor_id: staff.id, p_add: add, p_remove: remove });
  if (error) {
    if (error.message?.includes("Too many tags")) return { error: "Bir talepte en çok 10 etiket olabilir." };
    if (error.code === "PGRST202") return { error: NOT_INSTALLED };
    return { error: dbError(error, "Etiketler güncellenemedi.") };
  }
  revalidatePath(`/admin/tickets/${id}`);
  revalidatePath("/admin/tickets");
  const tags = (data as { tags?: string[] } | null)?.tags ?? [];
  return { ok: true, tags };
}

/**
 * Makro eylemlerini uygular (yanıt gönderildikten sonra): durum, öncelik, atama, etiket + kullanım sayacı.
 * Her eylem kendi RPC'siyle (geçiş kuralları ve olay kaydı DB'de); biri başarısızsa diğerleri yine denenir.
 */
export async function applyTicketMacroActions(formData: FormData): Promise<DeskActionResult> {
  const staff = await requirePlatformModule("tickets");
  const ticketId = String(formData.get("id") ?? "").trim();
  const macroId = String(formData.get("macro_id") ?? "").trim();
  if (!isUuid(ticketId) || !isUuid(macroId)) return { error: "Makro veya talep bulunamadı." };
  const rl = await rate(staff.id, "macro-apply", 120);
  if (rl) return { error: rl };

  const admin = createAdminClient();
  const { data: macro, error: macroError } = await admin.from("ticket_macros").select("id, actions_json").eq("id", macroId).maybeSingle();
  if (macroError) {
    if (isMissingRelationError(macroError)) return { ok: true, applied: [] };
    return { error: dbError(macroError, "Makro okunamadı.") };
  }
  if (!macro) return { error: "Makro bulunamadı." };
  const actions = parseMacroActions((macro as { actions_json?: unknown }).actions_json);
  const applied: string[] = [];
  const failures: string[] = [];

  if (actions.status) {
    const { error } = await admin.rpc("transition_support_ticket_v2", {
      p_ticket_id: ticketId,
      p_tenant_id: null,
      p_actor_id: staff.id,
      p_actor_kind: "staff",
      p_status: actions.status,
      p_resolution_code: null,
      p_resolution_summary: null,
      p_expected_version: null,
    });
    if (error) failures.push("durum");
    else applied.push("durum");
  }
  if (actions.priority && isTicketPriority(actions.priority)) {
    const { error } = await admin.rpc("admin_update_support_ticket_v2", {
      p_ticket_id: ticketId,
      p_actor_id: staff.id,
      p_field: "priority",
      p_value: actions.priority,
      p_expected_version: null,
    });
    if (error) failures.push("öncelik");
    else applied.push("öncelik");
  }
  if (actions.assign) {
    const assignee = actions.assign === "me" ? staff.id : actions.assign === "none" ? "" : actions.assign;
    const { error } = await admin.rpc("admin_update_support_ticket_v2", {
      p_ticket_id: ticketId,
      p_actor_id: staff.id,
      p_field: "assigned_staff_id",
      p_value: assignee,
      p_expected_version: null,
    });
    if (error) failures.push("atama");
    else {
      applied.push("atama");
      if (assignee && assignee !== staff.id) {
        await notifyPlatformStaff({
          staffId: assignee,
          title: "Yeni destek talebi atandı",
          body: "Destek kuyruğunuzda yeni bir sorumluluk var.",
          href: `/admin/tickets/${ticketId}`,
          kind: "info",
          roles: ["super_admin", "ops", "support", "billing"],
          meta: { ticket_id: ticketId },
        });
      }
    }
  }
  if (actions.addTags?.length) {
    const { error } = await admin.rpc("support_update_ticket_tags", { p_ticket_id: ticketId, p_actor_id: staff.id, p_add: actions.addTags, p_remove: [] });
    if (error) failures.push("etiket");
    else applied.push("etiket");
  }
  const { error: countError } = await admin.rpc("support_macro_used", { p_macro_id: macroId });
  if (countError && countError.code !== "PGRST202") console.error("support_macro_used", { code: countError.code });

  revalidatePath(`/admin/tickets/${ticketId}`);
  revalidatePath("/admin/tickets");
  revalidatePath("/admin/tickets/makrolar");
  if (failures.length) return { error: `Yanıt gönderildi; makro eylemlerinden bazıları uygulanamadı: ${failures.join(", ")}.`, applied };
  return { ok: true, applied };
}
