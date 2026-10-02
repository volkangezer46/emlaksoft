import { createHash } from "node:crypto";

export const PUBLIC_REQUEST_MAX_BYTES = 64 * 1024;

type HeaderReader = Pick<Headers, "get">;

/**
 * Rate-limit bucket'larında IP, token, telefon veya slug'ı düz metin tutma.
 * Bu değerlerin güvenlik sırrı olmasına gerek yok; kısa SHA-256 yalnızca DB'de
 * gereksiz kişisel veri/token izi bırakmadan kararlı bir anahtar üretir.
 */
export function opaqueRateLimitPart(value: string): string {
  return createHash("sha256").update(value.trim()).digest("base64url").slice(0, 22);
}

/** Full SHA-256 evidence hash for append-only consent/audit records. */
export function publicEvidenceHash(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : null;
}

/** Proxy zincirindeki istemci IP'sini tek, sınırlandırılmış bir değere indirger. */
export function clientIpFromHeaders(headers: HeaderReader): string {
  const candidate =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    "unknown";
  return candidate.slice(0, 128) || "unknown";
}

/** Yalnız http(s) URL'lerini origin biçimine çevirir; path/query'yi atar. */
export function normalizeHttpOrigin(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw || raw === "null") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function parseOriginAllowlist(value: string | null | undefined): string[] {
  const origins = new Set<string>();
  for (const entry of value?.split(",") ?? []) {
    const origin = normalizeHttpOrigin(entry);
    if (origin) origins.add(origin);
  }
  return [...origins];
}

/** Origin taşımayan server-to-server/form POST'ları CORS kapsamı dışındadır. */
export function isAllowedCorsOrigin(
  requestOrigin: string | null,
  allowedOrigins: Iterable<string>,
): boolean {
  if (!requestOrigin) return true;
  const normalized = normalizeHttpOrigin(requestOrigin);
  if (!normalized) return false;
  return new Set(allowedOrigins).has(normalized);
}

export function leadCorsHeaders(
  requestOrigin: string | null,
  allowedOrigins: Iterable<string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  };
  if (requestOrigin && isAllowedCorsOrigin(requestOrigin, allowedOrigins)) {
    headers["Access-Control-Allow-Origin"] = normalizeHttpOrigin(requestOrigin)!;
  }
  return headers;
}

export function requestBodyTooLarge(
  headers: HeaderReader,
  maxBytes = PUBLIC_REQUEST_MAX_BYTES,
): boolean {
  const raw = headers.get("content-length");
  if (!raw) return false;
  const size = Number(raw);
  return Number.isFinite(size) && size > maxBytes;
}

/**
 * Reads a request body with an actual byte ceiling, including chunked requests
 * that omit Content-Length. Returns null after cancelling the stream if the
 * limit is exceeded.
 */
export async function readRequestBodyLimited(
  request: Pick<Request, "body">,
  maxBytes = PUBLIC_REQUEST_MAX_BYTES,
): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}
