import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalizeMetaNumericId,
  isAllowedWhatsAppGraphVersion,
  isValidWhatsAppAccessToken,
} from "@/lib/messaging/whatsapp-contract";
import {
  approvedTemplatesFromMetaPayload,
  verifyTenantWhatsAppBinding,
} from "@/lib/messaging/whatsapp-cloud";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const actions = read("src/app/actions/tenant-integrations.ts");
const campaignActions = read("src/app/actions/campaigns.ts");
// Entegrasyon verisi ayarlar sayfasının sekme dosyasında (sekme bölme, PB52 turu).
const settingsPage = read("src/app/app/ayarlar/_sekmeler/entegrasyon-tab.tsx");
const integrationsForm = read("src/app/app/ayarlar/integrations-form.tsx");
const campaignDialog = read("src/app/app/kampanyalar/yeni/new-campaign-form.tsx");
const templateClient = read("src/lib/messaging/whatsapp-cloud.ts");
const tenantProviders = read("src/lib/messaging/tenant-providers.ts");
const migration = read("supabase/migrations/20260810000960_whatsapp_cloud_provisioning.sql");
const verificationMigration = read("supabase/migrations/20260810000980_whatsapp_binding_verification.sql");
const messagingMigration = read("supabase/migrations/20260731000132_professional_messaging.sql");

describe("WhatsApp Cloud provisioning boundary", () => {
  it("validates public Meta identifiers, versions and opaque access tokens", () => {
    expect(canonicalizeMetaNumericId(" 12345 ")).toBe("12345");
    expect(canonicalizeMetaNumericId("1234")).toBeNull();
    expect(canonicalizeMetaNumericId("12345/path")).toBeNull();
    expect(isAllowedWhatsAppGraphVersion("v25.0")).toBe(true);
    expect(isAllowedWhatsAppGraphVersion("v99.0")).toBe(false);
    expect(isValidWhatsAppAccessToken("a".repeat(20))).toBe(true);
    expect(isValidWhatsAppAccessToken(`token ${"a".repeat(20)}`)).toBe(false);
  });

  it("requires settings edit permission and uses atomic, actor-bound RPCs", () => {
    const save = actions.slice(
      actions.indexOf("export async function saveWhatsAppCredentials"),
      actions.indexOf("export async function clearWhatsAppCredentials"),
    );
    const clear = actions.slice(actions.indexOf("export async function clearWhatsAppCredentials"));

    expect(save).toContain('requirePermission("settings", "edit")');
    expect(clear).toContain('requirePermission("settings", "edit")');
    expect(save).toContain("verifyTenantWhatsAppBinding({");
    expect(save).toContain('admin.rpc("activate_verified_tenant_whatsapp_binding"');
    expect(save).toContain('"fail_tenant_whatsapp_binding_verification"');
    expect(save).not.toContain('admin.rpc("upsert_tenant_whatsapp_cloud_integration"');
    expect(clear).toContain('admin.rpc("delete_tenant_whatsapp_cloud_integration"');
    expect(save).toContain("p_tenant_id: gate.tenantId");
    expect(save).toContain("p_actor_id: gate.userId");
    expect(save).toContain('console.error("saveWhatsAppCredentials", { code: error.code })');
    expect(save).not.toContain("error.message");
  });

  it("keeps the access token service-role-only and audits only safe metadata", () => {
    expect(migration).toContain("whatsapp_business_account_id text");
    expect(migration).toContain("graph_api_version text");
    expect(migration).toContain("public.tenant_integration_secrets");
    expect(migration).toContain("jsonb_build_object('access_token', v_access_token)");
    expect(migration).toContain("from public, anon, authenticated, service_role");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("'tenant_integration.whatsapp.upsert'");
    expect(migration).toContain("'tenant_integration.whatsapp.delete'");
    expect(migration).toContain("p_actor_id");

    const auditProjection = migration.slice(
      migration.indexOf("insert into public.audit_logs", migration.indexOf("upsert_tenant_whatsapp_cloud_integration")),
      migration.indexOf("return v_integration_id", migration.indexOf("insert into public.audit_logs")),
    );
    expect(auditProjection).not.toContain("'access_token'");
    expect(auditProjection).not.toContain("v_access_token");
  });

  it("enforces globally unique active phone-number routing and strict metadata", () => {
    expect(messagingMigration).toContain("uq_tenant_integrations_external_account");
    expect(messagingMigration).toContain("on public.tenant_integrations(provider, external_account_id)");
    expect(messagingMigration).toContain("where external_account_id is not null and is_active");
    expect(migration).toContain("external_account_id ~ '^[0-9]{5,32}$'");
    expect(migration).toContain("whatsapp_business_account_id ~ '^[0-9]{5,32}$'");
    expect(migration).toContain("graph_api_version in ('v22.0', 'v23.0', 'v24.0', 'v25.0')");
  });

  it("requires a healthy fingerprint-consistent verified binding before activation", () => {
    expect(verificationMigration).toContain("binding_verified_at timestamptz");
    expect(verificationMigration).toContain("binding_fingerprint text");
    expect(verificationMigration).toContain("connection_status = 'healthy'");
    expect(verificationMigration).toContain("code_verification_status' = 'VERIFIED'");
    expect(verificationMigration).toContain("or coalesce((");
    expect(verificationMigration).toContain("enforce_verified_whatsapp_binding");
    expect(verificationMigration).toContain(
      "before insert or update on public.tenant_integrations",
    );
    expect(verificationMigration).toContain("Verified WhatsApp binding must be deactivated before replacement.");
    expect(verificationMigration).toContain("resolve_verified_whatsapp_tenant");
    expect(verificationMigration).toContain("revoke execute on function public.upsert_tenant_whatsapp_cloud_integration");
    expect(verificationMigration).toContain("fail_tenant_whatsapp_binding_verification");
    expect(verificationMigration).toContain("is_active = false");
    expect(verificationMigration).toContain(
      "validate constraint tenant_integrations_whatsapp_verified_active_contract",
    );
    expect(verificationMigration).toContain(
      "validate constraint tenant_integrations_whatsapp_evidence_contract",
    );
  });

  it("passes only masked configured state and public metadata to the client form", () => {
    expect(settingsPage).toContain("whatsappCreds?.configured === true");
    expect(settingsPage).toContain("hasAccessToken:");
    expect(settingsPage).not.toContain('.from("tenant_integration_secrets")');
    expect(integrationsForm).toContain('name="access_token"');
    expect(integrationsForm).toContain("değiştirmeyecekseniz boş bırakın");
    expect(integrationsForm).not.toContain("whatsapp.accessToken");
    expect(integrationsForm).not.toContain("whatsapp?.accessToken");
  });

  it("normalizes every legacy tenant provider URL against a safe exact-host allowlist", () => {
    expect(tenantProviders).toContain("providerAllowedHosts");
    expect(tenantProviders).toContain("normalizeProviderBaseUrl(configuredUrl, whatsAppAllowedHosts())");
    expect(tenantProviders).toContain('["graph.facebook.com"]');
    expect(tenantProviders).not.toContain('new Set(["https://graph.facebook.com"');
  });
});

describe("approved WhatsApp template discovery", () => {
  it("projects only approved, contract-valid name/language pairs", () => {
    expect(approvedTemplatesFromMetaPayload({
      data: [
        { name: "portfoy_duyurusu", language: "tr", status: "APPROVED", body: "secret body" },
        { name: "pending_name", language: "tr", status: "PENDING" },
        { name: "Invalid Name", language: "tr", status: "APPROVED" },
        { name: "english_offer", language: "en_US", status: "APPROVED" },
      ],
    })).toEqual([
      { name: "portfoy_duyurusu", language: "tr" },
      { name: "english_offer", language: "en_US" },
    ]);
    expect(approvedTemplatesFromMetaPayload({ data: "not-an-array" })).toBeNull();
  });

  it("uses an exact tenant integration, fixed Meta origin and bounded network contract", () => {
    expect(templateClient).toContain('const META_GRAPH_ORIGIN = "https://graph.facebook.com"');
    expect(templateClient).toContain("/message_templates");
    expect(templateClient).toContain('.eq("tenant_id", tenantId)');
    expect(templateClient).toContain('.eq("provider", "whatsapp")');
    expect(templateClient).toContain('.eq("is_active", true)');
    expect(templateClient).toContain('.eq("connection_status", "healthy")');
    expect(templateClient).toContain('.not("binding_verified_at", "is", null)');
    expect(templateClient).toContain('.from("tenant_integration_secrets")');
    expect(templateClient).toContain('.eq("integration_id", integration.id)');
    expect(templateClient).toContain("fetchExternal(");
    expect(templateClient).toContain('redirect: "error"');
    expect(templateClient).toContain("META_TEMPLATE_TIMEOUT_MS");
    expect(templateClient).toContain("META_TEMPLATE_MAX_RESPONSE_BYTES");
    expect(templateClient).toContain("META_TEMPLATE_MAX_PAGES");
    expect(templateClient).toContain("META_TEMPLATE_MAX_RESULTS");
    expect(templateClient).toContain("paging?.cursors");
    expect(templateClient).not.toContain("paging.next");
    expect(templateClient).not.toContain("response.text()");
  });

  it("authorizes and rate-limits the server action while keeping manual fallback", () => {
    const list = campaignActions.slice(
      campaignActions.indexOf("export async function listApprovedWhatsAppTemplates"),
      campaignActions.indexOf("export async function createCampaign"),
    );
    expect(list).toContain('requirePermission("campaigns", "create")');
    expect(list).toContain("checkRateLimit(");
    expect(list).toContain('failurePolicy: "deny"');
    expect(list).toContain("listApprovedTenantWhatsAppTemplates(gate.tenantId)");
    expect(campaignDialog).toContain("listApprovedWhatsAppTemplates()");
    expect(campaignDialog).toContain("Meta onaylı şablonlar");
    expect(campaignDialog).toContain('name="whatsappTemplateName"');
    expect(campaignDialog).toContain('name="whatsappTemplateLanguage"');
    expect(campaignDialog).toContain("Güvenli manuel giriş alanları kullanılabilir");
  });
});

describe("live Meta phone/WABA ownership verification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("activates only after the token proves WABA membership and VERIFIED phone status", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: "987654321098765" }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "987654321098765",
        display_phone_number: "+90 555 111 22 33",
        verified_name: "Demo Emlak",
        quality_rating: "GREEN",
        code_verification_status: "VERIFIED",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyTenantWhatsAppBinding({
      tenantId: "tenant-a",
      phoneNumberId: "987654321098765",
      wabaId: "123456789012345",
      graphApiVersion: "v25.0",
      accessToken: "a".repeat(32),
    });

    expect(result).toMatchObject({
      ok: true,
      binding: {
        phoneNumberId: "987654321098765",
        wabaId: "123456789012345",
        codeVerificationStatus: "VERIFIED",
        verifiedName: "Demo Emlak",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/v25.0/123456789012345/phone_numbers",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/v25.0/987654321098765?fields=",
    );
    for (const [, init] of fetchMock.mock.calls as Array<[unknown, RequestInit]>) {
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("fails closed when the phone is not owned by the submitted WABA", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "111111111111111" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyTenantWhatsAppBinding({
      tenantId: "tenant-a",
      phoneNumberId: "987654321098765",
      wabaId: "123456789012345",
      graphApiVersion: "v25.0",
      accessToken: "a".repeat(32),
    })).resolves.toEqual({ ok: false, reason: "ownership_mismatch" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed on invalid token authorization", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", {
      status: 401,
    })));
    await expect(verifyTenantWhatsAppBinding({
      tenantId: "tenant-a",
      phoneNumberId: "987654321098765",
      wabaId: "123456789012345",
      graphApiVersion: "v25.0",
      accessToken: "a".repeat(32),
    })).resolves.toEqual({ ok: false, reason: "authentication_failed" });
  });
});
