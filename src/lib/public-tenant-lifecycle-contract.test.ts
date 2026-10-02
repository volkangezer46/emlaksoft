import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");
const atomicMigration = read("supabase/migrations/20260810000970_public_atomic_mutations.sql");
const effectMigration = read("supabase/migrations/20260810000990_public_mutation_outbox.sql");

function functionBody(source: string, name: string, nextName?: string): string {
  const start = source.indexOf(`create or replace function public.${name}`);
  const end = nextName
    ? source.indexOf(`create or replace function public.${nextName}`, start + 1)
    : source.length;
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("public tenant lifecycle contract", () => {
  it("guards all vitrin reads, metadata, favorites and lead writes", () => {
    const files = [
      "src/app/vitrin/[slug]/page.tsx",
      "src/app/vitrin/[slug]/[id]/page.tsx",
      "src/app/vitrin/[slug]/favoriler/page.tsx",
      "src/app/vitrin/[slug]/degerleme/page.tsx",
      "src/app/api/vitrin-favoriler/route.ts",
      "src/app/lead/[token]/page.tsx",
      "src/lib/lead-intake.ts",
      "src/app/actions/vitrin.ts",
      "src/app/actions/vitrin-alerts.ts",
      "src/app/actions/public-valuation.ts",
    ];
    for (const file of files) expect(read(file)).toContain("isPublicTenantActive");
    for (const file of files.slice(0, 4)) expect(read(file)).toContain("revalidate = 60");
  });

  it("guards private portal data and every portal mutation", () => {
    const files = [
      "src/app/actions/customer-portal.ts",
      "src/app/actions/owner-portal.ts",
      "src/app/actions/customer-portal-feedback.ts",
    ];
    for (const file of files) expect(read(file)).toContain("isPublicTenantActive");

    const ownerOfferAction = read("src/app/actions/owner-portal-offers.ts");
    expect(ownerOfferAction).toContain('"respond_owner_offer_atomic"');
    const ownerState = functionBody(
      atomicMigration,
      "respond_owner_offer_atomic",
      "respond_appointment_confirmation_atomic",
    );
    const ownerEffect = functionBody(
      effectMigration,
      "respond_owner_offer_atomic",
      "respond_appointment_confirmation_atomic",
    );
    expect(ownerState).toContain("t.status in ('trial', 'active', 'past_due')");
    expect(ownerEffect).not.toContain("opt.expires_at >= clock_timestamp()");
    expect(ownerEffect).toContain("Owner offer effect source disappeared.");
  });

  it("guards appointment, open-house, referral and survey pages/actions", () => {
    const files = [
      "src/app/randevu-al/[token]/page.tsx",
      "src/app/randevu-teyit/[token]/page.tsx",
      "src/app/acik-ev-kayit/[token]/page.tsx",
      "src/app/tavsiye/[token]/page.tsx",
      "src/app/actions/open-house-public.ts",
      "src/app/actions/referral-public.ts",
      "src/app/actions/survey-public.ts",
      "src/app/anket/[token]/page.tsx",
      "src/app/degerleme-raporu/[token]/page.tsx",
      "src/app/danisman/[slug]/vcard/route.ts",
    ];
    for (const file of files) expect(read(file)).toContain("isPublicTenantActive");

    const bookingAction = read("src/app/actions/booking-public.ts");
    const appointmentAction = read("src/app/actions/appointments-confirm.ts");
    expect(bookingAction).toContain('"create_public_booking_atomic"');
    expect(appointmentAction).toContain('"respond_appointment_confirmation_atomic"');

    const bookingState = functionBody(
      atomicMigration,
      "create_public_booking_atomic",
      "respond_owner_offer_atomic",
    );
    const appointmentState = functionBody(
      atomicMigration,
      "respond_appointment_confirmation_atomic",
    );
    expect(bookingState).toContain("t.status in ('trial', 'active', 'past_due')");
    expect(appointmentState).toContain("t.status in ('trial', 'active', 'past_due')");
  });

  it("guards contract signing and payment link pages/actions", () => {
    const files = [
      "src/app/imza/[token]/page.tsx",
      "src/app/odeme-link/[token]/page.tsx",
      "src/app/actions/contracts.ts",
      "src/app/actions/payment-links.ts",
    ];
    for (const file of files) expect(read(file)).toContain("isPublicTenantActive");
  });
});
