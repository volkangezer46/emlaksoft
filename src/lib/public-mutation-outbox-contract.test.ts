import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260810000990_public_mutation_outbox.sql");
const worker = read("src/lib/public-mutation-outbox.ts");
const route = read("src/app/api/cron/public-mutation-outbox/route.ts");
const booking = read("src/app/actions/booking-public.ts");
const owner = read("src/app/actions/owner-portal-offers.ts");
const appointment = read("src/app/actions/appointments-confirm.ts");
const cronJobs = read("src/lib/cron-jobs.ts");
const vercel = read("vercel.json");

describe("public mutation durable-effect contract", () => {
  it("keeps the queue private and every queue RPC service-role-only", () => {
    expect(migration).toContain("create table if not exists public.public_mutation_outbox");
    expect(migration).toContain("alter table public.public_mutation_outbox enable row level security");
    expect(migration).toContain("revoke all privileges on table public.public_mutation_outbox");
    expect(migration).toContain("public_mutation_outbox_service_role_only");

    for (const name of [
      "enqueue_public_mutation_effect",
      "claim_public_mutation_effects",
      "complete_public_mutation_effect",
      "fail_public_mutation_effect",
      "prune_public_mutation_effects",
    ]) {
      const start = migration.indexOf(`create or replace function public.${name}`);
      expect(start).toBeGreaterThan(0);
      const section = migration.slice(start, migration.indexOf("grant execute", start) + 300);
      expect(section).toContain("security definer");
      expect(section).toContain("auth.role() is distinct from 'service_role'");
      expect(section).toContain("from public, anon, authenticated");
      expect(section).toContain("to service_role");
    }
  });

  it("commits state, deduplicated audit and notification intent in one RPC transaction", () => {
    expect(migration).toContain("public_mutation_key text");
    expect(migration).toContain("on conflict (dedupe_key) do update");
    expect(migration).toContain("insert into public.audit_logs");
    expect(migration).toContain("on conflict (tenant_id, public_mutation_key) do nothing");

    for (const stateCall of [
      "create_public_booking_atomic_state_v1",
      "respond_owner_offer_atomic_state_v1",
      "respond_appointment_confirmation_atomic_state_v1",
    ]) {
      const call = migration.indexOf(`v_result := public.${stateCall}`);
      const enqueue = migration.indexOf("perform public.enqueue_public_mutation_effect", call);
      const functionEnd = migration.indexOf("end;\n$$;", call);
      expect(call).toBeGreaterThan(0);
      expect(enqueue).toBeGreaterThan(call);
      expect(enqueue).toBeLessThan(functionEnd);
    }
  });

  it("rolls back a successful state transition if its durable effect cannot be derived", () => {
    const bookingStart = migration.indexOf(
      "create or replace function public.create_public_booking_atomic(",
    );
    const ownerStart = migration.indexOf(
      "create or replace function public.respond_owner_offer_atomic(",
      bookingStart,
    );
    const appointmentStart = migration.indexOf(
      "create or replace function public.respond_appointment_confirmation_atomic(",
      ownerStart,
    );
    const bookingWrapper = migration.slice(bookingStart, ownerStart);
    const ownerWrapper = migration.slice(ownerStart, appointmentStart);
    const appointmentWrapper = migration.slice(appointmentStart);

    expect(bookingWrapper).toContain("Public booking effect source disappeared.");
    expect(bookingWrapper).toContain("Public booking effect target disappeared.");
    expect(bookingWrapper).not.toContain("inner join public.tenants t");
    expect(bookingWrapper).not.toContain("inner join public.profiles p");

    expect(ownerWrapper).toContain("Owner offer effect source disappeared.");
    expect(ownerWrapper).not.toContain("opt.expires_at >= clock_timestamp()");
    expect(ownerWrapper).not.toContain("inner join public.tenants t");

    expect(appointmentWrapper).toContain(
      "Appointment confirmation effect target disappeared.",
    );
    expect(appointmentWrapper).not.toContain("inner join public.tenants t");
  });

  it("blocks notification-key poisoning and verifies every idempotent conflict", () => {
    expect(migration).toContain("function public.guard_notification_public_mutation_key()");
    expect(migration).toContain("trg_guard_notification_public_mutation_key");
    expect(migration).toContain("new.public_mutation_key is not null");
    expect(migration).toContain("new.public_mutation_key is distinct from old.public_mutation_key");
    expect(migration).toContain("drop policy if exists notifications_tenant_insert");
    expect(migration).toContain("revoke insert on table public.notifications from authenticated");
    expect(migration).not.toContain("create policy notifications_tenant_insert");
    expect(migration).toContain("v_notification.user_id is not distinct from v_target_user");
    expect(migration).toContain("v_notification.meta is not distinct from v_expected_meta");
    expect(migration).toContain("last_error_code = 'notification_dedupe_conflict'");
    expect(migration).toContain("'reason', 'notification_dedupe_conflict'");
  });

  it("makes renamed state helpers callable only by their security-definer wrappers", () => {
    for (const signature of [
      "create_public_booking_atomic_state_v1",
      "respond_owner_offer_atomic_state_v1",
      "respond_appointment_confirmation_atomic_state_v1",
    ]) {
      const start = migration.indexOf(`revoke all on function public.${signature}`);
      const end = migration.indexOf(";", start);
      expect(start).toBeGreaterThan(0);
      expect(migration.slice(start, end)).toContain(
        "from public, anon, authenticated, service_role",
      );
    }
  });

  it("uses authoritative locked rows and never action preflight snapshots for effects", () => {
    expect(migration).toContain("o.status::text as decision");
    expect(migration).toContain("and o.status::text = v_decision");
    expect(migration).toContain("and a.customer_response = v_response");
    expect(migration).toContain("and a.public_booking_request_key = v_request_key");

    for (const action of [booking, owner, appointment]) {
      expect(action).not.toContain("notifyTenant");
      expect(action).not.toContain("logActivity");
    }
    expect(booking).not.toContain('.from("booking_settings")');
    expect(owner).not.toContain('.from("offers")');
    expect(appointment).not.toContain('.from("appointments")');
  });

  it("validates notification targets within the tenant and excludes booking phone/note PII", () => {
    expect(migration).toContain("constraint notifications_user_tenant_fkey");
    expect(migration).toContain("foreign key (user_id, tenant_id)");
    expect(migration).toContain("references public.profiles(id, tenant_id)");
    expect(migration).toContain("p.tenant_id = v_job.tenant_id");
    expect(migration).toContain("p.is_active = true");
    expect(migration).toContain("last_error_code = 'notification_target_unavailable'");
    expect(migration).toContain("'state', 'dead_letter'");
    expect(migration).not.toContain("retain office visibility");
    expect(migration).toContain("p_audit_actor_id => null");

    const bookingEffectStart = migration.indexOf(
      "perform public.enqueue_public_mutation_effect",
      migration.indexOf("create or replace function public.create_public_booking_atomic"),
    );
    const bookingEffectEnd = migration.indexOf("return jsonb_build_object", bookingEffectStart);
    const bookingEffect = migration.slice(bookingEffectStart, bookingEffectEnd);
    expect(bookingEffect).not.toContain("p_phone");
    expect(bookingEffect).not.toContain("p_note");
    expect(bookingEffect).toContain("p_notification_body => to_char");
  });

  it("leases with CAS, retries with backoff, dead-letters and prunes bounded history", () => {
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("lease_token = gen_random_uuid()");
    expect(migration).toContain("and q.lease_token = p_lease_token");
    expect(migration).toContain("when 4 then interval '2 hours'");
    expect(migration).toContain("then 'dead_letter' else 'retry'");
    expect(migration).toContain("q.completed_at < now() - interval '90 days'");
    expect(migration).toContain("q.dead_lettered_at < now() - interval '365 days'");

    expect(worker).toContain('admin.rpc(\n    "claim_public_mutation_effects"');
    expect(worker).toContain('"complete_public_mutation_effect"');
    expect(worker).toContain('"fail_public_mutation_effect"');
    expect(worker).toContain('"prune_public_mutation_effects"');
    expect(worker).toContain("p_lease_token: job.leaseToken");
  });

  it("surfaces queue backlog and dead letters in the protected admin cron health", () => {
    expect(worker).toContain("pendingBacklog");
    expect(worker).toContain("deadLetterBacklog");
    expect(route).toMatch(/authorizeCron|CRON_SECRET/);
    expect(route).toContain('recordHeartbeat("public-mutation-outbox"');
    expect(route).toContain("JSON.stringify(summary)");
    expect(cronJobs).toContain('job: "public-mutation-outbox"');
    expect(vercel).toContain('"path": "/api/cron/public-mutation-outbox"');
  });
});
