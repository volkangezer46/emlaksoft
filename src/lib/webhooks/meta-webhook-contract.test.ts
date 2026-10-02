import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const route = read("src/app/api/webhooks/meta/route.ts");
const inbound = read("src/lib/webhooks/meta-inbound.ts");
const contract = read("src/lib/webhooks/meta-contract.ts");
const inboxMigration = read("supabase/migrations/20260731000132_professional_messaging.sql");
const campaignMigration = read("supabase/migrations/20260810000920_campaign_delivery_compliance.sql");
const bindingMigration = read("supabase/migrations/20260810000980_whatsapp_binding_verification.sql");

describe("Meta inbound webhook production contract", () => {
  it("authenticates raw bytes before decoding or parsing", () => {
    const signature = route.indexOf("verifyMetaSignature(appSecret, bodyBytes");
    const parse = route.indexOf("parseMetaWebhookBytes(bodyBytes)");

    expect(signature).toBeGreaterThan(0);
    expect(parse).toBeGreaterThan(signature);
    expect(contract).toContain('createHmac("sha256", appSecret).update(bodyBytes)');
    expect(contract).toContain("timingSafeEqual(expected, supplied)");
  });

  it("rejects malformed payloads and asks Meta to retry processing failures", () => {
    expect(route).toContain('return json({ ok: false, error: "invalid_payload" }, 400)');
    expect(route).toContain('return json({ ok: false, error: "processing_failed" }, 503)');
    expect(route).toContain("if (!result.ok) failed += 1");
    expect(route).toContain("for (const status of parsed.statuses)");
    expect(route).toContain("ingestMetaDeliveryStatus(status)");
    expect(route).not.toContain("rawBody");
  });

  it("uses the provider event uniqueness constraint plus a reclaimable processing lease", () => {
    expect(inboxMigration).toMatch(/unique \(provider, provider_event_id\)/);
    expect(inbound).toContain('insertError.code !== "23505"');
    expect(inbound).toContain("EVENT_CLAIM_LEASE_MS");
    expect(inbound).toContain('.lt("last_attempt_at", staleBefore)');
    expect(inbound).toContain('outcome: "busy"');
    expect(inbound).toContain('reason: "event_in_progress"');
  });

  it("routes tenants only through an exact healthy verified phone/WABA binding", () => {
    const integrationLookup = inbound.indexOf('admin.rpc("resolve_verified_whatsapp_tenant"');
    const routingKey = inbound.indexOf("p_phone_number_id: phoneNumberId", integrationLookup);
    const wabaKey = inbound.indexOf("p_waba_id: wabaId", routingKey);
    const exactMatch = inbound.indexOf("rows.length !== 1", wabaKey);
    const tenantResolution = inbound.indexOf("tenantId: row.tenant_id", exactMatch);
    const customerLookup = inbound.indexOf('.from("customers")', tenantResolution);

    expect(integrationLookup).toBeGreaterThan(0);
    expect(routingKey).toBeGreaterThan(integrationLookup);
    expect(wabaKey).toBeGreaterThan(routingKey);
    expect(exactMatch).toBeGreaterThan(wabaKey);
    expect(tenantResolution).toBeGreaterThan(exactMatch);
    expect(customerLookup).toBeGreaterThan(tenantResolution);
    expect(bindingMigration).toContain("resolve_verified_whatsapp_tenant");
    expect(bindingMigration).toContain("ti.connection_status = 'healthy'");
    expect(bindingMigration).toContain("ti.binding_verified_at is not null");
    expect(bindingMigration).toContain("ti.whatsapp_business_account_id = btrim");
    // pgcrypto Supabase'de `extensions` şemasında; boş search_path'li fonksiyonlarda şema nitelemesi şart.
    expect(bindingMigration).toContain("ti.binding_fingerprint = encode(extensions.digest");
  });

  it("applies outbound statuses through an atomic tenant-bound campaign RPC", () => {
    const deliveryHandler = inbound.indexOf("export async function ingestMetaDeliveryStatus");
    const integrationLookup = inbound.indexOf("resolveVerifiedWhatsAppTenant(", deliveryHandler);
    const routingKey = inbound.indexOf("status.phoneNumberId", integrationLookup);
    const wabaKey = inbound.indexOf("status.wabaId", routingKey);
    const tenantResolution = inbound.indexOf("const tenantId = resolved.tenantId", wabaKey);
    const statusRpc = inbound.indexOf('admin.rpc("apply_campaign_recipient_provider_status"', tenantResolution);

    expect(deliveryHandler).toBeGreaterThan(0);
    expect(integrationLookup).toBeGreaterThan(deliveryHandler);
    expect(routingKey).toBeGreaterThan(integrationLookup);
    expect(wabaKey).toBeGreaterThan(routingKey);
    expect(tenantResolution).toBeGreaterThan(wabaKey);
    expect(statusRpc).toBeGreaterThan(tenantResolution);
    expect(inbound).toContain("p_tenant_id: tenantId");
    expect(inbound).toContain("p_provider_message_id: status.messageId");
    expect(inbound).toContain("(communicationMatches ?? []).length > 1");
    expect(inbound).not.toContain("(communicationMatches ?? []).length > 2");

    expect(campaignMigration).toContain("apply_campaign_recipient_provider_status");
    expect(campaignMigration).toContain("inner join public.campaigns c");
    expect(campaignMigration).toContain("and c.tenant_id = p_tenant_id");
    expect(campaignMigration).toContain("v_status not in ('sent', 'delivered', 'read', 'failed')");
    expect(campaignMigration).toContain("if v_current_rank >= 2 then");
    expect(campaignMigration).toContain("duplicate_or_out_of_order");
    expect(campaignMigration).toContain("from public, anon, authenticated");
    expect(campaignMigration).toContain(") to service_role;");
  });

  it("keeps logs, responses, and inbox claim payloads free of sender/message content", () => {
    expect(route).not.toMatch(/console\.(?:log|info|warn|error)\([^\n]*(?:message\.from|text\.body|rawBody)/);
    expect(inbound).toContain("safeErrorCode(error)");
    expect(inbound).not.toContain("processing failed\", detail");
    expect(contract).toContain("Deliberately excludes sender address and message content");
    expect(contract).toContain("Deliberately excludes recipient addresses and provider error details");
    const inboxPayloads = contract.match(/eventPayload:\s*\{[^}]*\}/g) ?? [];
    expect(inboxPayloads).toHaveLength(2);
    for (const payload of inboxPayloads) {
      expect(payload).not.toMatch(/\bfrom:/);
      expect(payload).not.toMatch(/\bbody:/);
      expect(payload).not.toMatch(/\brecipient_id:/);
    }
  });
});
