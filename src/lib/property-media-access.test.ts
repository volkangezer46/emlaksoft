import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createShortLivedPropertyMediaUrl,
  PROPERTY_MEDIA_ACCESS_TTL_SECONDS,
  verifyShortLivedPropertyMediaClaim,
} from "@/lib/property-media-access";

const MEDIA_ID = "123e4567-e89b-42d3-a456-426614174000";
const NOW = Date.UTC(2026, 7, 2, 12, 0, 0);
const previousSecret = process.env.PROPERTY_MEDIA_SIGNING_SECRET;

function claimFrom(url: string) {
  const parsed = new URL(url, "https://example.test");
  return {
    mediaId: MEDIA_ID,
    scope: parsed.searchParams.get("scope") ?? "",
    expiresAt: parsed.searchParams.get("exp") ?? "",
    signature: parsed.searchParams.get("sig") ?? "",
    nowMs: NOW,
  };
}

describe("property media access claims", () => {
  beforeEach(() => {
    process.env.PROPERTY_MEDIA_SIGNING_SECRET = "test-property-media-signing-secret-at-least-32-bytes";
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.PROPERTY_MEDIA_SIGNING_SECRET;
    else process.env.PROPERTY_MEDIA_SIGNING_SECRET = previousSecret;
  });

  it("creates a short-lived claim without embedding a portal/share token", () => {
    const url = createShortLivedPropertyMediaUrl(MEDIA_ID, "share", NOW);
    const parsed = new URL(url, "https://example.test");

    expect(parsed.pathname).toBe(`/api/property-media/${MEDIA_ID}/private`);
    expect(parsed.searchParams.get("scope")).toBe("share");
    expect(parsed.searchParams.get("exp")).toBe(
      String(Math.floor(NOW / 1000) + PROPERTY_MEDIA_ACCESS_TTL_SECONDS),
    );
    expect(parsed.searchParams.get("sig")).toMatch(/^[0-9a-f]{64}$/);
    expect(url).not.toMatch(/token=/i);
    expect(verifyShortLivedPropertyMediaClaim(claimFrom(url))).toBe(true);
  });

  it("binds a claim to the exact media id and scope", () => {
    const claim = claimFrom(createShortLivedPropertyMediaUrl(MEDIA_ID, "share", NOW));

    expect(
      verifyShortLivedPropertyMediaClaim({
        ...claim,
        mediaId: "223e4567-e89b-42d3-a456-426614174000",
      }),
    ).toBe(false);
    expect(verifyShortLivedPropertyMediaClaim({ ...claim, scope: "presentation" })).toBe(false);
  });

  it("rejects tampering, expiry and replay after expiry", () => {
    const claim = claimFrom(createShortLivedPropertyMediaUrl(MEDIA_ID, "owner-portal", NOW));
    const tampered = `${claim.signature.slice(0, -1)}${claim.signature.endsWith("0") ? "1" : "0"}`;

    expect(verifyShortLivedPropertyMediaClaim({ ...claim, signature: tampered })).toBe(false);
    expect(
      verifyShortLivedPropertyMediaClaim({
        ...claim,
        nowMs: NOW + PROPERTY_MEDIA_ACCESS_TTL_SECONDS * 1000,
      }),
    ).toBe(false);
  });

  it("remains valid during a realistic lazy-loaded presentation session", () => {
    const claim = claimFrom(createShortLivedPropertyMediaUrl(MEDIA_ID, "presentation", NOW));
    expect(
      verifyShortLivedPropertyMediaClaim({ ...claim, nowMs: NOW + 20 * 60 * 1000 }),
    ).toBe(true);
  });

  it("rejects claims too far in the future", () => {
    const futureIssuer = NOW + 10 * 60 * 1000;
    const claim = claimFrom(
      createShortLivedPropertyMediaUrl(MEDIA_ID, "customer-portal", futureIssuer),
    );

    expect(verifyShortLivedPropertyMediaClaim({ ...claim, nowMs: NOW })).toBe(false);
  });

  it("fails closed when the dedicated secret is absent or too short", () => {
    delete process.env.PROPERTY_MEDIA_SIGNING_SECRET;
    expect(() => createShortLivedPropertyMediaUrl(MEDIA_ID, "share", NOW)).toThrow();

    process.env.PROPERTY_MEDIA_SIGNING_SECRET = "short";
    expect(() => createShortLivedPropertyMediaUrl(MEDIA_ID, "share", NOW)).toThrow();
  });
});
