import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PLANS } from "./plans";

const priceBearingMigrations = [
  "20260731000138_atomic_billing_fulfillment.sql",
  "20260731000140_atomic_registration_provisioning.sql",
  "20260802000300_identity_session_authorization_hardening.sql",
].map((filename) =>
  readFileSync(resolve(process.cwd(), "supabase/migrations", filename), "utf8"),
);

describe("billing plan price contract", () => {
  it.each(PLANS)("keeps $id database prices aligned with the catalog", (plan) => {
    for (const migration of priceBearingMigrations) {
      expect(migration).toContain(`when '${plan.id}' then ${plan.monthlyTry}`);
    }
  });
});
