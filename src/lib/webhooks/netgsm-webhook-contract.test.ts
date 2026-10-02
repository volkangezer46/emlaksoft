import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const route = read("src/app/api/webhooks/netgsm-sms/route.ts");
const inbound = read("src/lib/webhooks/netgsm-inbound.ts");
const contract = read("src/lib/webhooks/netgsm-contract.ts");
const communications = read("src/app/actions/communications.ts");
const inboxMigration = read("supabase/migrations/20260731000132_professional_messaging.sql");

describe("Netgsm inbound webhook production contract", () => {
  it("accepts only the official provider field names and exact receiver routing", () => {
    expect(contract).toContain('const EVENT_ID_KEYS = ["messageid"]');
    expect(contract).toContain('const RECEIVER_KEYS = ["subscribernumber"]');
    expect(contract).not.toContain('"to",');
    expect(contract).not.toContain('"receiver",');

    const integrationLookup = inbound.indexOf('.from("tenant_integrations")');
    const routingKey = inbound.indexOf('.eq("external_account_id", message.receiver)', integrationLookup);
    const exactMatch = inbound.indexOf("(integrations ?? []).length !== 1", routingKey);
    const tenantResolution = inbound.indexOf("const tenantId = String(integrations![0].tenant_id)", exactMatch);
    const customerLookup = inbound.indexOf('.from("customers")', tenantResolution);

    expect(integrationLookup).toBeGreaterThan(0);
    expect(routingKey).toBeGreaterThan(integrationLookup);
    expect(exactMatch).toBeGreaterThan(routingKey);
    expect(tenantResolution).toBeGreaterThan(exactMatch);
    expect(customerLookup).toBeGreaterThan(tenantResolution);
  });

  it("uses a reclaimable inbox claim and requests provider retry while work is busy", () => {
    expect(inboxMigration).toMatch(/unique \(provider, provider_event_id\)/);
    expect(inbound).toContain('insertError.code !== "23505"');
    expect(inbound).toContain("NETGSM_EVENT_CLAIM_LEASE_MS");
    expect(inbound).toContain('.lt("last_attempt_at", staleBefore)');
    expect(inbound).toContain('outcome: "busy"');
    expect(inbound).toContain('reason: "event_in_progress"');
    expect(route).toContain('result.reason ?? "processing_failed" }, 503');
  });

  it("keeps inbox evidence and logs free of sender phone and message content", () => {
    expect(route).toContain("netgsmInboxPayload(parsed.value)");
    expect(route).toContain("quarantineEvidence(fields)");
    expect(contract).toContain("Webhook inbox evidence without customer phone or message content");
    expect(inbound).toContain("safeErrorCode(error)");
    expect(inbound).not.toContain('processing failed", detail');
  });

  it("removes the legacy customer-phone tenant guessing server action", () => {
    expect(communications).not.toContain("ingestInboundSms");
    expect(communications).not.toContain("no_customer_match");
    expect(communications).not.toContain("otherTenants");
  });

  it("compares webhook secrets at a fixed digest length", () => {
    expect(route).toContain('createHash("sha256").update(actual');
    expect(route).toContain('createHash("sha256").update(expected');
    expect(route).toContain("timingSafeEqual(actualDigest, expectedDigest)");
  });
});
