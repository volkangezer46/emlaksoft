import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

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
      "src/app/actions/owner-portal-offers.ts",
    ];
    for (const file of files) expect(read(file)).toContain("isPublicTenantActive");
  });

  it("guards appointment, open-house, referral and survey pages/actions", () => {
    const files = [
      "src/app/randevu-al/[token]/page.tsx",
      "src/app/randevu-teyit/[token]/page.tsx",
      "src/app/acik-ev-kayit/[token]/page.tsx",
      "src/app/tavsiye/[token]/page.tsx",
      "src/app/actions/booking-public.ts",
      "src/app/actions/appointments-confirm.ts",
      "src/app/actions/open-house-public.ts",
      "src/app/actions/referral-public.ts",
      "src/app/actions/survey-public.ts",
      "src/app/anket/[token]/page.tsx",
      "src/app/degerleme-raporu/[token]/page.tsx",
      "src/app/danisman/[slug]/vcard/route.ts",
    ];
    for (const file of files) expect(read(file)).toContain("isPublicTenantActive");
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
