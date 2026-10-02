import { describe, expect, it } from "vitest";
import {
  PUBLIC_REQUEST_MAX_BYTES,
  clientIpFromHeaders,
  isAllowedCorsOrigin,
  leadCorsHeaders,
  normalizeHttpOrigin,
  opaqueRateLimitPart,
  parseOriginAllowlist,
  publicEvidenceHash,
  readRequestBodyLimited,
  requestBodyTooLarge,
} from "./public-request-security";

describe("public request security", () => {
  it("creates stable opaque rate-limit keys without retaining input", () => {
    const first = opaqueRateLimitPart("  0555 111 22 33  ");
    expect(first).toBe(opaqueRateLimitPart("0555 111 22 33"));
    expect(first).toHaveLength(22);
    expect(first).not.toContain("0555");
    expect(first).not.toBe(opaqueRateLimitPart("0555 111 22 34"));
  });

  it("creates a full deterministic SHA-256 consent evidence hash", () => {
    const hash = publicEvidenceHash(" 203.0.113.4 ");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(publicEvidenceHash("203.0.113.4"));
    expect(publicEvidenceHash(" ")).toBeNull();
  });

  it("uses the first forwarded IP and bounds attacker-controlled input", () => {
    expect(
      clientIpFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.4, 10.0.0.1" })),
    ).toBe("203.0.113.4");
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.8" }))).toBe(
      "198.51.100.8",
    );
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
    expect(
      clientIpFromHeaders(new Headers({ "x-forwarded-for": "a".repeat(300) })),
    ).toHaveLength(128);
  });

  it("normalizes only HTTP(S) origins and removes paths", () => {
    expect(normalizeHttpOrigin("https://example.com/path?q=1")).toBe("https://example.com");
    expect(normalizeHttpOrigin("http://localhost:3000/embed")).toBe("http://localhost:3000");
    expect(normalizeHttpOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeHttpOrigin("null")).toBeNull();
    expect(normalizeHttpOrigin("not-a-url")).toBeNull();
  });

  it("parses, normalizes and deduplicates configured origins", () => {
    expect(
      parseOriginAllowlist(
        "https://one.example/path, https://two.example, https://one.example, ftp://bad.example",
      ),
    ).toEqual(["https://one.example", "https://two.example"]);
  });

  it("allows form/server posts without Origin and exact browser origins only", () => {
    const allowed = new Set(["https://office.example"]);
    expect(isAllowedCorsOrigin(null, allowed)).toBe(true);
    expect(isAllowedCorsOrigin("https://office.example/form", allowed)).toBe(true);
    expect(isAllowedCorsOrigin("https://evil.example", allowed)).toBe(false);
    expect(isAllowedCorsOrigin("null", allowed)).toBe(false);
  });

  it("echoes only an allowed CORS origin and marks responses no-store", () => {
    const allowed = ["https://office.example"];
    const accepted = leadCorsHeaders("https://office.example/embed", allowed);
    expect(accepted["Access-Control-Allow-Origin"]).toBe("https://office.example");
    expect(accepted["Cache-Control"]).toBe("no-store");
    expect(accepted.Vary).toBe("Origin");

    const rejected = leadCorsHeaders("https://evil.example", allowed);
    expect(rejected).not.toHaveProperty("Access-Control-Allow-Origin");
    expect(Object.values(rejected)).not.toContain("*");
  });

  it("rejects declared request bodies above the public endpoint limit", () => {
    expect(requestBodyTooLarge(new Headers())).toBe(false);
    expect(
      requestBodyTooLarge(new Headers({ "content-length": String(PUBLIC_REQUEST_MAX_BYTES) })),
    ).toBe(false);
    expect(
      requestBodyTooLarge(new Headers({ "content-length": String(PUBLIC_REQUEST_MAX_BYTES + 1) })),
    ).toBe(true);
  });

  it("enforces the byte ceiling even when Content-Length cannot be trusted", async () => {
    const accepted = await readRequestBodyLimited(
      new Request("https://example.test", { method: "POST", body: "12345" }),
      5,
    );
    expect(new TextDecoder().decode(accepted!)).toBe("12345");

    const rejected = await readRequestBodyLimited(
      new Request("https://example.test", { method: "POST", body: "123456" }),
      5,
    );
    expect(rejected).toBeNull();
  });
});
