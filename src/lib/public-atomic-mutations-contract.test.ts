import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const stateMigration = read("supabase/migrations/20260810000970_public_atomic_mutations.sql");
const effectMigration = read("supabase/migrations/20260810000990_public_mutation_outbox.sql");
const bookingAction = read("src/app/actions/booking-public.ts");
const ownerOfferAction = read("src/app/actions/owner-portal-offers.ts");
const appointmentAction = read("src/app/actions/appointments-confirm.ts");

function functionBody(source: string, name: string, nextName?: string): string {
  const start = source.indexOf(`create or replace function public.${name}`);
  const end = nextName
    ? source.indexOf(`create or replace function public.${nextName}`, start + 1)
    : source.length;
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("public capability mutation atomicity contract", () => {
  it("keeps every public mutation RPC service-role-only", () => {
    const names = [
      "create_public_booking_atomic",
      "respond_owner_offer_atomic",
      "respond_appointment_confirmation_atomic",
    ];
    for (const [index, name] of names.entries()) {
      const section = functionBody(stateMigration, name, names[index + 1]);
      expect(section).toContain("security definer");
      expect(section).toContain("auth.role() is distinct from 'service_role'");
      expect(section).toContain("from public, anon, authenticated");
      expect(section).toContain("to service_role");
    }
  });

  it("serializes booking and lets replay reach the durable-effect wrapper", () => {
    const state = functionBody(
      stateMigration,
      "create_public_booking_atomic",
      "respond_owner_offer_atomic",
    );
    expect(state).toContain("for update of bs");
    expect(state).toContain("from public.staff_leaves l");
    expect(state).toContain("from public.appointments a");
    expect(state).toContain("insert into public.customers");
    expect(state).toContain("insert into public.appointments");

    const wrapper = functionBody(
      effectMigration,
      "create_public_booking_atomic",
      "respond_owner_offer_atomic",
    );
    expect(wrapper).toContain("create_public_booking_atomic_state_v1");
    expect(wrapper).toContain("public_booking_request_key");
    expect(wrapper).toContain("perform public.enqueue_public_mutation_effect");
    expect(wrapper).toContain("then 'created' else 'replay'");

    expect(bookingAction).toContain('admin.rpc(\n    "create_public_booking_atomic"');
    expect(bookingAction).toContain('outcome !== "created" && outcome !== "replay"');
    expect(bookingAction).not.toMatch(/\.from\("(?:appointments|customers|booking_settings)"\)/);
    expect(bookingAction).not.toContain("notifyTenant");
    expect(bookingAction).not.toContain("logActivity");
  });

  it("makes owner-offer exact replay repair effects without stale action reads", () => {
    const state = functionBody(
      stateMigration,
      "respond_owner_offer_atomic",
      "respond_appointment_confirmation_atomic",
    );
    expect(state).toContain("for update of o");
    expect(state).toContain("v_offer.status <> 'submitted'::public.offer_status");
    expect(state).toContain("'outcome', 'already_finalized'");

    const wrapper = functionBody(
      effectMigration,
      "respond_owner_offer_atomic",
      "respond_appointment_confirmation_atomic",
    );
    expect(wrapper).toContain("respond_owner_offer_atomic_state_v1");
    expect(wrapper).toContain("(v_result ->> 'current_status') = v_decision");
    expect(wrapper).toContain("v_outcome := 'replay'");
    expect(wrapper).toContain("perform public.enqueue_public_mutation_effect");
    expect(wrapper).toContain("o.status::text = v_decision");

    expect(ownerOfferAction).toContain('admin.rpc(\n    "respond_owner_offer_atomic"');
    expect(ownerOfferAction).toContain('outcome !== "applied" && outcome !== "replay"');
    expect(ownerOfferAction).not.toMatch(/\.from\("(?:offers|properties|owner_portal_tokens)"\)/);
    expect(ownerOfferAction).not.toContain("notifyTenant");
    expect(ownerOfferAction).not.toContain("logActivity");
  });

  it("keeps appointment replies single-winner and replay-repairable", () => {
    const state = functionBody(stateMigration, "respond_appointment_confirmation_atomic");
    const rowLock = state.indexOf("for update of a");
    const replay = state.indexOf("v_appointment.customer_response = v_response", rowLock);
    const contradiction = state.indexOf("v_appointment.customer_response is not null", replay);
    const nullCas = state.indexOf("and customer_response is null", contradiction);
    expect(rowLock).toBeGreaterThan(0);
    expect(replay).toBeGreaterThan(rowLock);
    expect(contradiction).toBeGreaterThan(replay);
    expect(nullCas).toBeGreaterThan(contradiction);

    const wrapper = functionBody(effectMigration, "respond_appointment_confirmation_atomic");
    expect(wrapper).toContain("respond_appointment_confirmation_atomic_state_v1");
    expect(wrapper).toContain("v_outcome not in ('applied', 'replay')");
    expect(wrapper).toContain("a.customer_response = v_response");
    expect(wrapper).toContain("perform public.enqueue_public_mutation_effect");

    expect(appointmentAction).toContain(
      'admin.rpc(\n    "respond_appointment_confirmation_atomic"',
    );
    expect(appointmentAction).toContain('outcome !== "applied" && outcome !== "replay"');
    expect(appointmentAction).not.toMatch(/\.from\("appointments"\)/);
    expect(appointmentAction).not.toContain("notifyTenant");
  });
});
