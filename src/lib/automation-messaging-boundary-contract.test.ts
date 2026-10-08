import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const engine = read("src/lib/automation-engine.ts");
const iysGate = read("src/lib/iys/gate.ts");
const actions = read("src/app/actions/automations.ts");
const labels = read("src/app/app/otomasyonlar/labels.ts");
const netgsm = read("src/lib/messaging/netgsm.ts");
const tenantProviders = read("src/lib/messaging/tenant-providers.ts");
const migration = read("supabase/migrations/20260810000920_campaign_delivery_compliance.sql");

describe("automation marketing messaging boundary", () => {
  it("binds SMS to a tenant-owned provider and current exact-channel consent", () => {
    expect(engine).toContain('from "@/lib/messaging/tenant-providers"');
    expect(engine).not.toContain('from "@/lib/messaging/netgsm"');
    expect(engine).toContain("prepareTenantSmsSender(automation.tenant_id)");
    expect(engine).toContain("resolveConsentedMarketingPhone(");
    // Kanal bazlı izin kararı merkezi İYS kapısındadır (tenant + müşteri + kanal sorgusu, granted ve geri alınmamış kuralı).
    expect(engine).toContain('from "@/lib/iys/gate"');
    expect(engine).toContain('kind: "automation"');
    expect(engine).toContain("gateIysRecipient(admin, { tenantId, kind: \"automation\", channel, customerId: payload.customerId })");
    expect(iysGate).toContain('.eq("tenant_id", tenantId)');
    expect(iysGate).toContain('.eq("channel", channel)');
    expect(iysGate).toContain('row.status === "granted"');
    expect(iysGate).toContain("row.revoked_at");
    expect(engine).toContain('.is("deleted_at", null)');
    expect(engine).toContain('.eq("blacklist", false)');
    expect(engine).not.toContain("if (payload.phone) return payload.phone");

    const sms = engine.slice(
      engine.indexOf('case "send_sms"'),
      engine.indexOf('case "send_whatsapp"'),
    );
    expect(sms.indexOf("prepareTenantSmsSender")).toBeLessThan(
      sms.indexOf("resolveConsentedMarketingPhone"),
    );
    expect(sms.indexOf("resolveConsentedMarketingPhone")).toBeLessThan(
      sms.indexOf("sender(recipient.phone, text)"),
    );
  });

  it("keeps legacy free-text WhatsApp automation fail-closed in engine, action and UI", () => {
    const whatsapp = engine.slice(
      engine.indexOf('case "send_whatsapp"'),
      engine.indexOf('case "assign_to_staff"'),
    );
    expect(whatsapp).toContain("whatsapp_template_contract_required");
    expect(whatsapp).not.toContain("sendWhatsApp");
    expect(whatsapp).not.toContain("prepareTenantWhatsAppSender");
    expect(actions).toContain('if (type === "send_whatsapp")');
    expect(actions).toContain("onaylı Meta şablon adı ve dil sözleşmesi");
    expect(labels).not.toContain('{ value: "send_whatsapp"');
  });
});

describe("outbound provider SSRF and redirect boundary", () => {
  it("allowlists global WhatsApp origins and refuses provider redirects", () => {
    expect(netgsm).toContain("isAllowedWhatsAppApiUrl");
    expect(netgsm).toContain("normalizeAllowedWhatsAppApiUrl");
    expect(netgsm).toContain("normalizeProviderBaseUrl(");
    expect(netgsm).toContain("fetchExternal(");
    expect(netgsm).toContain("WHATSAPP_MAX_RESPONSE_BYTES");
    expect(netgsm).toContain("NETGSM_MAX_RESPONSE_BYTES");
    expect(netgsm).not.toMatch(/\bfetch\s*\(/);
    expect(netgsm.match(/redirect: "error"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(tenantProviders).toContain("fetchExternal(");
    expect(tenantProviders).toContain("PROVIDER_MAX_RESPONSE_BYTES");
    expect(tenantProviders).not.toMatch(/\bfetch\s*\(/);
  });
});

describe("campaign provider status webhook contract", () => {
  it("is service-role-only, tenant-parent-bound, monotonic and ambiguity-safe", () => {
    expect(migration).toContain("create or replace function public.apply_campaign_recipient_provider_status");
    expect(migration).toContain("auth.role() is distinct from 'service_role'");
    expect(migration).toContain("c.tenant_id = p_tenant_id");
    expect(migration).toContain("cardinality(v_recipient_ids) <> 1");
    expect(migration).toContain("Ambiguous campaign provider message id.");
    expect(migration).toContain("if v_current_rank >= v_target_rank then");
    expect(migration).toContain("if v_current_rank >= 2 then");
    expect(migration).toContain("when v_target_rank >= 3 then coalesce(read_at, v_occurred_at)");
    expect(migration).toContain("delivery_state = 'dead_letter'");
    expect(migration).toContain("to service_role;");
  });
});
