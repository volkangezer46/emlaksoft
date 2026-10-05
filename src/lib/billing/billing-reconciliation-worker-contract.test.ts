import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/lib/billing/reconciliation.ts"),
  "utf8",
);
const route = readFileSync(
  resolve(process.cwd(), "src/app/api/cron/billing-reconciliation/route.ts"),
  "utf8",
);
const leaseMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260810000950_billing_reconciliation_leases.sql",
  ),
  "utf8",
);

describe("billing reconciliation worker contract", () => {
  it("processes only durable pending captures in bounded batches", () => {
    expect(source).toContain('admin.rpc("claim_billing_payment_captures"');
    expect(source).toContain("p_worker_id: workerId");
    expect(source).toContain("Math.min(Math.trunc(limit), 200)");
  });

  it("claims captures with a crash-recoverable exclusive lease and bounded attempts", () => {
    expect(leaseMigration).toContain("for update skip locked");
    expect(leaseMigration).toContain("reconciliation_worker_id = p_worker_id");
    expect(leaseMigration).toContain("interval '15 minutes'");
    expect(leaseMigration).toContain("reconciliation_attempt_count < 6");
    expect(leaseMigration).toContain("last_error_code = 'retry_limit'");
  });

  it("re-validates target identity and tenant before retrying fulfillment", () => {
    expect(source).toContain('.eq("tenant_id", capture.tenant_id)');
    expect(source).toContain('.filter("meta->>conversationId", "eq", capture.conversation_id)');
    expect(source).toContain('.eq("token", token)');
    expect(source).toContain("isPlanId(plan)");
  });

  it("expires stale drafts but never performs an automatic refund", () => {
    expect(source).toContain('admin.rpc("expire_stale_billing_checkouts"');
    expect(source).toContain("It never issues a refund");
    expect(source).not.toMatch(/refundPayment|createRefund|iyzico.*refund/i);
  });

  it("runs behind the cron secret and records an operational heartbeat", () => {
    expect(route).toMatch(/authorizeCron|CRON_SECRET/);
    expect(route).toContain('runBillingReconciliation(50)');
    expect(route).toContain('recordHeartbeat("billing-reconciliation"');
  });
});
