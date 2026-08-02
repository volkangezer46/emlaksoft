"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { checkRateLimit } from "@/lib/rate-limit";
import { notifyPlatformStaff } from "@/lib/platform-notify";
import { logPlatformActivity } from "@/lib/platform-activity";
import { replyTicketAsStaff } from "@/app/actions/tickets";
import { loadTicketCategoryOptionsForTenant } from "@/lib/support/ticket-category-options";
import {
  TICKET_LIMITS,
  isTicketPriority,
  isTicketStatus,
  isUuid,
  uniqueValidTicketIds,
  validateTicketBody,
  validateTicketCategory,
} from "@/lib/support/ticket-contract";

export type AdminTicketOpsResult = {
  error?: string;
  ok?: boolean;
  updated?: number;
  ticketId?: string;
  messageId?: string;
};

export type TicketCategoryLookupResult = {
  ok?: boolean;
  error?: string;
  options?: { value: string; label: string }[];
};

type AdminMutationPayload = {
  ok: boolean;
  ticketId: string;
  ticketNo?: string;
  tenantId: string;
  assignedStaffId?: string | null;
  subject: string;
};

function revalidateTicketPages(id?: string) {
  revalidatePath("/admin/tickets");
  if (id) revalidatePath(`/admin/tickets/${id}`);
  revalidatePath("/app/destek");
  if (id) revalidatePath(`/app/destek/${id}`);
}

function adminPayload(data: unknown): AdminMutationPayload | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (row.ok !== true || typeof row.ticketId !== "string" || typeof row.tenantId !== "string" || typeof row.subject !== "string") {
    return null;
  }
  return row as unknown as AdminMutationPayload;
}

async function adminRate(staffId: string, operation: string, limit = 100) {
  const result = await checkRateLimit(`ticket-admin:${operation}:${staffId}`, {
    limit,
    windowSec: 300,
    failurePolicy: "deny",
  });
  return result.allowed ? null : "Çok sık işlem yapıldı. Lütfen kısa bir süre sonra yeniden deneyin.";
}

/** Seçilen ofisin global + ofise özel destek kategorilerini güvenli biçimde döndürür. */
export async function getTicketCategoriesForTenant(
  tenantId: string,
): Promise<TicketCategoryLookupResult> {
  const staff = await requirePlatformModule("tickets");
  if (!isUuid(tenantId)) return { error: "Geçerli bir ofis seçin." };

  const rateError = await adminRate(staff.id, "category-lookup", 120);
  if (rateError) return { error: rateError };

  try {
    return {
      ok: true,
      options: await loadTicketCategoryOptionsForTenant(tenantId),
    };
  } catch (error) {
    console.error("ticket category lookup", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return { error: "Ofise ait kategoriler yüklenemedi." };
  }
}

async function updateAdminField(
  staffId: string,
  ticketId: string,
  field: "priority" | "category" | "assigned_staff_id",
  value: string,
): Promise<AdminTicketOpsResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("admin_update_support_ticket_v2", {
    p_ticket_id: ticketId,
    p_actor_id: staffId,
    p_field: field,
    p_value: value,
  });
  const payload = adminPayload(data);
  if (error || !payload) {
    console.error("admin ticket update", { field, code: error?.code ?? "unknown", message: error?.message ?? "empty result" });
    return { error: field === "assigned_staff_id" ? "Atama kaydedilemedi." : "Destek talebi güncellenemedi." };
  }
  revalidateTicketPages(ticketId);
  return { ok: true, ticketId };
}

/** Ticket'ı tickets modülüne erişebilen aktif platform personeline atar. */
export async function assignTicketStaff(formData: FormData): Promise<AdminTicketOpsResult> {
  const staff = await requirePlatformModule("tickets");
  const id = String(formData.get("id") ?? "").trim();
  const staffId = String(formData.get("staff_id") ?? "").trim();
  if (!isUuid(id) || (staffId && !isUuid(staffId))) return { error: "Geçersiz atama." };
  const rateError = await adminRate(staff.id, "assign");
  if (rateError) return { error: rateError };

  const result = await updateAdminField(staff.id, id, "assigned_staff_id", staffId);
  if (result.ok && staffId) {
    await notifyPlatformStaff({
      staffId,
      title: "Yeni destek talebi atandı",
      body: "Destek kuyruğunuzda yeni bir sorumluluk var.",
      href: `/admin/tickets/${id}`,
      kind: "info",
      roles: ["super_admin", "ops", "support"],
      meta: { ticket_id: id },
    });
  }
  return result;
}

export async function updateTicketPriority(formData: FormData): Promise<AdminTicketOpsResult> {
  const staff = await requirePlatformModule("tickets");
  const id = String(formData.get("id") ?? "").trim();
  const priority = String(formData.get("priority") ?? "").trim();
  if (!isUuid(id) || !isTicketPriority(priority)) return { error: "Geçersiz öncelik." };
  const rateError = await adminRate(staff.id, "priority");
  if (rateError) return { error: rateError };
  return updateAdminField(staff.id, id, "priority", priority);
}

export async function updateTicketCategory(formData: FormData): Promise<AdminTicketOpsResult> {
  const staff = await requirePlatformModule("tickets");
  const id = String(formData.get("id") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  if (!isUuid(id)) return { error: "Destek talebi bulunamadı." };
  const categoryError = validateTicketCategory(category);
  if (categoryError) return { error: categoryError };
  const rateError = await adminRate(staff.id, "category");
  if (rateError) return { error: rateError };
  return updateAdminField(staff.id, id, "category", category);
}

/** Internal note is stored as a staff message hidden by tenant RLS and Realtime. */
export async function addInternalTicketNote(
  _prev: AdminTicketOpsResult,
  formData: FormData,
): Promise<AdminTicketOpsResult> {
  await requirePlatformModule("tickets");
  const body = String(formData.get("body") ?? "").trim();
  const bodyError = validateTicketBody(body);
  if (bodyError) return { error: bodyError };
  formData.set("visibility", "internal");
  const result = await replyTicketAsStaff({}, formData);
  return {
    ok: result.ok,
    error: result.error,
    ticketId: result.ticketId,
    messageId: result.messageId,
  };
}

/** Max 50 ticket; RPC is atomic, so an invalid row rolls the whole batch back. */
export async function bulkUpdateTickets(
  _prev: AdminTicketOpsResult,
  formData: FormData,
): Promise<AdminTicketOpsResult> {
  const staff = await requirePlatformModule("tickets");
  const rawIds = [...formData.getAll("ids"), ...formData.getAll("ids[]")];
  const ids = uniqueValidTicketIds(rawIds);
  if (!ids) return { error: "1-50 arasında geçerli destek talebi seçin." };
  const field = String(formData.get("field") ?? "").trim();
  const value = String(formData.get("value") ?? "").trim();
  if (!["status", "priority", "category", "assigned_staff_id"].includes(field)) {
    return { error: "Geçersiz toplu işlem." };
  }
  if (field === "status" && !isTicketStatus(value)) return { error: "Geçersiz durum." };
  if (field === "status" && (value === "resolved" || value === "closed")) {
    return { error: "Çözüm ve kapatma işlemlerini talep detayından, çözüm özetiyle tamamlayın." };
  }
  if (field === "priority" && !isTicketPriority(value)) return { error: "Geçersiz öncelik." };
  if (field === "category" && validateTicketCategory(value)) return { error: "Geçersiz kategori." };
  if (field === "assigned_staff_id" && value && !isUuid(value)) return { error: "Geçersiz personel." };
  const rateError = await adminRate(staff.id, "bulk", 30);
  if (rateError) return { error: rateError };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("bulk_update_support_tickets_v2", {
    p_ticket_ids: ids,
    p_actor_id: staff.id,
    p_field: field,
    p_value: value,
  });
  const updated = data && typeof data === "object" ? Number((data as Record<string, unknown>).updated) : 0;
  if (error || !Number.isInteger(updated) || updated < 1) {
    console.error("bulkUpdateTickets", { code: error?.code ?? "unknown", message: error?.message ?? "empty result" });
    return { error: "Toplu işlem uygulanamadı; hiçbir kayıt değiştirilmedi." };
  }
  revalidateTicketPages();
  return { ok: true, updated };
}

/** Hazır yanıt makrosu ekler — yalnızca süper admin. */
export async function createTicketMacro(formData: FormData): Promise<AdminTicketOpsResult> {
  const staff = await requirePlatformModule("tickets");
  if (staff.role !== "super_admin") return { error: "Yalnızca süper admin makro ekleyebilir." };
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!title || !body) return { error: "Başlık ve içerik zorunlu." };
  if (title.length > TICKET_LIMITS.macroTitleMax || body.length > TICKET_LIMITS.macroBodyMax) {
    return { error: "Hazır yanıt izin verilen uzunluğu aşıyor." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.from("ticket_macros").insert({ title, body, created_by: staff.id }).select("id").single();
  if (error || !data) return { error: "Makro eklenemedi." };
  await logPlatformActivity({ actorId: staff.id, action: "ticket.macro.create", entityType: "ticket_macro", entityId: data.id });
  revalidateTicketPages();
  return { ok: true };
}

/** Hazır yanıt makrosu siler — yalnızca süper admin. */
export async function deleteTicketMacro(formData: FormData): Promise<AdminTicketOpsResult> {
  const staff = await requirePlatformModule("tickets");
  if (staff.role !== "super_admin") return { error: "Yalnızca süper admin makro silebilir." };
  const id = String(formData.get("id") ?? "").trim();
  if (!isUuid(id)) return { error: "Makro bulunamadı." };

  const admin = createAdminClient();
  const { error, count } = await admin.from("ticket_macros").delete({ count: "exact" }).eq("id", id);
  if (error || count !== 1) return { error: "Makro silinemedi." };
  await logPlatformActivity({ actorId: staff.id, action: "ticket.macro.delete", entityType: "ticket_macro", entityId: id });
  revalidateTicketPages();
  return { ok: true };
}
