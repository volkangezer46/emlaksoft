import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260810000100_billing_checkout_reconciliation.sql");
const atomicMigration = read("supabase/migrations/20260731000138_atomic_billing_fulfillment.sql");
const fulfillment = read("src/lib/billing/fulfillment.ts");
const billingAction = read("src/app/actions/billing.ts");
const paymentLinks = read("src/app/actions/payment-links.ts");

describe("captured-payment reconciliation contract", () => {
  it("makes payment replays idempotent while retaining duplicate captures for refund review", () => {
    expect(atomicMigration).toContain("unique (provider, conversation_id)");
    expect(migration).toContain("unique (provider, payment_id)");
    expect(migration).toContain("idx_billing_payment_captures_conversation");
    expect(migration).toContain("on conflict (provider, payment_id) do update");
    expect(migration).toContain("attempt_count = public.billing_payment_captures.attempt_count + 1");
    expect(migration).not.toMatch(/on conflict \(provider, payment_id\)[\s\S]{0,300}status\s*=/);
  });

  it("records a verified capture before fulfillment and queues a failed local write", () => {
    const recordAt = fulfillment.indexOf('"record_billing_payment_capture"');
    const fulfillAt = fulfillment.indexOf('"fulfill_billing_payment_v2"');
    expect(recordAt).toBeGreaterThan(-1);
    expect(fulfillAt).toBeGreaterThan(recordAt);
    expect(fulfillment).toContain("captureFailureStatus(error.code)");
    expect(fulfillment).toContain('return "retry_pending"');
    expect(fulfillment).toContain('transitionCapture(captureId, "fulfilled"');
  });

  it("protects terminal reconciliation states from invalid regressions", () => {
    expect(migration).toContain("v_row.status = 'fulfilled' and v_status <> 'fulfilled'");
    expect(migration).toContain("v_row.status = 'refunded' and v_status <> 'refunded'");
    expect(migration).toContain("v_row.status = 'refund_required'");
    expect(migration).toContain("'refund_required', 'refunded', 'manual_review'");
  });
});

describe("checkout and renewal state contract", () => {
  it("keeps abandoned checkout invoices in draft and opens them only behind a capture claim", () => {
    expect(fulfillment).toContain('status: "draft"');
    expect(fulfillment).toContain('checkout_status: "pending_checkout"');
    expect(billingAction).toContain("markCheckoutInvoiceInitialized");
    expect(migration).toContain("Durable captured payment claim required.");
    expect(migration).toContain("status = 'open'");
    expect(migration).toContain("checkout_status = 'captured_pending'");
  });

  it("extends renewals from the later of the current period end or now", () => {
    expect(migration).toContain("greatest(coalesce(v_previous_end, v_now), v_now)");
    expect(migration).toContain("v_period_base + interval '1 year'");
    expect(migration).toContain("v_period_base + interval '1 month'");
    expect(migration).toContain("coalesce((v_result ->> 'already')::boolean, false) = false");
  });

  it("preflights downgrade capacity before creating the provider checkout", () => {
    expect(billingAction.indexOf("assertBillingPlanPreflight"))
      .toBeLessThan(billingAction.indexOf("createCheckoutInvoice({"));
    expect(migration).toContain("billing_plan_change_preflight");
    expect(migration).toContain("v_seats > v_limits.seat_limit");
    expect(migration).toContain("v_properties > v_limits.active_property_limit");
  });
});

describe("payment-link tenant and state contract", () => {
  it("enforces composite tenant references in the database", () => {
    expect(migration).toContain("foreign key (tenant_id, customer_id)");
    expect(migration).toContain("foreign key (tenant_id, commission_id)");
    expect(migration).toContain("foreign key (tenant_id, created_by)");
    expect(migration).toContain("validate constraint payment_links_tenant_customer_fkey");
  });

  it("prevalidates tenant ownership and requires an open link before provider initialization", () => {
    expect(paymentLinks).toContain('.eq("tenant_id", gate.tenantId)');
    expect(paymentLinks).toContain('link.status !== "open"');
    expect(paymentLinks).toContain('.eq("status", "open")');
    expect(paymentLinks).toContain("validateCheckoutBuyer");
    expect(paymentLinks).not.toContain("11111111111");
  });
});
