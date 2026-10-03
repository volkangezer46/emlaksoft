import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  campaignDeliveryErrorForStorage,
  isRetryableCampaignDeliveryFailure,
} from "@/lib/campaign-delivery";
import {
  isValidWhatsAppTemplateMessage,
  sendWhatsAppTemplateWithConfig,
} from "@/lib/messaging/netgsm";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const action = read("src/app/actions/campaigns.ts");
const worker = read("src/lib/campaign-delivery.ts");
const tenantProviders = read("src/lib/messaging/tenant-providers.ts");
const netgsm = read("src/lib/messaging/netgsm.ts");
const signerSms = read("src/app/imza/_lib/sms.ts");
const dialog = read("src/app/app/kampanyalar/yeni/new-campaign-form.tsx");
const route = read("src/app/api/cron/campaign-delivery/route.ts");
const migration = read("supabase/migrations/20260810000920_campaign_delivery_compliance.sql");
const verificationMigration = read("supabase/migrations/20260810000980_whatsapp_binding_verification.sql");
const vercel = read("vercel.json");
const cronJobs = read("src/lib/cron-jobs.ts");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("campaign authorization and enqueue contract", () => {
  it("uses the campaign permission module for every campaign operation", () => {
    expect(action).not.toContain('requirePermission("customers"');
    expect(action).toContain('requirePermission("campaigns", "create")');
    expect(action).toContain('requirePermission("campaigns", "edit")');
    expect(action).toContain('requirePermission("campaigns", "view")');
    expect(action).toContain('requirePermission("campaigns", "delete")');
  });

  it("keeps manual send enqueue-only and rejects the unconfigured email channel", () => {
    expect(action).toContain('channel === "email"');
    expect(action).toContain('"enqueue_campaign_delivery"');
    expect(action).not.toContain("sendBulkSms");
    expect(action).not.toContain("sendWhatsApp");
    expect(action).not.toContain("sendSms");
    expect(action.indexOf('channel === "email"')).toBeLessThan(action.indexOf("createAdminClient()"));
  });

  it("creates the campaign and complete recipient snapshot in one unbounded SQL transaction", () => {
    const createSection = action.slice(
      action.indexOf("export async function createCampaign"),
      action.indexOf("export async function sendCampaign"),
    );
    expect(action).toContain('"create_campaign_with_recipients"');
    expect(createSection).not.toContain('.from("customers")');
    expect(createSection).not.toContain('.from("campaign_recipients")');
    expect(migration).toContain("create or replace function public.create_campaign_with_recipients");
    expect(migration).toContain("insert into public.campaign_recipients");
    expect(migration).toContain("from public.customers c");
    expect(migration).toContain("c.tenant_id = p_tenant_id");
    expect(migration).toContain("get diagnostics v_recipient_count = row_count");
    expect(migration).toContain("raise exception 'No eligible campaign recipients.'");
  });

  it("requires an approved WhatsApp template contract before atomic creation", () => {
    expect(action).toContain("WHATSAPP_TEMPLATE_NAME_RE");
    expect(action).toContain("WHATSAPP_TEMPLATE_LANGUAGE_RE");
    expect(action).toContain("p_whatsapp_template_name");
    expect(action).toContain("p_whatsapp_template_language");
    expect(migration).toContain("campaigns_whatsapp_template_contract");
    expect(migration).toContain("whatsapp_template_name ~ '^[a-z0-9_]{1,512}$'");
    expect(migration).toContain("whatsapp_template_language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'");
    expect(dialog).toContain('name="whatsappTemplateName"');
    expect(dialog).toContain('name="whatsappTemplateLanguage"');
    expect(dialog).toContain("Meta Business Manager");
  });
});

describe("campaign recipient delivery compliance contract", () => {
  it("checks tenant, active customer and exact channel consent immediately before provider I/O", () => {
    expect(migration).toContain("c.tenant_id = p_tenant_id");
    expect(migration).toContain("c.deleted_at is null");
    expect(migration).toContain("c.blacklist = false");
    expect(migration).toContain("i.tenant_id = p_tenant_id");
    expect(migration).toContain("i.customer_id = v_customer.id");
    expect(migration).toContain("i.channel = v_campaign.channel::text");
    expect(migration).toContain("v_consent.status <> 'granted'");
    expect(migration).toContain("v_consent.revoked_at is not null");
    expect(migration).toContain("consent_snapshot = v_snapshot");

    const verify = worker.indexOf('"verify_campaign_recipient_consent"');
    const provider = worker.indexOf("sendToProvider(delivery", verify);
    expect(verify).toBeGreaterThan(-1);
    expect(provider).toBeGreaterThan(verify);
    expect(worker.slice(verify, provider)).not.toContain("sendSms(");
    expect(worker.slice(verify, provider)).not.toContain("sendWhatsApp(");
  });

  it("owns campaign and recipient leases and never automatically replays an unknown outcome", () => {
    expect(worker).toContain('"claim_campaign_delivery"');
    expect(worker).toContain('"claim_campaign_recipient_delivery"');
    expect(migration).toContain("c.processing_token = p_processing_token");
    expect(migration).toContain("r.lease_token = p_lease_token");
    expect(migration).toContain("unknown_provider_outcome");
    expect(migration).toContain("delivery_state = 'dead_letter'");
    expect(migration).toContain("delivery_state = 'retry'");
    expect(migration).toContain("interval '1 minute'");
    expect(migration).toContain("interval '5 minutes'");
    expect(migration).toContain("interval '30 minutes'");
  });

  it("persists provider receipts and prevents completion without granted evidence", () => {
    expect(worker).toContain("providerMessageId: result.jobid");
    expect(worker).toContain("providerMessageId: result.messageId");
    expect(migration).toContain("provider_message_id = left");
    expect(migration).toContain("Current granted consent evidence is required.");
    expect(migration).toContain("consent_snapshot ->> 'status'");
  });

  it("keeps parent delivery counters consistent after applied provider callbacks", () => {
    const providerStatus = migration.slice(
      migration.indexOf("create or replace function public.apply_campaign_recipient_provider_status"),
      migration.indexOf("revoke all on function public.apply_campaign_recipient_provider_status"),
    );
    expect(providerStatus).toContain("update public.campaigns c");
    expect(providerStatus.match(/update public\.campaigns c/g)).toHaveLength(2);
    expect(providerStatus).toContain("set sent_count = counts.sent_count");
    expect(providerStatus).toContain("failed_count = counts.failed_count");
    expect(providerStatus).toContain("r.status in ('sent', 'delivered')");
    expect(providerStatus).toContain("r.delivery_state in ('blocked', 'skipped', 'dead_letter')");
    expect(providerStatus).toContain("where c.id = v_recipient.campaign_id");
    expect(providerStatus).toContain("and c.tenant_id = p_tenant_id");
    expect(providerStatus).toContain("Campaign provider status parent changed.");
    expect(providerStatus).toContain("for update;");

    const firstRecount = providerStatus.indexOf("update public.campaigns c");
    expect(firstRecount).toBeGreaterThan(providerStatus.indexOf("set status = 'failed'"));
    expect(providerStatus.indexOf("reason', 'duplicate_or_out_of_order'")).toBeLessThan(
      providerStatus.lastIndexOf("update public.campaigns c"),
    );
  });

  it("sends WhatsApp campaigns only as Meta template messages and blocks legacy free text", () => {
    const tenantTemplateSender = tenantProviders.slice(
      tenantProviders.indexOf("async function sendPreparedTenantWhatsApp"),
      tenantProviders.indexOf("export async function prepareTenantWhatsAppSender"),
    );
    const platformTemplateSender = netgsm.slice(
      netgsm.indexOf("export async function sendWhatsAppTemplateWithConfig"),
      netgsm.indexOf("// ---------------------------------------------------------------------------\n// Helpers"),
    );

    expect(tenantTemplateSender).toContain('type: "template"');
    expect(tenantTemplateSender).not.toContain("text: { preview_url: false");
    expect(tenantTemplateSender).toContain("language: { code: template.language }");
    expect(platformTemplateSender).toContain('type: "template"');
    expect(platformTemplateSender).not.toContain("text: { body:");
    expect(worker).toContain("whatsAppSender(delivery.address, delivery.whatsAppTemplate)");
    expect(migration).toContain("reason', 'whatsapp_template_invalid'");
    expect(migration).toContain("delivery_state = 'dead_letter'");

    expect(isValidWhatsAppTemplateMessage({ name: "portfoy_duyurusu", language: "tr" })).toBe(true);
    expect(isValidWhatsAppTemplateMessage({
      name: "portfoy_duyurusu",
      language: "tr_TR",
      bodyParameter: "Kadıköy",
    })).toBe(true);
    expect(isValidWhatsAppTemplateMessage({ name: "Free Text", language: "tr" })).toBe(false);
    expect(isValidWhatsAppTemplateMessage({ name: "approved_name", language: "turkish" })).toBe(false);
  });

  it("builds the Meta template payload with at most one body parameter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ messages: [{ id: "wamid.template-1" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWhatsAppTemplateWithConfig(
      { apiUrl: "https://graph.facebook.com/v23.0/phone/messages", apiToken: "test-token" },
      "+905551112233",
      { name: "portfoy_duyurusu", language: "tr", bodyParameter: "Kadıköy" },
    );

    expect(result).toEqual({ ok: true, messageId: "wamid.template-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(payload.type).toBe("template");
    expect(payload).not.toHaveProperty("text");
    expect(payload.template).toEqual({
      name: "portfoy_duyurusu",
      language: { code: "tr" },
      components: [{
        type: "body",
        parameters: [{ type: "text", text: "Kadıköy" }],
      }],
    });
  });

  it("resolves active tenant-owned provider secrets before the final consent check", () => {
    expect(tenantProviders).toContain('.from("tenant_integrations")');
    expect(tenantProviders).toContain("binding_verified_at, binding_fingerprint");
    expect(tenantProviders).toContain('.eq("tenant_id", tenantId)');
    expect(tenantProviders).toContain('.eq("provider", provider)');
    expect(tenantProviders).toContain("if (!integration.is_active)");
    expect(tenantProviders).toContain('integration.connection_status !== "healthy"');
    expect(tenantProviders).toContain("integration.binding_fingerprint !== expectedFingerprint");
    expect(tenantProviders).toContain('.from("tenant_integration_secrets")');
    expect(tenantProviders).toContain('.eq("integration_id", integration.id)');
    expect(tenantProviders).toContain("ALLOW_PLATFORM_MESSAGING_FALLBACK");
    expect(signerSms).toContain('from "@/lib/messaging/tenant-providers"');
    expect(signerSms).not.toContain('.select("credentials")');

    const prepare = worker.indexOf("prepareTenantSmsSender");
    const verify = worker.indexOf('"verify_campaign_recipient_consent"');
    const provider = worker.indexOf("sendToProvider(delivery", verify);
    expect(prepare).toBeGreaterThan(-1);
    expect(prepare).toBeLessThan(verify);
    expect(provider).toBeGreaterThan(verify);
  });
});

describe("campaign worker operational contract", () => {
  it("uses bounded batches and an authenticated, heartbeating cron route", () => {
    expect(route).toContain("campaignLimit: 3");
    expect(route).toContain("recipientBatchSize: 10");
    expect(route).toContain("process.env.CRON_SECRET");
    expect(route).toContain('recordHeartbeat("campaign-delivery"');
    expect(vercel).toContain('"path": "/api/cron/campaign-delivery"');
    expect(vercel).toContain('"schedule": "*/2 * * * *"');
    expect(cronJobs).toContain('job: "campaign-delivery"');
  });

  it("classifies transient and permanent provider failures conservatively", () => {
    expect(isRetryableCampaignDeliveryFailure("connection reset")).toBe(true);
    expect(isRetryableCampaignDeliveryFailure("API hatası: 429 busy")).toBe(true);
    expect(isRetryableCampaignDeliveryFailure("API hatası: 503 down")).toBe(true);
    expect(isRetryableCampaignDeliveryFailure("provider unavailable", "http_503")).toBe(true);
    expect(isRetryableCampaignDeliveryFailure("provider busy", "http_429")).toBe(true);
    expect(isRetryableCampaignDeliveryFailure("lookup unavailable", "provider_resolution_error")).toBe(true);
    expect(isRetryableCampaignDeliveryFailure("API hatası: 400 invalid")).toBe(false);
    expect(isRetryableCampaignDeliveryFailure("invalid request", "http_400")).toBe(false);
    expect(isRetryableCampaignDeliveryFailure("İYS ret", "85")).toBe(false);
    expect(isRetryableCampaignDeliveryFailure("Netgsm yapılandırılmamış.")).toBe(false);
    expect(isRetryableCampaignDeliveryFailure(
      "WhatsApp sonucu belirsiz",
      "unknown_provider_outcome",
    )).toBe(false);
  });

  it("dead-letters ambiguous WhatsApp POST outcomes for manual reconciliation", () => {
    expect(tenantProviders).toContain('code: "unknown_provider_outcome"');
    expect(netgsm).toContain("isAmbiguousWhatsAppHttpStatus(res.status)");
    expect(worker).toContain('errorCode: "unknown_provider_outcome"');
    expect(worker).toContain("retryable: false");
    expect(campaignDeliveryErrorForStorage(
      "provider may have accepted",
      "unknown_provider_outcome",
    )).toContain("manuel mutabakat");
    expect(verificationMigration).toContain("campaign_recipients_unknown_outcome_not_retry");
    expect(verificationMigration).toContain(
      "delivery_state not in ('queued', 'retry')",
    );
    expect(verificationMigration).toContain(
      "and delivery_state in ('queued', 'retry')",
    );
    expect(verificationMigration).toContain(
      "validate constraint campaign_recipients_unknown_outcome_not_retry",
    );
  });

  it("does not persist arbitrary provider response bodies", () => {
    const stored = campaignDeliveryErrorForStorage(
      "API hatası: 503 upstream body with bearer secret-value",
    );
    expect(stored).toBe("Sağlayıcı HTTP 503 hatası.");
    expect(stored).not.toContain("secret-value");
  });
});

describe("legacy WhatsApp campaign claim (23514) regression", () => {
  const fix = read("supabase/migrations/20260816001100_campaign_claim_legacy_whatsapp_fix.sql");

  it("relaxes the template check for terminal states and quarantines invalid campaigns before claiming", () => {
    expect(fix).toMatch(/status::text in \('failed', 'done'\)/);
    expect(fix.indexOf("last_error = 'whatsapp_template_invalid'")).toBeGreaterThan(-1);
    expect(fix.indexOf("whatsapp_template_invalid")).toBeLessThan(fix.indexOf("for update skip locked"));
  });

  it("detects template-contract violations on the client", async () => {
    const { isCampaignViolatingTemplateContract: bad } = await import("@/lib/campaign-delivery");
    expect(bad({ channel: "whatsapp", message: "x", whatsapp_template_name: null, whatsapp_template_language: null })).toBe(true);
    expect(bad({ channel: "whatsapp", message: "x", whatsapp_template_name: "hos_geldin", whatsapp_template_language: "tr" })).toBe(false);
    expect(bad({ channel: "whatsapp", message: "x".repeat(613), whatsapp_template_name: "a", whatsapp_template_language: "tr" })).toBe(true);
    expect(bad({ channel: "sms", message: "x", whatsapp_template_name: null, whatsapp_template_language: null })).toBe(false);
  });

  it("worker survives a check violation instead of throwing every tick", () => {
    expect(worker).toContain("claimAroundInvalidCampaigns");
    expect(worker).toContain("quarantinedCampaigns");
  });
});
