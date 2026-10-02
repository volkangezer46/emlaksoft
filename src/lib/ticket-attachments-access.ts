import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { getPlatformStaff } from "@/lib/platform";
import { platformCanAccess } from "@/lib/platform-access";
import {
  effectiveCanAccessModule,
  effectiveHasPermission,
  getEffectivePermissions,
} from "@/lib/permissions-effective";
import { hasOfficeWideDataScope } from "@/lib/permission-data-scope";
import { isUuid, type TicketAttachmentRecord } from "@/lib/ticket-attachments";
import { twoFactorSatisfied } from "@/lib/tenant-guard";

export type TicketAttachmentActor =
  | {
      kind: "staff";
      userId: string;
      tenantId: null;
      officeWide: true;
      role: string;
    }
  | {
      kind: "tenant";
      userId: string;
      tenantId: string;
      officeWide: boolean;
      role: string;
    };

export type AuthorizedTicket = {
  id: string;
  tenant_id: string;
  created_by: string | null;
  status: string;
  ticket_no: string | null;
};

type AccessDenied = { ok: false; status: 401 | 403 | 404; error: string };
type TicketAccessGranted = {
  ok: true;
  actor: TicketAttachmentActor;
  ticket: AuthorizedTicket;
};

export type TicketAttachmentAccessResult = AccessDenied | TicketAccessGranted;
export type AttachmentAccessResult =
  | AccessDenied
  | {
      ok: true;
      actor: TicketAttachmentActor;
      ticket: AuthorizedTicket;
      attachment: TicketAttachmentRecord;
    };

function tenantStatusOf(value: unknown): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return String((value[0] as { status?: unknown } | undefined)?.status ?? "") || null;
  return String((value as { status?: unknown }).status ?? "") || null;
}

/**
 * Ticket'a her dosya erişiminde yeniden uygulanan nesne-seviyesi yetki kapısı.
 * Admin istemcisi yalnızca oturumdan türetilen actor ile bu kapı geçildikten
 * sonra kullanılır; formdaki tenant/actor bilgileri hiçbir zaman güvenilmez.
 */
export async function authorizeTicketAttachmentAccess(
  ticketId: string,
  intent: "read" | "write",
): Promise<TicketAttachmentAccessResult> {
  if (!isUuid(ticketId)) return { ok: false, status: 404, error: "Destek talebi bulunamadı." };

  const user = await getRequestUser();
  if (!user) return { ok: false, status: 401, error: "Oturum bulunamadı." };

  const admin = createAdminClient();
  const { data: ticket, error: ticketError } = await admin
    .from("support_tickets")
    .select("id, tenant_id, created_by, status, ticket_no, tenant:tenants(status)")
    .eq("id", ticketId)
    .maybeSingle();
  if (ticketError) throw new Error(`Ticket dosya yetkisi sorgulanamadı: ${ticketError.message}`);
  if (!ticket) return { ok: false, status: 404, error: "Destek talebi bulunamadı." };

  const impersonating = Boolean(user.app_metadata?.impersonating);
  const staff = await getPlatformStaff();
  if (staff && !impersonating) {
    if (!platformCanAccess(staff.role, "tickets")) {
      return { ok: false, status: 403, error: "Bu işlem için yetkiniz yok." };
    }
    return {
      ok: true,
      actor: { kind: "staff", userId: staff.id, tenantId: null, officeWide: true, role: staff.role },
      ticket: ticket as AuthorizedTicket,
    };
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, tenant_id, role, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw new Error(`Ticket dosya profili sorgulanamadı: ${profileError.message}`);
  if (!profile?.is_active || profile.tenant_id !== ticket.tenant_id) {
    return { ok: false, status: 404, error: "Destek talebi bulunamadı." };
  }

  const perms = await getEffectivePermissions(profile.tenant_id, profile.role, user.id);
  const hasRequiredPermission =
    intent === "write"
      ? effectiveHasPermission(perms, "support", "edit")
      : effectiveCanAccessModule(perms, "support");
  if (!hasRequiredPermission) {
    return { ok: false, status: 403, error: "Destek modülü için yetkiniz yok." };
  }

  const officeWide = hasOfficeWideDataScope(profile.role);
  if (!officeWide && ticket.created_by !== user.id) {
    return { ok: false, status: 404, error: "Destek talebi bulunamadı." };
  }

  // Route Handler mutation'ları server action kapısıyla aynı aktif-tenant ve
  // SMS 2FA şartını taşır; doğrudan endpoint çağrısı bu sınırı atlayamaz.
  const tenantStatus = tenantStatusOf(ticket.tenant);
  if (intent === "write" && (tenantStatus === "suspended" || tenantStatus === "cancelled")) {
    return { ok: false, status: 403, error: "Askıdaki veya iptal edilmiş hesapta dosya işlemi yapılamaz." };
  }
  if (intent === "write" && !(await twoFactorSatisfied(user.id))) {
    return { ok: false, status: 403, error: "İki adımlı doğrulama tamamlanmadı." };
  }

  return {
    ok: true,
    actor: {
      kind: "tenant",
      userId: user.id,
      tenantId: profile.tenant_id,
      officeWide,
      role: profile.role,
    },
    ticket: ticket as AuthorizedTicket,
  };
}

export async function authorizeStoredTicketAttachment(
  attachmentId: string,
  intent: "download" | "delete",
): Promise<AttachmentAccessResult> {
  if (!isUuid(attachmentId)) return { ok: false, status: 404, error: "Dosya bulunamadı." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("support_ticket_attachments")
    .select(
      "id, tenant_id, ticket_id, message_id, uploaded_by, uploaded_by_kind, visibility, file_name, storage_path, mime_type, file_size, sha256, scan_status, blocked_reason, created_at, deleted_at",
    )
    .eq("id", attachmentId)
    .maybeSingle();
  if (error) throw new Error(`Ticket eki sorgulanamadı: ${error.message}`);
  if (!data || data.deleted_at) return { ok: false, status: 404, error: "Dosya bulunamadı." };

  const attachment = data as TicketAttachmentRecord;
  const ticketAccess = await authorizeTicketAttachmentAccess(
    attachment.ticket_id,
    intent === "delete" ? "write" : "read",
  );
  if (!ticketAccess.ok) return ticketAccess;

  if (ticketAccess.actor.kind === "tenant" && attachment.visibility !== "public") {
    return { ok: false, status: 404, error: "Dosya bulunamadı." };
  }
  if (
    intent === "delete" &&
    ticketAccess.actor.kind === "tenant" &&
    attachment.uploaded_by !== ticketAccess.actor.userId
  ) {
    return { ok: false, status: 403, error: "Bu dosyayı silemezsiniz." };
  }

  return { ok: true, actor: ticketAccess.actor, ticket: ticketAccess.ticket, attachment };
}
