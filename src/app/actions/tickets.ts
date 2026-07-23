"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformStaff } from "@/lib/platform";
import { requireActiveTenant } from "@/lib/tenant-guard";
import { notifyPlatformStaff } from "@/lib/platform-notify";

async function tenantName(tenantId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin.from("tenants").select("name").eq("id", tenantId).maybeSingle();
  return data?.name ?? "Bir ofis";
}

export type TicketResult = { error?: string; ok?: boolean };

const CATEGORIES = ["general", "billing", "bug", "feature", "compliance", "onboarding"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"];

function revalidateTicket(id: string) {
  revalidatePath("/app/destek");
  revalidatePath(`/app/destek/${id}`);
  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets/${id}`);
}

export async function createSupportTicket(
  _prev: TicketResult,
  formData: FormData,
): Promise<TicketResult> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error };

  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const category = String(formData.get("category") ?? "general").trim();
  const priority = String(formData.get("priority") ?? "normal").trim();

  if (!subject || !body) return { error: "Konu ve açıklama zorunlu." };
  if (!CATEGORIES.includes(category)) return { error: "Geçersiz kategori." };
  if (!PRIORITIES.includes(priority)) return { error: "Geçersiz öncelik." };

  const supabase = await createClient();
  const { data: ticket, error } = await supabase
    .from("support_tickets")
    .insert({
      tenant_id: gate.tenantId,
      created_by: gate.userId,
      subject,
      body,
      category,
      priority,
      status: "open",
    })
    .select("id")
    .single();

  if (error || !ticket) {
    console.error("createSupportTicket", error);
    return { error: "Ticket oluşturulamadı." };
  }

  await supabase.from("support_ticket_messages").insert({
    ticket_id: ticket.id,
    author_user_id: gate.userId,
    author_kind: "tenant",
    body,
  });

  await notifyPlatformStaff({
    title: priority === "urgent" ? "🚨 Acil destek talebi" : "Yeni destek talebi",
    body: `${await tenantName(gate.tenantId)} · ${subject}`,
    href: `/admin/tickets/${ticket.id}`,
    kind: priority === "urgent" ? "danger" : "info",
    meta: { ticket_id: ticket.id, category, priority },
  });

  revalidateTicket(ticket.id);
  return { ok: true };
}

export async function updateTicketStatus(formData: FormData): Promise<TicketResult> {
  await requirePlatformStaff();

  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!id || !STATUSES.includes(status)) return { error: "Geçersiz durum." };

  const admin = createAdminClient();
  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (status === "resolved" || status === "closed") {
    patch.resolved_at = new Date().toISOString();
  }

  const { error } = await admin.from("support_tickets").update(patch).eq("id", id);
  if (error) return { error: "Durum güncellenemedi." };

  revalidateTicket(id);
  return { ok: true };
}

export async function setTicketStatus(formData: FormData): Promise<void> {
  await updateTicketStatus(formData);
}

export async function replyTicketAsStaff(
  _prev: TicketResult,
  formData: FormData,
): Promise<TicketResult> {
  const staff = await requirePlatformStaff();
  const id = String(formData.get("id") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!id || !body) return { error: "Yanıt boş olamaz." };

  const admin = createAdminClient();
  const { data: ticket } = await admin
    .from("support_tickets")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (!ticket) return { error: "Ticket bulunamadı." };
  if (ticket.status === "closed") return { error: "Kapalı ticket’a yanıt eklenemez." };

  const { error: msgErr } = await admin.from("support_ticket_messages").insert({
    ticket_id: id,
    author_user_id: staff.id,
    author_kind: "staff",
    body,
  });
  if (msgErr) return { error: "Yanıt eklenemedi." };

  await admin
    .from("support_tickets")
    .update({
      status: "waiting",
      updated_at: new Date().toISOString(),
      assigned_to: staff.id,
    })
    .eq("id", id);

  revalidateTicket(id);
  return { ok: true };
}

/** Tenant kendi ticket'ını kapatabilir veya (çözüldü/kapandı ise) yeniden açabilir. */
export async function setTicketStatusAsTenant(formData: FormData): Promise<TicketResult> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!id) return { error: "Ticket bulunamadı." };
  if (!["open", "closed"].includes(status)) return { error: "Bu işlem yapılamaz." };

  const supabase = await createClient();
  const { data: ticket } = await supabase
    .from("support_tickets")
    .select("id, tenant_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!ticket || ticket.tenant_id !== gate.tenantId) return { error: "Ticket bulunamadı." };

  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "closed") patch.resolved_at = new Date().toISOString();
  if (status === "open") patch.resolved_at = null;

  const { error } = await supabase
    .from("support_tickets")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: "Durum güncellenemedi." };

  revalidateTicket(id);
  return { ok: true };
}

export async function setTicketStatusTenantAction(formData: FormData): Promise<void> {
  await setTicketStatusAsTenant(formData);
}

export async function replyTicketAsTenant(
  _prev: TicketResult,
  formData: FormData,
): Promise<TicketResult> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!id || !body) return { error: "Yanıt boş olamaz." };

  const supabase = await createClient();
  const { data: ticket } = await supabase
    .from("support_tickets")
    .select("id, status, tenant_id")
    .eq("id", id)
    .maybeSingle();

  if (!ticket || ticket.tenant_id !== gate.tenantId) {
    return { error: "Ticket bulunamadı." };
  }
  if (ticket.status === "closed" || ticket.status === "resolved") {
    return { error: "Bu ticket kapatılmış. Yeni talep açabilirsiniz." };
  }

  const { error: msgErr } = await supabase.from("support_ticket_messages").insert({
    ticket_id: id,
    author_user_id: gate.userId,
    author_kind: "tenant",
    body,
  });
  if (msgErr) return { error: "Yanıt eklenemedi." };

  await supabase
    .from("support_tickets")
    .update({ status: "in_progress", updated_at: new Date().toISOString() })
    .eq("id", id);

  await notifyPlatformStaff({
    title: "Destek talebine yanıt geldi",
    body: `${await tenantName(gate.tenantId)} bir ticket'a yanıt yazdı.`,
    href: `/admin/tickets/${id}`,
    kind: "info",
    meta: { ticket_id: id },
  });

  revalidateTicket(id);
  return { ok: true };
}
