import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const fulfillment = read("src/lib/billing/fulfillment.ts");
const paymentLink = read("src/lib/billing/payment-link-fulfill.ts");
const callback = read("src/app/api/iyzico/callback/route.ts");
const webhook = read("src/app/api/iyzico/webhook/route.ts");
const billingAction = read("src/app/actions/billing.ts");
const paymentLinkAction = read("src/app/actions/payment-links.ts");
const iyzico = read("src/lib/billing/iyzico.ts");
const historicalMigration = read("supabase/migrations/20260731000138_atomic_billing_fulfillment.sql");
const hardeningMigration = read("supabase/migrations/20260809000000_billing_fulfillment_hardening.sql");
const reconciliationMigration = read("supabase/migrations/20260810000100_billing_checkout_reconciliation.sql");

describe("atomic billing fulfillment contract", () => {
  it("routes subscription and payment-link writes exclusively through the RPC", () => {
    expect(fulfillment).toContain('admin.rpc("fulfill_billing_payment_v2"');
    expect(fulfillment).not.toContain('.from("subscriptions")');
    expect(fulfillment).not.toContain('.from("tenants")');
    expect(fulfillment).not.toContain("existingPaid");
    expect(fulfillment).not.toContain("openInvoice");
    expect(paymentLink).toContain("fulfillBillingPaymentAtomic({");
    expect(paymentLink).not.toContain(".update(");
    expect(paymentLink).not.toContain(".insert(");
  });

  it("binds provider identity, target and verified expectations", () => {
    for (const field of [
      "p_provider",
      "p_conversation_id",
      "p_payment_id",
      "p_source",
      "p_target_type",
      "p_expected_tenant_id",
      "p_expected_plan",
      "p_expected_cycle",
      "p_expected_amount_try",
      "p_expected_currency",
    ]) {
      expect(fulfillment).toContain(field);
    }
    expect(paymentLink).toContain('targetType: "payment_link"');
    expect(paymentLink).toContain("expectedTenantId: link.tenant_id");
    expect(paymentLink).toContain("verifyCheckoutPayment(");
    expect(paymentLink).toContain("expectedAmountTry: verified?.amountTry ?? amountTry");
    expect(callback).toMatch(/"callback",\s*result/);
    expect(webhook).toMatch(/"webhook",\s*providerResult,\s*providerPaymentId/);
    expect(callback).toContain("verifyCheckoutPayment(result");
    expect(webhook).toContain("retrieveCheckoutForm(String(body.token))");
    expect(webhook).toContain('error: "checkout_verification_required"');
  });

  it("keeps the database boundary service-only, fixed-search-path and expectation-aware", () => {
    // The applied migration is immutable ledger history. Security upgrades
    // belong to the forward-only hardening migration that precedes the v2 wrapper.
    expect(historicalMigration).toContain("create or replace function public.fulfill_billing_payment(");
    expect(historicalMigration).toContain("set search_path = public, pg_temp");
    expect(historicalMigration).not.toContain("p_expected_currency text default null");
    expect(hardeningMigration).toContain("create or replace function public.fulfill_billing_payment(");
    expect(hardeningMigration).toContain("p_expected_currency text default null");
    expect(hardeningMigration).toContain("set search_path = ''");
    expect(hardeningMigration).toContain("if auth.role() is distinct from 'service_role'");
    expect(hardeningMigration).toContain("Payment link tenant does not match.");
    expect(hardeningMigration).toContain("Payment link amount does not match.");
    expect(hardeningMigration).toContain("Expected payment currency must be TRY.");
    expect(hardeningMigration).toContain("create unique index if not exists uq_invoices_conversation_id");
    expect(hardeningMigration).toContain("from public, anon, authenticated, service_role");
    expect(hardeningMigration).toContain(") to service_role;");
    expect(reconciliationMigration).toContain("create or replace function public.fulfill_billing_payment_v2(");
    expect(reconciliationMigration).toContain("set search_path = ''");
    expect(reconciliationMigration).toContain("record_billing_payment_capture");
  });

  it("uses cryptographic invoice nonces and fails closed on RPC errors", () => {
    expect(fulfillment).toContain('randomBytes(6).toString("hex")');
    expect(fulfillment).not.toContain("Math.random");
    expect(fulfillment).toContain("if (error)");
    expect(fulfillment).toContain("throw new Error");
  });

  it("charges gross VAT totals, verifies provider responses and uses the real request IP", () => {
    expect(billingAction).toContain("price: invoiceAmounts.totalTry");
    expect(billingAction).toContain("paidPrice: invoiceAmounts.totalTry");
    expect(billingAction).toContain("ip: await clientIp()");
    expect(paymentLinkAction).toContain("const ip = await clientIp()");
    expect(iyzico).toContain("normalizeIyzicoBuyerIp(input.buyer.ip)");
    expect(iyzico).not.toContain('ip: "85.34.78.112"');
    expect(iyzico).toContain("verifyCheckoutRetrieveResponseSignature(result)");
    expect(iyzico).toContain("fields.join(\":\")");
    expect(iyzico).toContain("randomKey + path + body");
    expect(billingAction).not.toContain("11111111111");
    expect(billingAction).not.toContain("@emlaksoft.test");
    expect(paymentLinkAction).not.toContain("11111111111");
    expect(paymentLinkAction).not.toContain("@emlaksoft.test");
  });
});
