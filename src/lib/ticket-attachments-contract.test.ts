import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("support ticket attachment production contract", () => {
  const migration = source("supabase/migrations/20260731000145_support_ticket_attachments.sql");
  const sessionRoute = source("src/app/api/ticket-attachments/route.ts");
  const finalizeRoute = source("src/app/api/ticket-attachments/finalize/route.ts");
  const downloadRoute = source("src/app/api/ticket-attachments/[id]/route.ts");
  const deleteAction = source("src/app/actions/ticket-attachments.ts");
  const access = source("src/lib/ticket-attachments-access.ts");
  const cleanupRoute = source("src/app/api/cron/ticket-attachment-cleanup/route.ts");
  const cleanupWorker = source("src/lib/ticket-attachments-cleanup.ts");
  const vercel = source("vercel.json");

  it("private bucket, 10 MB limit ve service-role-only upload session kurar", () => {
    expect(migration).toContain("'ticket-attachments'");
    expect(migration).toMatch(/false,\s*10485760/);
    expect(migration).toContain("support_ticket_attachment_uploads");
    expect(migration).toContain("support_ticket_attachment_uploads_deny");
    expect(migration).toContain("grant all on public.support_ticket_attachment_uploads to service_role");
  });

  it("metadata RLS'inde billing rolünü platform ticket erişiminden dışlar", () => {
    expect(migration).toContain("ps.role in ('super_admin', 'ops', 'support')");
    expect(migration).toContain("public.support_tenant_can_read_ticket(t.tenant_id, t.created_by)");
    expect(migration).not.toMatch(/support_ticket_attachments_select[\s\S]*public\.is_platform_staff\(\)/);
    expect(migration).toContain("support_ticket_attachments_insert_deny");
    expect(migration).toContain("support_ticket_attachments_update_deny");
    expect(migration).toContain("support_ticket_attachments_delete_deny");
  });

  it("silinen requester'ın pending private nesnesini cleanup için izlenebilir tutar", () => {
    expect(migration).toMatch(/requested_by uuid references auth\.users\(id\) on delete set null/);
    expect(migration).not.toMatch(/requested_by uuid not null/);
    expect(finalizeRoute).toContain("requested_by: string | null");
    expect(finalizeRoute).toContain("!session.requested_by");
  });

  it("10 MB gövdeyi Function'a taşımaz; signed upload yalnız yazma oturumu içindir", () => {
    expect(sessionRoute).toContain("createSignedUploadUrl");
    expect(sessionRoute).not.toContain("request.formData()");
    expect(sessionRoute).not.toContain("createSignedUrl(");
    expect(sessionRoute).not.toContain("getPublicUrl");
    expect(finalizeRoute).toContain("verifyTicketAttachment");
    expect(finalizeRoute).toContain(".download(session.storage_path)");
  });

  it("mesaj ekini yalnız mesajın gerçek yazarıyla bağlar ve DB trigger'ında tekrar doğrular", () => {
    expect(sessionRoute).toContain("message.author_user_id !== access.actor.userId");
    expect(sessionRoute).toContain("message.author_kind !== access.actor.kind");
    expect(migration).toContain("Attachment uploader must match its message author.");
    expect(migration).toContain("new.uploaded_by is distinct from v_message_author");
  });

  it("indirmeyi her istekte authorize eder ve attachment response'u zorlar", () => {
    expect(downloadRoute).toContain("authorizeStoredTicketAttachment(id, \"download\")");
    expect(downloadRoute).toContain("isSafeTicketAttachmentPath");
    expect(downloadRoute).toContain('"Content-Disposition"');
    expect(downloadRoute).toContain('"X-Content-Type-Options": "nosniff"');
    expect(downloadRoute).not.toContain("createSignedUrl");
    expect(downloadRoute).not.toContain("getPublicUrl");
  });

  it("tenant yöneticisi dahil yalnız kendi ekini silebilir", () => {
    expect(access).toContain('intent === "delete"');
    expect(access).toContain("attachment.uploaded_by !== ticketAccess.actor.userId");
    expect(deleteAction).toContain('authorizeStoredTicketAttachment(attachmentId, "delete")');
    expect(deleteAction).toContain("deleted_by_kind: actor.kind");
  });

  it("tenant upload ve delete işlemlerini support edit iznine bağlar", () => {
    expect(access).toContain('intent === "write"');
    expect(access).toContain('effectiveHasPermission(perms, "support", "edit")');
    expect(access).toContain('effectiveCanAccessModule(perms, "support")');
    expect(access).toContain("staff && !impersonating");
    expect(access).toContain('tenantStatus === "suspended"');
    expect(access).toContain("twoFactorSatisfied(user.id)");
  });

  it("audit eventine dosya adı, hash veya storage yolu sızdırmaz", () => {
    const auditFunction = migration.split("create or replace function public.audit_support_ticket_attachment()")[1]?.split("$$;")[0] ?? "";
    expect(auditFunction).toContain("attachment_id");
    expect(auditFunction).not.toContain("new.file_name");
    expect(auditFunction).not.toContain("new.sha256");
    expect(auditFunction).not.toContain("new.storage_path");
  });

  it("süresi dolan signed upload nesnelerini cron + heartbeat ile temizler", () => {
    expect(cleanupRoute).toMatch(/authorizeCron|CRON_SECRET/);
    expect(cleanupRoute).toContain('recordHeartbeat("ticket-attachment-cleanup"');
    expect(cleanupWorker).toContain("cleanupTicketAttachmentUploads");
    expect(cleanupWorker).toContain(".remove([session.storage_path])");
    expect(vercel).toContain('"path": "/api/cron/ticket-attachment-cleanup"');
    expect(vercel).toContain('"schedule": "15 */2 * * *"');
  });

  it("finalize/cleanup yarışını lease CAS ve metadata kurtarma kontrolüyle keser", () => {
    expect(migration).toContain("'finalizing'");
    expect(finalizeRoute).toContain('.update({ status: "finalizing", expires_at: leaseUntil })');
    expect(finalizeRoute).toContain('.eq("status", "finalizing")');
    expect(cleanupWorker).toContain('.in("status", ["pending", "finalizing"])');
    expect(cleanupWorker).toContain('.from("support_ticket_attachments")');
    expect(cleanupWorker).toContain('.update({ status: "finalized"');
  });

  it("finalized replay'i writability kontrolünden önce idempotent döndürür", () => {
    expect(finalizeRoute.indexOf('session.status === "finalized"')).toBeGreaterThan(-1);
    expect(finalizeRoute.indexOf('session.status === "finalized"')).toBeLessThan(
      finalizeRoute.indexOf("closedWithoutInternalStaffException"),
    );
  });

  it("closed ticket'ta yalnız staff internal ekine izin verir", () => {
    expect(sessionRoute).toContain('access.actor.kind === "staff" && visibility === "internal"');
    expect(finalizeRoute).toContain('access.actor.kind === "staff" && session.visibility === "internal"');
  });

  it("attachment tablosunu Realtime publication'a idempotent ekler", () => {
    expect(migration).toContain("pg_publication_tables");
    expect(migration).toContain("alter publication supabase_realtime add table public.support_ticket_attachments");
  });
});
