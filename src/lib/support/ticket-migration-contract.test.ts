import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260731000142_support_ticket_operations.sql"),
  "utf8",
);
const compact = migration.replace(/\s+/g, " ").toLowerCase();

describe("support ticket v2 migration contract", () => {
  it("removes authenticated writes and tenant author spoofing surface", () => {
    expect(compact).toContain("drop policy if exists tickets_tenant_all on public.support_tickets");
    expect(compact).toContain("drop policy if exists ticket_messages_access on public.support_ticket_messages");
    expect(compact).toContain("revoke all privileges on table public.support_tickets from public, anon, authenticated");
    expect(compact).toContain("revoke all privileges on table public.support_ticket_messages from public, anon, authenticated");
    expect(compact).toContain("grant select on table public.support_tickets to authenticated");
    expect(compact).toContain("grant select on table public.support_ticket_messages to authenticated");
    expect(compact).not.toContain("grant all on public.support_tickets to authenticated");
  });

  it("limits direct reads to ticket staff or effective tenant scope", () => {
    expect(migration).toContain("s.role in ('super_admin', 'ops', 'support')");
    expect(migration).toContain("public.has_effective_permission('support', 'view')");
    expect(migration).toContain("p.role in ('owner', 'gm', 'branch_manager')");
    expect(migration).toContain("or p_created_by = auth.uid()");
  });

  it("adds canonical public references, assignment and persisted calendar-hour SLA", () => {
    expect(migration).toContain("add column if not exists ticket_no text");
    expect(migration).toContain("ES-");
    expect(migration).toContain("assigned_staff_id = assigned_to");
    expect(migration).toContain("first_response_due_at");
    expect(migration).toContain("resolution_due_at");
    expect(migration).toContain("Elapsed calendar-hour");
    expect(migration).toContain("when 'urgent' then interval '1 hour'");
    expect(migration).toContain("coalesce(new.reopened_at, new.created_at)");
    expect(migration).toContain("select least(p_target / 4, interval '1 hour')");
  });

  it("keeps internal notes tenant-invisible and messages append-only", () => {
    expect(migration).toContain("add column if not exists visibility text not null default 'public'");
    expect(migration).toContain("visibility = 'public'");
    expect(migration).toContain("visibility <> 'internal' or author_kind in ('staff', 'system')");
    expect(compact).not.toContain("grant insert on table public.support_ticket_messages to authenticated");
    expect(compact).not.toContain("grant update on table public.support_ticket_messages to authenticated");
    expect(compact).not.toContain("grant delete on table public.support_ticket_messages to authenticated");
  });

  it("exposes every mutation and escalation RPC only to service_role", () => {
    for (const name of [
      "create_support_ticket_v2",
      "reply_support_ticket_v2",
      "transition_support_ticket_v2",
      "admin_update_support_ticket_v2",
      "bulk_update_support_tickets_v2",
      "submit_support_ticket_csat_v2",
      "process_support_ticket_sla_escalations_v2",
    ]) {
      expect(compact).toContain(`grant execute on function public.${name}`);
    }
    expect(migration.match(/perform public\.support_require_service_role\(\);/g)?.length).toBeGreaterThanOrEqual(8);
  });

  it("records events without duplicating free text into audit indexes", () => {
    expect(migration).toContain("create table if not exists public.support_ticket_events");
    expect(migration).toContain("- 'resolution_summary'");
    expect(migration).toContain("- 'body'");
    expect(migration).toContain("- 'comment'");
  });

  it("supports idempotent create/reply, bulk max 50, CSAT and SLA escalation", () => {
    expect(migration).toContain("idx_support_tickets_request_id");
    expect(migration).toContain("idx_support_tickets_staff_request_id");
    expect(migration).toContain("idx_support_ticket_messages_request_id");
    expect(migration).toContain("array_length(p_ticket_ids, 1), 0) not between 1 and 50");
    expect(migration).toContain("create table if not exists public.support_ticket_csat");
    expect(migration).toContain("on conflict (ticket_id) do nothing");
    expect(migration).toContain("get diagnostics v_inserted = row_count");
    expect(migration).toContain("unique (ticket_id, alert_kind, due_at)");
    expect(migration).toContain("sla_first_response_warning");
    expect(migration).toContain("sla_resolution_warning");
  });

  it("provides uncapped metrics and globally ranked queue RPCs", () => {
    expect(migration).toContain("support_ticket_metrics_v2");
    expect(migration).toContain("support_ticket_queue_v2");
    expect(migration).toContain("p_status = 'cozulmus'");
    expect(migration).toContain("p_unassigned boolean default false");
    expect(migration).toContain("'categoryCounts', c.value");
    expect(migration).toContain("t.body");
    expect(migration).toContain("t.resolution_due_at");
    expect(migration).toContain("t.resolution_breached_at");
    expect(migration.match(/support_sla_warning_interval/g)?.length).toBeGreaterThanOrEqual(9);
    expect(migration).not.toContain("limit 2000");
  });
});
