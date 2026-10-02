export const WHATSAPP_GRAPH_VERSIONS = ["v22.0", "v23.0", "v24.0", "v25.0"] as const;

export type WhatsAppGraphVersion = (typeof WHATSAPP_GRAPH_VERSIONS)[number];

const META_NUMERIC_ID_RE = /^[0-9]{5,32}$/;
const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;
const TEMPLATE_LANGUAGE_RE = /^[a-z]{2,3}(?:_[A-Z]{2})?$/;

export function canonicalizeMetaNumericId(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return META_NUMERIC_ID_RE.test(normalized) ? normalized : null;
}

export function isAllowedWhatsAppGraphVersion(
  value: unknown,
): value is WhatsAppGraphVersion {
  return (WHATSAPP_GRAPH_VERSIONS as readonly string[]).includes(
    String(value ?? "").trim(),
  );
}

export function isValidWhatsAppAccessToken(value: unknown): boolean {
  const token = String(value ?? "").trim();
  return token.length >= 20 && token.length <= 4096 && !/[\s\u0000-\u001f\u007f]/.test(token);
}

/** POST response classes where provider acceptance cannot be ruled out safely. */
export function isAmbiguousWhatsAppHttpStatus(status: number): boolean {
  return status === 408 || (status >= 500 && status <= 599);
}

export function isValidWhatsAppTemplateName(value: unknown): boolean {
  return TEMPLATE_NAME_RE.test(String(value ?? "").trim());
}

export function isValidWhatsAppTemplateLanguage(value: unknown): boolean {
  return TEMPLATE_LANGUAGE_RE.test(String(value ?? "").trim());
}
