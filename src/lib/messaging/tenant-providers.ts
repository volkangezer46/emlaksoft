import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { platformMessagingFallbackEnv } from "@/lib/feature-flags/registry";
import {
  getNetgsmConfig,
  getWhatsAppConfig,
  isValidWhatsAppTemplateMessage,
  sendSmsWithConfig,
  sendWhatsAppTemplateWithConfig,
  type NetgsmConfig,
  type SmsSendResult,
  type WhatsAppSendResult,
  type WhatsAppTemplateMessage,
} from "@/lib/messaging/netgsm";
import {
  canonicalizeMetaNumericId,
  isAmbiguousWhatsAppHttpStatus,
  isAllowedWhatsAppGraphVersion,
  isValidWhatsAppAccessToken,
} from "@/lib/messaging/whatsapp-contract";
import {
  discardExternalResponse,
  fetchExternal,
  readExternalJson,
} from "@/lib/external-fetch";
import {
  normalizeProviderBaseUrl,
  providerAllowedHosts,
} from "@/lib/integrations/provider-url";

type CredentialMap = Record<string, unknown>;
const PROVIDER_TIMEOUT_MS = 10_000;
const PROVIDER_MAX_RESPONSE_BYTES = 64 * 1024;

type ActiveTenantIntegration = {
  externalAccountId: string | null;
  whatsappBusinessAccountId: string | null;
  graphApiVersion: string | null;
  credentials: CredentialMap;
};

type TenantIntegrationLookup =
  | { state: "ready"; integration: ActiveTenantIntegration }
  | { state: "missing" }
  | { state: "invalid" }
  | { state: "error" };

export type TenantWhatsAppSendResult = WhatsAppSendResult & { code?: string };
export type TenantSmsSender = (to: string, text: string) => Promise<SmsSendResult>;
export type TenantWhatsAppSender = (
  to: string,
  template: WhatsAppTemplateMessage,
) => Promise<TenantWhatsAppSendResult>;

/**
 * A shared platform sender is opt-in. Defaulting to false prevents an office
 * without credentials from silently sending through another/global account.
 */
export function platformMessagingFallbackAllowed(): boolean {
  return platformMessagingFallbackEnv(); // tek tanım: lib/feature-flags/registry.ts
}

function objectValue(value: unknown): CredentialMap | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as CredentialMap;
}

function stringValue(source: CredentialMap, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function getActiveTenantIntegration(
  tenantId: string,
  provider: "netgsm" | "whatsapp",
): Promise<TenantIntegrationLookup> {
  const admin = createAdminClient();
  const { data: integration, error: integrationError } = await admin
    .from("tenant_integrations")
    .select("id, external_account_id, whatsapp_business_account_id, graph_api_version, connection_status, is_active, binding_verified_at, binding_fingerprint")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .maybeSingle();

  if (integrationError) {
    console.error("tenant messaging integration lookup failed", {
      provider,
      code: integrationError.code,
    });
    return { state: "error" };
  }
  if (!integration) return { state: "missing" };
  if (!integration.is_active) return { state: "invalid" };
  if (provider === "netgsm" && !new Set(["configured", "healthy"]).has(integration.connection_status)) {
    return { state: "invalid" };
  }
  if (provider === "whatsapp") {
    const phoneNumberId = canonicalizeMetaNumericId(integration.external_account_id);
    const wabaId = canonicalizeMetaNumericId(integration.whatsapp_business_account_id);
    const graphApiVersion = integration.graph_api_version;
    const expectedFingerprint = phoneNumberId && wabaId && isAllowedWhatsAppGraphVersion(graphApiVersion)
      ? createHash("sha256")
          .update(`${phoneNumberId}|${wabaId}|${graphApiVersion}`, "utf8")
          .digest("hex")
      : null;
    if (
      integration.connection_status !== "healthy" ||
      !integration.binding_verified_at ||
      !expectedFingerprint ||
      integration.binding_fingerprint !== expectedFingerprint
    ) {
      return { state: "invalid" };
    }
  }

  const { data: secret, error: secretError } = await admin
    .from("tenant_integration_secrets")
    .select("credentials")
    .eq("integration_id", integration.id)
    .maybeSingle();
  if (secretError) {
    console.error("tenant messaging secret lookup failed", {
      provider,
      code: secretError.code,
    });
    return { state: "error" };
  }

  const credentials = objectValue(secret?.credentials);
  if (!credentials) return { state: "invalid" };
  return {
    state: "ready",
    integration: {
      externalAccountId:
        typeof integration.external_account_id === "string" && integration.external_account_id.trim()
          ? integration.external_account_id.trim()
          : null,
      whatsappBusinessAccountId:
        typeof integration.whatsapp_business_account_id === "string" && integration.whatsapp_business_account_id.trim()
          ? integration.whatsapp_business_account_id.trim()
          : null,
      graphApiVersion:
        typeof integration.graph_api_version === "string" && integration.graph_api_version.trim()
          ? integration.graph_api_version.trim()
          : null,
      credentials,
    },
  };
}

type NetgsmResolution =
  | { state: "ready"; config: NetgsmConfig }
  | { state: "missing" }
  | { state: "invalid" }
  | { state: "error" };

async function resolveTenantNetgsm(tenantId: string): Promise<NetgsmResolution> {
  const lookup = await getActiveTenantIntegration(tenantId, "netgsm");
  if (lookup.state !== "ready") return lookup;
  const usercode = stringValue(lookup.integration.credentials, "usercode");
  const password = stringValue(lookup.integration.credentials, "password");
  const msgheader = stringValue(lookup.integration.credentials, "msgheader");
  return usercode && password && msgheader
    ? { state: "ready", config: { usercode, password, msgheader } }
    : { state: "invalid" };
}

export async function getTenantNetgsmConfig(tenantId: string): Promise<NetgsmConfig | null> {
  const resolution = await resolveTenantNetgsm(tenantId);
  return resolution.state === "ready" ? resolution.config : null;
}

export async function isTenantSmsAvailable(tenantId: string): Promise<boolean> {
  const resolution = await resolveTenantNetgsm(tenantId);
  if (resolution.state === "ready") return true;
  if (resolution.state !== "missing" || !platformMessagingFallbackAllowed()) return false;
  return (await getNetgsmConfig()) !== null;
}

/**
 * Returns whether this tenant has a sender that is safe to use right now.
 *
 * A tenant binding is considered ready only after the Meta identity binding and
 * its secret have both passed the checks in `getActiveTenantIntegration`.
 * Platform fallback is deliberately considered only when the tenant has no
 * integration row at all; an invalid/degraded tenant binding must never be
 * hidden by a global credential.
 */
export async function isTenantWhatsAppAvailable(tenantId: string): Promise<boolean> {
  const lookup = await getActiveTenantIntegration(tenantId, "whatsapp");
  if (lookup.state === "ready") return true;
  if (lookup.state !== "missing" || !platformMessagingFallbackAllowed()) return false;
  return (await getWhatsAppConfig()) !== null;
}

export async function prepareTenantSmsSender(tenantId: string): Promise<TenantSmsSender> {
  const resolution = await resolveTenantNetgsm(tenantId);
  if (resolution.state === "ready") {
    return (to, text) => sendSmsWithConfig(resolution.config, to, text);
  }

  if (resolution.state === "missing" && platformMessagingFallbackAllowed()) {
    const platformConfig = await getNetgsmConfig();
    if (platformConfig) {
      return (to, text) => sendSmsWithConfig(platformConfig, to, text);
    }
  }

  if (resolution.state === "error") {
    return async () => ({
      ok: false,
      code: "provider_resolution_error",
      error: "Ofise ait mesaj sağlayıcısı geçici olarak çözümlenemedi.",
    });
  }

  return async () => ({
    ok: false,
    code: "tenant_provider_unconfigured",
    error: "Bu ofis için Netgsm sağlayıcısı yapılandırılmamış.",
  });
}

export async function sendTenantSms(
  tenantId: string,
  to: string,
  text: string,
): Promise<SmsSendResult> {
  const sender = await prepareTenantSmsSender(tenantId);
  return sender(to, text);
}

function normalizeTrMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("90") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `90${digits.slice(1)}`;
  if (digits.startsWith("5") && digits.length === 10) return `90${digits}`;
  return null;
}

function whatsAppAllowedHosts(): readonly string[] {
  const configuredHosts = (process.env.WHATSAPP_ALLOWED_API_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).hostname;
      } catch {
        return value;
      }
    });
  return providerAllowedHosts(["graph.facebook.com"], configuredHosts.join(","));
}

function tenantWhatsAppEndpoint(integration: ActiveTenantIntegration): URL | null {
  const phoneNumberId = canonicalizeMetaNumericId(
    integration.externalAccountId ??
      stringValue(integration.credentials, "phone_number_id", "phoneNumberId"),
  );
  const graphVersion = integration.graphApiVersion ?? stringValue(
    integration.credentials,
    "graph_api_version",
    "graphApiVersion",
  );

  if (phoneNumberId && isAllowedWhatsAppGraphVersion(graphVersion)) {
    return new URL(
      `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`,
    );
  }

  const configuredUrl = stringValue(integration.credentials, "api_url", "apiUrl");
  if (!configuredUrl) return null;
  const normalized = normalizeProviderBaseUrl(configuredUrl, whatsAppAllowedHosts());
  return normalized ? new URL(normalized) : null;
}

async function sendPreparedTenantWhatsApp(
  integration: ActiveTenantIntegration,
  to: string,
  template: WhatsAppTemplateMessage,
): Promise<TenantWhatsAppSendResult> {
  const token = stringValue(
    integration.credentials,
    "access_token",
    "accessToken",
    "api_token",
    "apiToken",
    "token",
  );
  const endpoint = tenantWhatsAppEndpoint(integration);
  const phone = normalizeTrMobile(to);
  if (!isValidWhatsAppAccessToken(token) || !endpoint) {
    return { ok: false, code: "provider_config_invalid", error: "WhatsApp sağlayıcı ayarı geçersiz." };
  }
  if (!phone) return { ok: false, code: "invalid_phone", error: "Geçersiz telefon numarası." };
  if (!isValidWhatsAppTemplateMessage(template)) {
    return {
      ok: false,
      code: "whatsapp_template_invalid",
      error: "WhatsApp kampanya şablonu geçersiz.",
    };
  }

  const components = template.bodyParameter
    ? [{
        type: "body",
        parameters: [{ type: "text", text: template.bodyParameter }],
      }]
    : undefined;

  let response: Response;
  try {
    response = await fetchExternal(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phone,
          type: "template",
          template: {
            name: template.name,
            language: { code: template.language },
            ...(components ? { components } : {}),
          },
        }),
        redirect: "error",
      },
      { timeoutMs: PROVIDER_TIMEOUT_MS },
    );
  } catch {
    return {
      ok: false,
      code: "unknown_provider_outcome",
      error: "WhatsApp gönderim sonucu belirsiz; otomatik tekrar güvenli değil.",
    };
  }

  if (!response.ok) {
    await discardExternalResponse(response);
    if (isAmbiguousWhatsAppHttpStatus(response.status)) {
      return {
        ok: false,
        code: "unknown_provider_outcome",
        error: "WhatsApp gönderim sonucu belirsiz; manuel mutabakat gerekli.",
      };
    }
    return {
      ok: false,
      code: `http_${response.status}`,
      error: `WhatsApp sağlayıcısı HTTP ${response.status} hatası döndürdü.`,
    };
  }

  const data = await readExternalJson<{
    messages?: Array<{ id?: unknown }>;
  }>(response, PROVIDER_MAX_RESPONSE_BYTES).catch(() => null);
  const messageId = data?.messages?.[0]?.id;
  if (
    typeof messageId !== "string" ||
    !/^[\x21-\x7e]{1,512}$/.test(messageId)
  ) {
    // HTTP success without a durable receipt is an unknown provider outcome;
    // never retry it automatically because the message may have been accepted.
    return {
      ok: false,
      code: "unknown_provider_outcome",
      error: "WhatsApp kabul yanıtı teslimat kimliği içermedi; manuel mutabakat gerekli.",
    };
  }
  return { ok: true, messageId };
}

export async function prepareTenantWhatsAppSender(
  tenantId: string,
): Promise<TenantWhatsAppSender> {
  const lookup = await getActiveTenantIntegration(tenantId, "whatsapp");
  if (lookup.state === "ready") {
    return (to, text) => sendPreparedTenantWhatsApp(lookup.integration, to, text);
  }

  if (lookup.state === "missing" && platformMessagingFallbackAllowed()) {
    const platformConfig = await getWhatsAppConfig();
    if (platformConfig) {
      return (to, template) => sendWhatsAppTemplateWithConfig(platformConfig, to, template);
    }
  }

  if (lookup.state === "error") {
    return async () => ({
      ok: false,
      code: "provider_resolution_error",
      error: "Ofise ait mesaj sağlayıcısı geçici olarak çözümlenemedi.",
    });
  }

  return async () => ({
    ok: false,
    code: "tenant_provider_unconfigured",
    error: "Bu ofis için WhatsApp sağlayıcısı yapılandırılmamış.",
  });
}

export async function sendTenantWhatsApp(
  tenantId: string,
  to: string,
  template: WhatsAppTemplateMessage,
): Promise<TenantWhatsAppSendResult> {
  const sender = await prepareTenantWhatsAppSender(tenantId);
  return sender(to, template);
}
