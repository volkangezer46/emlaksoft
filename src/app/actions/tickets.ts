"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { requirePermission } from "@/lib/require-permission";
import { checkRateLimit } from "@/lib/rate-limit";
import { notifyPlatformStaff } from "@/lib/platform-notify";
import { notifyTenant } from "@/lib/notify";
import {
  TICKET_LIMITS,
  isTicketPriority,
  isTicketStatus,
  isTicketVisibility,
  isUuid,
  normalizeOptionalRequestId,
  validateTicketBody,
  validateTicketCategory,
  validateTicketResolution,
  validateTicketSubject,
} from "@/lib/support/ticket-contract";

export type TicketResult = {
  error?: string;
  ok?: boolean;
  already?: boolean;
  ticketId?: string;
  ticketNo?: string;
  messageId?: string;
};

type TicketMutationPayload = {
  ok: boolean;
  already?: boolean;
  ticketId: string;
  ticketNo?: string;
  messageId?: string;
  tenantId: string;
  createdBy?: string | null;
  assignedStaffId?: string | null;
  subject: string;
  status: string;
  oldStatus?: string;
};

const QUEUE_ROLES = ["super_admin", "ops", "support"] as const;

function revalidateTicket(id: string) {
  revalidatePath("/app/destek");
  revalidatePath(`/app/destek/${id}`);
  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets/${id}`);
}

function payloadOf(data: unknown): TicketMutationPayload | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (
    row.ok !== true ||
    typeof row.ticketId !== "string" ||
    typeof row.tenantId !== "string" ||
    typeof row.subject !== "string" ||
    typeof row.status !== "string"
  ) {
    return null;
  }
  return row as unknown as TicketMutationPayload;
}

function publicResult(payload: TicketMutationPayload): TicketResult {
  return {
    ok: true,
    already: payload.already,
    ticketId: payload.ticketId,
    ticketNo: payload.ticketNo,
    messageId: payload.messageId,
  };
}

function rpcFailure(label: string, error: { code?: string; message?: string } | null, fallback: string) {
  console.error(label, { code: error?.code ?? "unknown", message: error?.message ?? "empty result" });
  if (error?.message?.includes("VERSION_CONFLICT")) {
    return "Bu talep az önce başka biri tarafından güncellendi. Sayfayı yenileyip tekrar deneyin.";
  }
  if (error?.message?.includes("Invalid ticket transition")) return "Bu durum geçişi yapılamaz.";
  if (error?.message?.includes("Invalid category")) return "Seçilen destek kategorisi artık kullanılamıyor.";
  if (error?.message?.includes("Ticket not found")) return "Destek talebi bulunamadı.";
  return fallback;
}

/** `version` alanı formda varsa optimistic-concurrency kontrolü için RPC'ye iletilir. */
function expectedVersion(formData: FormData): number | null {
  const raw = formData.get("expected_version");
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function ticketRateLimit(key: string, limit: number, windowSec: number): Promise<string | null> {
  const result = await checkRateLimit(key, { limit, windowSec, failurePolicy: "deny" });
  return result.allowed ? null : "Çok sık işlem yapıldı. Lütfen kısa bir süre sonra yeniden deneyin.";
}

async function tenantName(tenantId: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("tenants").select("name").eq("id", tenantId).maybeSingle();
  if (error) console.error("ticket tenant name", { code: error.code });
  return data?.name ?? "Bir ofis";
}

async function notifySupportQueue(payload: TicketMutationPayload, title: string, kind: "info" | "danger" = "info") {
  await notifyPlatformStaff({
    title,
    body: `${await tenantName(payload.tenantId)} · ${payload.ticketNo ?? "Destek"} · ${payload.subject}`,
    href: `/admin/tickets/${payload.ticketId}`,
    kind,
    staffId: payload.assignedStaffId ?? undefined,
    roles: [...QUEUE_ROLES],
    meta: { ticket_id: payload.ticketId, ticket_no: payload.ticketNo },
  });
}

async function notifyTicketRequester(
  payload: TicketMutationPayload,
  title: string,
  kind: "info" | "success" | "warning" = "info",
) {
  await notifyTenant({
    tenantId: payload.tenantId,
    userId: payload.createdBy ?? null,
    title,
    body: `${payload.ticketNo ?? "Destek talebi"} · ${payload.subject}`,
    href: `/app/destek/${payload.ticketId}`,
    kind,
    prefKey: "support",
  });
}

function requestId(formData: FormData) {
  return normalizeOptionalRequestId(formData.get("request_id")) ?? randomUUID();
}

function validateCreateInput(formData: FormData) {
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const category = String(formData.get("category") ?? "general").trim();
  const priority = String(formData.get("priority") ?? "normal").trim();
  const error =
    validateTicketSubject(subject) ??
    validateTicketBody(body) ??
    validateTicketCategory(category) ??
    (!isTicketPriority(priority) ? "Geçersiz öncelik." : null);
  return { subject, body, category, priority, error };
}

export async function createSupportTicket(
  _prev: TicketResult,
  formData: FormData,
): Promise<TicketResult> {
  const gate = await requirePermission("support", "create");
  if (!gate.ok) return { error: gate.error };

  const input = validateCreateInput(formData);
  if (input.error) return { error: input.error };
  const rateError = await ticketRateLimit(`ticket-create:${gate.tenantId}:${gate.userId}`, 10, 600);
  if (rateError) return { error: rateError };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("create_support_ticket_v2", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_actor_kind: "tenant",
    p_subject: input.subject,
    p_body: input.body,
    p_category: input.category,
    p_priority: input.priority,
    p_request_id: requestId(formData),
  });
  const payload = payloadOf(data);
  if (error || !payload) return { error: rpcFailure("createSupportTicket", error, "Destek talebi oluşturulamadı.") };

  if (!payload.already) {
    await notifySupportQueue(
      payload,
      input.priority === "urgent" ? "Acil destek talebi" : "Yeni destek talebi",
      input.priority === "urgent" ? "danger" : "info",
    );
  }
  revalidateTicket(payload.ticketId);
  return publicResult(payload);
}

/** Platform personeli doğrulanmış bir tenant adına ticket açar. */
export async function createSupportTicketAsStaff(
  _prev: TicketResult,
  formData: FormData,
): Promise<TicketResult> {
  const staff = await requirePlatformModule("tickets");
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (!isUuid(tenantId)) return { error: "Geçerli bir ofis seçin." };
  const input = validateCreateInput(formData);
  if (input.error) return { error: input.error };
  const rateError = await ticketRateLimit(`ticket-staff-create:${staff.id}`, 30, 600);
  if (rateError) return { error: rateError };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("create_support_ticket_v2", {
    p_tenant_id: tenantId,
    p_actor_id: staff.id,
    p_actor_kind: "staff",
    p_subject: input.subject,
    p_body: input.body,
    p_category: input.category,
    p_priority: input.priority,
    p_request_id: requestId(formData),
  });
  const payload = payloadOf(data);
  if (error || !payload) return { error: rpcFailure("createSupportTicketAsStaff", error, "Destek talebi oluşturulamadı.") };

  if (!payload.already) {
    const { data: owner } = await admin
      .from("profiles")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("role", "owner")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    await notifyTenant({
      tenantId,
      userId: owner?.id ?? null,
      title: "EmlakSoft destek talebi oluşturdu",
      body: `${payload.ticketNo ?? "Destek talebi"} · ${payload.subject}`,
      href: `/app/destek/${payload.ticketId}`,
      kind: "info",
      prefKey: "support",
    });
  }
  revalidateTicket(payload.ticketId);
  return publicResult(payload);
}

export async function updateTicketStatus(formData: FormData): Promise<TicketResult> {
  const staff = await requirePlatformModule("tickets");
  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const resolutionCode = String(formData.get("resolution_code") ?? "").trim();
  const resolutionSummary = String(formData.get("resolution_summary") ?? "").trim();
  if (!isUuid(id) || !isTicketStatus(status)) return { error: "Geçersiz durum." };
  const resolutionError = validateTicketResolution(status, resolutionCode, resolutionSummary);
  if (resolutionError) return { error: resolutionError };
  const rateError = await ticketRateLimit(`ticket-staff-status:${staff.id}`, 60, 300);
  if (rateError) return { error: rateError };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("transition_support_ticket_v2", {
    p_ticket_id: id,
    p_tenant_id: null,
    p_actor_id: staff.id,
    p_actor_kind: "staff",
    p_status: status,
    p_resolution_code: resolutionCode || null,
    p_resolution_summary: resolutionSummary || null,
    p_expected_version: expectedVersion(formData),
  });
  const payload = payloadOf(data);
  if (error || !payload) return { error: rpcFailure("updateTicketStatus", error, "Durum güncellenemedi.") };

  if (!payload.already && ["resolved", "closed", "open"].includes(status)) {
    await notifyTicketRequester(
      payload,
      status === "resolved" ? "Destek talebiniz çözüldü" : status === "closed" ? "Destek talebiniz kapatıldı" : "Destek talebiniz yeniden açıldı",
      status === "resolved" ? "success" : "info",
    );
  }
  revalidateTicket(id);
  return publicResult(payload);
}

export async function replyTicketAsStaff(
  _prev: TicketResult,
  formData: FormData,
): Promise<TicketResult> {
  const staff = await requirePlatformModule("tickets");
  const id = String(formData.get("id") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const visibilityRaw = String(formData.get("visibility") ?? "public").trim();
  if (!isUuid(id)) return { error: "Destek talebi bulunamadı." };
  const bodyError = validateTicketBody(body);
  if (bodyError) return { error: bodyError };
  if (!isTicketVisibility(visibilityRaw)) return { error: "Geçersiz mesaj görünürlüğü." };
  const rateError = await ticketRateLimit(`ticket-staff-reply:${staff.id}`, 60, 300);
  if (rateError) return { error: rateError };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reply_support_ticket_v2", {
    p_ticket_id: id,
    p_tenant_id: null,
    p_actor_id: staff.id,
    p_actor_kind: "staff",
    p_body: body,
    p_visibility: visibilityRaw,
    p_request_id: requestId(formData),
    p_expected_version: expectedVersion(formData),
  });
  const payload = payloadOf(data);
  if (error || !payload) return { error: rpcFailure("replyTicketAsStaff", error, "Yanıt eklenemedi.") };

  if (!payload.already && visibilityRaw === "public") {
    await notifyTicketRequester(payload, "Destek ekibinden yeni yanıt");
  }
  revalidateTicket(id);
  return publicResult(payload);
}

/** Tenant kendi ticket'ını kapatabilir veya sonuçlanan ticketı yeniden açabilir. */
export async function setTicketStatusAsTenant(formData: FormData): Promise<TicketResult> {
  const gate = await requirePermission("support", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!isUuid(id) || !["open", "closed"].includes(status)) return { error: "Bu işlem yapılamaz." };
  const rateError = await ticketRateLimit(`ticket-tenant-status:${gate.userId}`, 30, 300);
  if (rateError) return { error: rateError };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("transition_support_ticket_v2", {
    p_ticket_id: id,
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_actor_kind: "tenant",
    p_status: status,
    p_resolution_code: status === "closed" ? "closed_by_customer" : null,
    p_resolution_summary: status === "closed" ? "Müşteri talebi kapattı." : null,
    p_expected_version: expectedVersion(formData),
  });
  const payload = payloadOf(data);
  if (error || !payload) return { error: rpcFailure("setTicketStatusAsTenant", error, "Durum güncellenemedi.") };

  if (!payload.already) {
    await notifySupportQueue(payload, status === "open" ? "Destek talebi yeniden açıldı" : "Destek talebi müşteri tarafından kapatıldı");
  }
  revalidateTicket(id);
  return publicResult(payload);
}

export async function replyTicketAsTenant(
  _prev: TicketResult,
  formData: FormData,
): Promise<TicketResult> {
  const gate = await requirePermission("support", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("id") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!isUuid(id)) return { error: "Destek talebi bulunamadı." };
  const bodyError = validateTicketBody(body);
  if (bodyError) return { error: bodyError };
  const rateError = await ticketRateLimit(`ticket-tenant-reply:${gate.tenantId}:${gate.userId}`, 30, 300);
  if (rateError) return { error: rateError };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reply_support_ticket_v2", {
    p_ticket_id: id,
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_actor_kind: "tenant",
    p_body: body,
    p_visibility: "public",
    p_request_id: requestId(formData),
    p_expected_version: expectedVersion(formData),
  });
  const payload = payloadOf(data);
  if (error || !payload) return { error: rpcFailure("replyTicketAsTenant", error, "Yanıt eklenemedi.") };

  if (!payload.already) await notifySupportQueue(payload, "Destek talebine yanıt geldi");
  revalidateTicket(id);
  return publicResult(payload);
}

export async function submitTicketCsat(
  _prev: TicketResult,
  formData: FormData,
): Promise<TicketResult> {
  const gate = await requirePermission("support", "view");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("id") ?? "").trim();
  const score = Number.parseInt(String(formData.get("score") ?? ""), 10);
  const comment = String(formData.get("comment") ?? "").trim();
  if (!isUuid(id) || !Number.isInteger(score) || score < 1 || score > 5) return { error: "Geçerli bir puan seçin." };
  if (comment.length > TICKET_LIMITS.csatCommentMax) return { error: "Yorum en fazla 1.000 karakter olabilir." };
  const rateError = await ticketRateLimit(`ticket-csat:${gate.tenantId}:${gate.userId}`, 10, 600);
  if (rateError) return { error: rateError };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("submit_support_ticket_csat_v2", {
    p_ticket_id: id,
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_score: score,
    p_comment: comment || null,
  });
  if (error || !data || typeof data !== "object") {
    return { error: rpcFailure("submitTicketCsat", error, "Değerlendirmeniz kaydedilemedi.") };
  }
  revalidateTicket(id);
  return { ok: true, already: (data as Record<string, unknown>).already === true, ticketId: id };
}
