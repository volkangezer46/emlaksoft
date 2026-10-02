import { createAdminClient } from "@/lib/supabase/admin";
import {
  externalErrorMetadata,
  fetchExternal,
  readExternalJson,
  requireExternalSuccess,
} from "@/lib/external-fetch";
import {
  canonicalizeMetaNumericId,
  isAllowedWhatsAppGraphVersion,
  isValidWhatsAppAccessToken,
  isValidWhatsAppTemplateLanguage,
  isValidWhatsAppTemplateName,
} from "@/lib/messaging/whatsapp-contract";

const META_GRAPH_ORIGIN = "https://graph.facebook.com";
const META_TEMPLATE_PAGE_SIZE = 100;
const META_TEMPLATE_MAX_PAGES = 3;
const META_TEMPLATE_MAX_RESULTS = 200;
const META_TEMPLATE_MAX_RESPONSE_BYTES = 512 * 1024;
const META_TEMPLATE_TIMEOUT_MS = 10_000;
const META_CURSOR_RE = /^[\x21-\x7e]{1,512}$/;
const META_BINDING_MAX_PAGES = 3;
const META_BINDING_PAGE_SIZE = 100;
const META_BINDING_MAX_RESPONSE_BYTES = 256 * 1024;

export type WhatsAppBindingVerificationFailure =
  | "missing_token"
  | "authentication_failed"
  | "ownership_mismatch"
  | "phone_not_verified"
  | "invalid_provider_response"
  | "provider_unavailable";

export type VerifiedWhatsAppBinding = {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
  graphApiVersion: string;
  verifiedName: string;
  displayPhoneNumber: string;
  qualityRating: string | null;
  codeVerificationStatus: "VERIFIED";
};

export type WhatsAppBindingVerificationResult =
  | { ok: true; binding: VerifiedWhatsAppBinding }
  | { ok: false; reason: WhatsAppBindingVerificationFailure };

export type ApprovedWhatsAppTemplate = {
  name: string;
  language: string;
};

export type ApprovedWhatsAppTemplateResult =
  | { ok: true; templates: ApprovedWhatsAppTemplate[] }
  | { ok: false; error: string };

type RecordValue = Record<string, unknown>;

function objectValue(value: unknown): RecordValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as RecordValue;
}

function secretString(source: unknown, ...keys: string[]): string | null {
  const object = objectValue(source);
  if (!object) return null;
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Extracts only the non-sensitive, policy-safe fields accepted by the UI. */
export function approvedTemplatesFromMetaPayload(
  payload: unknown,
): ApprovedWhatsAppTemplate[] | null {
  const root = objectValue(payload);
  if (!root || !Array.isArray(root.data)) return null;

  const templates: ApprovedWhatsAppTemplate[] = [];
  for (const candidate of root.data) {
    const item = objectValue(candidate);
    if (!item || item.status !== "APPROVED") continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const language = typeof item.language === "string" ? item.language.trim() : "";
    if (!isValidWhatsAppTemplateName(name) || !isValidWhatsAppTemplateLanguage(language)) {
      continue;
    }
    templates.push({ name, language });
  }
  return templates;
}

function nextCursorFromMetaPayload(payload: unknown): string | null {
  const root = objectValue(payload);
  const paging = objectValue(root?.paging);
  const cursors = objectValue(paging?.cursors);
  const after = cursors?.after;
  return typeof after === "string" && META_CURSOR_RE.test(after) ? after : null;
}

function boundedMetaString(value: unknown, max: number, min = 1): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= min && normalized.length <= max ? normalized : null;
}

async function existingTenantWhatsAppToken(tenantId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: integration, error: integrationError } = await admin
    .from("tenant_integrations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("provider", "whatsapp")
    .maybeSingle();
  if (integrationError || !integration) {
    if (integrationError) {
      console.error("WhatsApp verification integration lookup failed", {
        code: integrationError.code,
      });
    }
    return null;
  }

  const { data: secret, error: secretError } = await admin
    .from("tenant_integration_secrets")
    .select("credentials")
    .eq("integration_id", integration.id)
    .maybeSingle();
  if (secretError) {
    console.error("WhatsApp verification secret lookup failed", { code: secretError.code });
    return null;
  }
  return secretString(
    secret?.credentials,
    "access_token",
    "accessToken",
    "api_token",
    "apiToken",
    "token",
  );
}

function wabaPhoneNumbersUrl(
  graphApiVersion: string,
  wabaId: string,
  after: string | null,
): URL {
  const url = new URL(
    `${META_GRAPH_ORIGIN}/${graphApiVersion}/${wabaId}/phone_numbers`,
  );
  url.searchParams.set("fields", "id");
  url.searchParams.set("limit", String(META_BINDING_PAGE_SIZE));
  if (after) url.searchParams.set("after", after);
  return url;
}

function phoneNumberDetailUrl(graphApiVersion: string, phoneNumberId: string): URL {
  const url = new URL(
    `${META_GRAPH_ORIGIN}/${graphApiVersion}/${phoneNumberId}`,
  );
  url.searchParams.set(
    "fields",
    "id,display_phone_number,verified_name,quality_rating,code_verification_status",
  );
  return url;
}

async function readMetaBindingJson(
  url: URL,
  accessToken: string,
): Promise<unknown> {
  const response = await fetchExternal(
    url,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      redirect: "error",
    },
    { timeoutMs: META_TEMPLATE_TIMEOUT_MS },
  );
  await requireExternalSuccess(response);
  return readExternalJson<unknown>(response, META_BINDING_MAX_RESPONSE_BYTES);
}

/**
 * Confirms, with the submitted bearer token, that the phone-number ID is a
 * verified member of the submitted WABA. No database route is activated by
 * this function and no provider payload or token is logged or returned to a
 * client action result.
 */
export async function verifyTenantWhatsAppBinding(input: {
  tenantId: string;
  phoneNumberId: string;
  wabaId: string;
  graphApiVersion: string;
  accessToken: string | null;
}): Promise<WhatsAppBindingVerificationResult> {
  const phoneNumberId = canonicalizeMetaNumericId(input.phoneNumberId);
  const wabaId = canonicalizeMetaNumericId(input.wabaId);
  if (!phoneNumberId || !wabaId || !isAllowedWhatsAppGraphVersion(input.graphApiVersion)) {
    return { ok: false, reason: "invalid_provider_response" };
  }

  const accessToken = input.accessToken?.trim() ||
    await existingTenantWhatsAppToken(input.tenantId);
  if (!isValidWhatsAppAccessToken(accessToken)) {
    return { ok: false, reason: "missing_token" };
  }
  const verifiedAccessToken = accessToken as string;

  try {
    let after: string | null = null;
    const seenCursors = new Set<string>();
    let ownedByWaba = false;

    for (let page = 0; page < META_BINDING_MAX_PAGES; page += 1) {
      const payload = await readMetaBindingJson(
        wabaPhoneNumbersUrl(input.graphApiVersion, wabaId, after),
        verifiedAccessToken,
      );
      const root = objectValue(payload);
      if (!root || !Array.isArray(root.data)) {
        return { ok: false, reason: "invalid_provider_response" };
      }
      ownedByWaba = root.data.some((candidate) => {
        const row = objectValue(candidate);
        return row?.id === phoneNumberId;
      });
      if (ownedByWaba) break;

      const nextCursor = nextCursorFromMetaPayload(payload);
      if (!nextCursor || seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      after = nextCursor;
    }
    if (!ownedByWaba) return { ok: false, reason: "ownership_mismatch" };

    const detailPayload = await readMetaBindingJson(
      phoneNumberDetailUrl(input.graphApiVersion, phoneNumberId),
      verifiedAccessToken,
    );
    const detail = objectValue(detailPayload);
    if (!detail || detail.id !== phoneNumberId) {
      return { ok: false, reason: "ownership_mismatch" };
    }
    if (detail.code_verification_status !== "VERIFIED") {
      return { ok: false, reason: "phone_not_verified" };
    }

    const verifiedName = boundedMetaString(detail.verified_name, 256);
    const displayPhoneNumber = boundedMetaString(detail.display_phone_number, 64, 5);
    if (!verifiedName || !displayPhoneNumber) {
      return { ok: false, reason: "invalid_provider_response" };
    }
    const quality = boundedMetaString(detail.quality_rating, 16);
    const qualityRating = quality && new Set(["GREEN", "YELLOW", "RED", "NA", "UNKNOWN"])
      .has(quality.toUpperCase())
      ? quality.toUpperCase()
      : null;

    return {
      ok: true,
      binding: {
        accessToken: verifiedAccessToken,
        phoneNumberId,
        wabaId,
        graphApiVersion: input.graphApiVersion,
        verifiedName,
        displayPhoneNumber,
        qualityRating,
        codeVerificationStatus: "VERIFIED",
      },
    };
  } catch (error) {
    const metadata = externalErrorMetadata(error);
    console.error("WhatsApp binding verification failed", metadata);
    return {
      ok: false,
      reason: metadata.kind === "http" && (metadata.status === 401 || metadata.status === 403)
        ? "authentication_failed"
        : metadata.kind === "http" && metadata.status === 404
          ? "ownership_mismatch"
          : "provider_unavailable",
    };
  }
}

function templatePageUrl(
  graphApiVersion: string,
  wabaId: string,
  after: string | null,
): URL {
  const url = new URL(
    `${META_GRAPH_ORIGIN}/${graphApiVersion}/${wabaId}/message_templates`,
  );
  url.searchParams.set("fields", "name,language,status");
  url.searchParams.set("limit", String(META_TEMPLATE_PAGE_SIZE));
  if (after) url.searchParams.set("after", after);
  return url;
}

/**
 * Lists a bounded projection of APPROVED Meta templates for one exact tenant.
 * The bearer token never leaves this server-only data path.
 */
export async function listApprovedTenantWhatsAppTemplates(
  tenantId: string,
): Promise<ApprovedWhatsAppTemplateResult> {
  const admin = createAdminClient();
  const { data: integration, error: integrationError } = await admin
    .from("tenant_integrations")
    .select("id, external_account_id, whatsapp_business_account_id, graph_api_version, connection_status, binding_verified_at")
    .eq("tenant_id", tenantId)
    .eq("provider", "whatsapp")
    .eq("is_active", true)
    .eq("connection_status", "healthy")
    .not("binding_verified_at", "is", null)
    .maybeSingle();

  if (integrationError) {
    console.error("WhatsApp template integration lookup failed", {
      code: integrationError.code,
    });
    return { ok: false, error: "WhatsApp şablonları şu anda okunamıyor." };
  }
  if (!integration) {
    return {
      ok: false,
      error: "Önce Ayarlar bölümünden WhatsApp Cloud API bağlantısını yapılandırın.",
    };
  }

  const phoneNumberId = canonicalizeMetaNumericId(integration.external_account_id);
  const wabaId = canonicalizeMetaNumericId(integration.whatsapp_business_account_id);
  const graphApiVersion = integration.graph_api_version;
  if (
    !phoneNumberId ||
    !wabaId ||
    !isAllowedWhatsAppGraphVersion(graphApiVersion) ||
    integration.connection_status !== "healthy" ||
    !integration.binding_verified_at
  ) {
    return {
      ok: false,
      error: "WhatsApp Cloud API bağlantı bilgileri eksik veya geçersiz.",
    };
  }

  const { data: secret, error: secretError } = await admin
    .from("tenant_integration_secrets")
    .select("credentials")
    .eq("integration_id", integration.id)
    .maybeSingle();
  if (secretError) {
    console.error("WhatsApp template secret lookup failed", { code: secretError.code });
    return { ok: false, error: "WhatsApp şablonları şu anda okunamıyor." };
  }

  const accessToken = secretString(
    secret?.credentials,
    "access_token",
    "accessToken",
    "api_token",
    "apiToken",
    "token",
  );
  if (!isValidWhatsAppAccessToken(accessToken)) {
    return {
      ok: false,
      error: "WhatsApp Cloud API erişim anahtarı eksik veya geçersiz.",
    };
  }

  const templates = new Map<string, ApprovedWhatsAppTemplate>();
  const seenCursors = new Set<string>();
  let after: string | null = null;

  try {
    for (let page = 0; page < META_TEMPLATE_MAX_PAGES; page += 1) {
      const response = await fetchExternal(
        templatePageUrl(graphApiVersion, wabaId, after),
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          cache: "no-store",
          redirect: "error",
        },
        { timeoutMs: META_TEMPLATE_TIMEOUT_MS },
      );
      await requireExternalSuccess(response);
      const payload = await readExternalJson<unknown>(
        response,
        META_TEMPLATE_MAX_RESPONSE_BYTES,
      );
      const pageTemplates = approvedTemplatesFromMetaPayload(payload);
      if (!pageTemplates) throw new SyntaxError("Invalid Meta template response shape.");

      for (const template of pageTemplates) {
        templates.set(`${template.name}\u0000${template.language}`, template);
        if (templates.size >= META_TEMPLATE_MAX_RESULTS) break;
      }
      if (templates.size >= META_TEMPLATE_MAX_RESULTS) break;

      const nextCursor = nextCursorFromMetaPayload(payload);
      if (!nextCursor || seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      after = nextCursor;
    }
  } catch (error) {
    console.error("WhatsApp approved template request failed", externalErrorMetadata(error));
    return {
      ok: false,
      error: "Meta onaylı şablon listesi alınamadı; adı ve dili elle girebilirsiniz.",
    };
  }

  return {
    ok: true,
    templates: [...templates.values()].sort((left, right) =>
      left.name.localeCompare(right.name) || left.language.localeCompare(right.language)),
  };
}
