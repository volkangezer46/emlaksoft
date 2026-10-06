import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tickets = readFileSync(resolve(process.cwd(), "src/app/actions/tickets.ts"), "utf8");
const adminOps = readFileSync(resolve(process.cwd(), "src/app/actions/admin-ticket-ops.ts"), "utf8");
const cron = readFileSync(resolve(process.cwd(), "src/app/api/cron/ticket-sla/route.ts"), "utf8");
const vercel = readFileSync(resolve(process.cwd(), "vercel.json"), "utf8");

describe("support ticket action contract", () => {
  it("tenant writes use effective module permissions, not active-tenant only", () => {
    expect(tickets).toContain('requirePermission("support", "create")');
    expect(tickets.match(/requirePermission\("support", "edit"\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(tickets).not.toContain("requireActiveTenant");
  });

  it("never writes support tables directly and uses atomic RPCs", () => {
    expect(tickets).not.toContain('.from("support_tickets").insert');
    expect(tickets).not.toContain('.from("support_ticket_messages").insert');
    expect(tickets).toContain('admin.rpc("create_support_ticket_v2"');
    expect(tickets).toContain('admin.rpc("reply_support_ticket_v2"');
    expect(tickets).toContain('admin.rpc("transition_support_ticket_v2"');
    expect(adminOps).toContain('admin.rpc("admin_update_support_ticket_v2"');
    expect(adminOps).toContain('admin.rpc("bulk_update_support_tickets_v2"');
  });

  it("validates UUID/text, rate-limits fail-closed and returns created ids", () => {
    expect(tickets).toContain('failurePolicy: "deny"');
    expect(tickets).toContain("validateTicketBody");
    expect(tickets).toContain("isUuid");
    expect(tickets).toContain("messageId: payload.messageId");
    expect(tickets).toContain("ticketId: payload.ticketId");
  });

  it("routes tenant/staff notifications to the proper support boundary", () => {
    expect(tickets).toContain('prefKey: "support"');
    expect(tickets).toContain('const QUEUE_ROLES = ["super_admin", "ops", "support"]');
    expect(tickets).toContain("staffId: payload.assignedStaffId ?? undefined");
    expect(tickets).toContain("roles: [...QUEUE_ROLES]");
  });

  it("supports internal notes and max-50 bulk operations", () => {
    expect(tickets).toContain('formData.get("visibility")');
    // İç not personel yanıt formundan (visibility=internal) replyTicketAsStaff ile gider; ayrı addInternalTicketNote silindi.
    expect(readFileSync(resolve(process.cwd(), "src/app/admin/tickets/staff-reply-form.tsx"), "utf8")).toContain('replyData.set("visibility", effectiveVisibility)');
    expect(adminOps).toContain("uniqueValidTicketIds");
    expect(adminOps).toContain("bulkUpdateTickets");
  });

  it("protects and schedules the SLA escalation route", () => {
    expect(cron).toMatch(/authorizeCron|CRON_SECRET/);
    expect(cron).toContain('admin.rpc("process_support_ticket_sla_escalations_v2"');
    expect(vercel).toContain('"path": "/api/cron/ticket-sla"');
    expect(vercel).toContain('"schedule": "*/5 * * * *"');
  });

  it("keeps modified sources valid UTF-8", () => {
    expect(tickets).not.toContain("�");
    expect(adminOps).not.toContain("�");
  });
});
