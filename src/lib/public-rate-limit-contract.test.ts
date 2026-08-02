import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FAIL_CLOSED_RATE_LIMIT_FILES = [
  "src/app/actions/ai-advisor.ts",
  "src/app/actions/ai-tenant-advisor.ts",
  "src/app/actions/appointments-confirm.ts",
  "src/app/actions/auth.ts",
  "src/app/actions/booking-public.ts",
  "src/app/actions/contracts.ts",
  "src/app/actions/demo-login.ts",
  "src/app/actions/demo.ts",
  "src/app/actions/open-house-public.ts",
  "src/app/actions/password-reset.ts",
  "src/app/actions/payment-links.ts",
  "src/app/actions/referral-public.ts",
  "src/app/actions/survey-public.ts",
  "src/app/actions/vitrin-alerts.ts",
  "src/app/actions/vitrin.ts",
  "src/app/api/ai/admin-chat/route.ts",
  "src/app/api/takvim/[token]/route.ts",
  "src/app/danisman/[slug]/vcard/route.ts",
  "src/app/giris/dogrulama/actions.ts",
] as const;

function count(source: string, needle: string) {
  return source.split(needle).length - 1;
}

describe("security and cost-sensitive rate-limit contract", () => {
  for (const file of FAIL_CLOSED_RATE_LIMIT_FILES) {
    it(`${file} fails closed when rate-limit infrastructure is unavailable`, () => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      const calls = count(source, "checkRateLimit(");
      expect(calls).toBeGreaterThan(0);
      expect(count(source, 'failurePolicy: "deny"')).toBe(calls);
    });
  }
});
