import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export const PROPERTY_MEDIA_ACCESS_SCOPES = [
  "share",
  "presentation",
  "customer-portal",
  "owner-portal",
] as const;

export type PropertyMediaAccessScope = (typeof PROPERTY_MEDIA_ACCESS_SCOPES)[number];

const MEDIA_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Private pages lazy-load images while the visitor scrolls. Thirty minutes is
// long enough for a presentation while each claim remains bound to one media
// id and one scope. It is never a reusable portal credential.
export const PROPERTY_MEDIA_ACCESS_TTL_SECONDS = 30 * 60;
const MAX_FUTURE_SECONDS = PROPERTY_MEDIA_ACCESS_TTL_SECONDS + 60;

function signingSecret() {
  const secret = process.env.PROPERTY_MEDIA_SIGNING_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("PROPERTY_MEDIA_SIGNING_SECRET eksik veya cok kisa.");
  }
  return secret;
}

function signature(mediaId: string, scope: PropertyMediaAccessScope, expiresAt: number) {
  return createHmac("sha256", signingSecret())
    .update(
      ["property-media-v1", scope, mediaId.toLowerCase(), String(expiresAt)].join("\n"),
      "utf8",
    )
    .digest("hex");
}

export function isPropertyMediaAccessScope(value: string): value is PropertyMediaAccessScope {
  return (PROPERTY_MEDIA_ACCESS_SCOPES as readonly string[]).includes(value);
}

/**
 * Token sayfasi once kendi kaydini ve nesne iliskisini DB'de dogrular. Ardindan
 * yalniz render ettigi medya kimligi icin kisa omurlu bir claim uretir. Portal
 * tokeni URL'ye tasinmaz; claim baska medya kimligine veya scope'a aktarilamaz.
 */
export function createShortLivedPropertyMediaUrl(
  mediaId: string,
  scope: PropertyMediaAccessScope,
  nowMs = Date.now(),
) {
  if (!MEDIA_ID_RE.test(mediaId)) {
    throw new Error("Gecersiz property media kimligi.");
  }
  const expiresAt = Math.floor(nowMs / 1000) + PROPERTY_MEDIA_ACCESS_TTL_SECONDS;
  const query = new URLSearchParams({
    scope,
    exp: String(expiresAt),
    sig: signature(mediaId, scope, expiresAt),
  });
  return `/api/property-media/${mediaId}/private?${query.toString()}`;
}

export function verifyShortLivedPropertyMediaClaim(input: {
  mediaId: string;
  scope: string;
  expiresAt: string;
  signature: string;
  nowMs?: number;
}) {
  if (
    !MEDIA_ID_RE.test(input.mediaId) ||
    !isPropertyMediaAccessScope(input.scope) ||
    !/^\d{10}$/.test(input.expiresAt) ||
    !/^[0-9a-f]{64}$/i.test(input.signature)
  ) {
    return false;
  }

  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const expiresAt = Number(input.expiresAt);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= nowSeconds ||
    expiresAt > nowSeconds + MAX_FUTURE_SECONDS
  ) {
    return false;
  }

  try {
    const expected = signature(input.mediaId, input.scope, expiresAt);
    return timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(input.signature.toLowerCase(), "hex"),
    );
  } catch {
    return false;
  }
}
