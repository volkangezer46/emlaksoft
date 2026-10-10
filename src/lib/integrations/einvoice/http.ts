/**
 * e-Fatura sağlayıcı HTTP sınırı (TEK yer). Ağ çağrısı yalnız `fetchExternal` ile yapılır: yönlendirme reddedilir,
 * zaman aşımı zorunludur, yanıt boyutu sınırlıdır. Ana bilgisayar yalnız sabit izin listesinden gelir
 * (kullanıcıdan URL alınmaz). Yetki başlığı/anahtar hata mesajına ya da loga ASLA girmez.
 */
import {
  ExternalResponseTooLargeError,
  externalErrorMetadata,
  fetchExternal,
  readExternalText,
} from "@/lib/external-fetch";
import { PROVIDER_REQUEST_TIMEOUT_MS } from "@/lib/integrations/provider-url";
import { fail, ok, type AdapterError, type Result } from "./types";

export const EINVOICE_ALLOWED_HOSTS = ["api.nilvera.com", "apitest.nilvera.com", "api.parasut.com"] as const;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_PDF_BYTES = 8 * 1024 * 1024;

export type ProviderRequest = {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  url: string;
  headers?: Record<string, string>;
  /** JSON gövde (nesne) ya da hazır form gövdesi. */
  json?: unknown;
  form?: Record<string, string>;
  /** Bu durum kodları hata sayılmaz (çağıran işler). */
  allowStatuses?: readonly number[];
  timeoutMs?: number;
};

export type ProviderResponse = { status: number; text: string; json: unknown | null; contentType: string };

function hostAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      (EINVOICE_ALLOWED_HOSTS as readonly string[]).includes(u.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

function clean(text: string, max = 200): string {
  return text.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max);
}

function pickString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/** Sağlayıcı hata gövdesinden kısa, kullanıcıya gösterilebilir ayrıntı (anahtar/başlık içermez). */
export function extractProviderDetail(text: string): string | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed === "string") return clean(parsed) || null;
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  for (const key of ["Message", "message", "error_description", "error", "detail", "title"]) {
    const s = pickString(obj[key]);
    if (s) return clean(s);
  }
  const errors = obj.errors ?? obj.Errors;
  if (Array.isArray(errors)) {
    const parts = errors
      .map((e) => {
        if (typeof e === "string") return e;
        if (e && typeof e === "object") {
          const r = e as Record<string, unknown>;
          return pickString(r.detail) ?? pickString(r.title) ?? pickString(r.message) ?? pickString(r.Message);
        }
        return null;
      })
      .filter((s): s is string => Boolean(s));
    if (parts.length) return clean(parts.join("; "));
  }
  return null;
}

export function errorForStatus(provider: string, status: number, text: string): AdapterError {
  if (status === 401 || status === 403) {
    return { code: "unauthorized", status, message: `${provider} kimlik doğrulamasını kabul etmedi. Anahtar bilgilerini kontrol edin.` };
  }
  if (status === 404) return { code: "not_found", status, message: `${provider} kaydı bulamadı.` };
  if (status === 429) return { code: "rate_limited", status, message: `${provider} istek sınırına ulaşıldı. Biraz sonra tekrar deneyin.` };
  if (status >= 500) return { code: "unavailable", status, message: `${provider} şu an yanıt vermiyor. Biraz sonra tekrar deneyin.` };
  const detail = extractProviderDetail(text);
  return {
    code: "rejected",
    status,
    message: detail ? `${provider} isteği reddetti: ${detail}` : `${provider} isteği reddetti (HTTP ${status}).`,
  };
}

function networkError(provider: string, error: unknown): AdapterError {
  const meta = externalErrorMetadata(error);
  if (meta.kind === "timeout") return { code: "unavailable", message: `${provider} zamanında yanıt vermedi.` };
  if (meta.kind === "response_too_large") return { code: "invalid_response", message: `${provider} beklenenden büyük yanıt döndürdü.` };
  return { code: "unavailable", message: `${provider} ile bağlantı kurulamadı.` };
}

function buildInit(req: ProviderRequest): RequestInit {
  const headers: Record<string, string> = { Accept: "application/json", ...req.headers };
  let body: string | undefined;
  if (req.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(req.form).toString();
  } else if (req.json !== undefined) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    body = JSON.stringify(req.json);
  }
  return { method: req.method, headers, ...(body !== undefined ? { body } : {}) };
}

export async function providerCall(provider: string, req: ProviderRequest): Promise<Result<ProviderResponse>> {
  if (!hostAllowed(req.url)) return fail("invalid_input", "Sağlayıcı adresi izin listesinde değil.");
  let response: Response;
  try {
    response = await fetchExternal(req.url, buildInit(req), { timeoutMs: req.timeoutMs ?? PROVIDER_REQUEST_TIMEOUT_MS });
  } catch (error) {
    return { ok: false, error: networkError(provider, error) };
  }
  let text = "";
  try {
    text = await readExternalText(response, MAX_JSON_BYTES);
  } catch (error) {
    if (error instanceof ExternalResponseTooLargeError) return { ok: false, error: networkError(provider, error) };
    return { ok: false, error: networkError(provider, error) };
  }
  const allowed = req.allowStatuses?.includes(response.status) ?? false;
  if (!response.ok && !allowed) return { ok: false, error: errorForStatus(provider, response.status, text) };
  let json: unknown | null = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return ok({ status: response.status, text, json, contentType: response.headers.get("content-type") ?? "" });
}

function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/** PDF indirir: ikili ya da (JSON içinde) base64 metin gelebilir; %PDF imzası doğrulanır. */
export async function providerPdf(provider: string, req: ProviderRequest): Promise<Result<Uint8Array>> {
  if (!hostAllowed(req.url)) return fail("invalid_input", "Sağlayıcı adresi izin listesinde değil.");
  let response: Response;
  try {
    response = await fetchExternal(req.url, buildInit({ ...req, headers: { Accept: "application/pdf, application/json", ...req.headers } }), {
      timeoutMs: req.timeoutMs ?? PROVIDER_REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    return { ok: false, error: networkError(provider, error) };
  }
  if (!response.ok) {
    let text = "";
    try {
      text = await readExternalText(response, 64 * 1024);
    } catch {
      text = "";
    }
    return { ok: false, error: errorForStatus(provider, response.status, text) };
  }
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_PDF_BYTES) {
    return fail("invalid_response", `${provider} beklenenden büyük belge döndürdü.`);
  }
  let buf: Uint8Array;
  try {
    buf = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    return { ok: false, error: networkError(provider, error) };
  }
  if (buf.byteLength > MAX_PDF_BYTES) return fail("invalid_response", `${provider} beklenenden büyük belge döndürdü.`);
  if (looksLikePdf(buf)) return ok(buf);
  // JSON/düz metin içinde base64 olabilir.
  try {
    let text = new TextDecoder().decode(buf).trim();
    if (text.startsWith('"') || text.startsWith("{")) {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed === "string") text = parsed;
      else if (parsed && typeof parsed === "object") {
        const first = Object.values(parsed as Record<string, unknown>).find((v) => typeof v === "string");
        text = typeof first === "string" ? first : "";
      }
    }
    const decoded = new Uint8Array(Buffer.from(text, "base64"));
    if (looksLikePdf(decoded)) return ok(decoded);
  } catch {
    // aşağıdaki hataya düşer
  }
  return fail("invalid_response", `${provider} geçerli bir PDF döndürmedi.`);
}
