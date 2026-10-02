import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const valuation = read("src/lib/valuation.ts");
const endeksa = read("src/lib/integrations/endeksa.ts");
const tapusor = read("src/lib/integrations/tapusor.ts");
const portals = read("src/lib/integrations/portals/index.ts");
const portalActions = read("src/app/actions/portal-keys.ts");
const efatura = read("src/lib/efatura.ts");

describe("external provider hardening contract", () => {
  it("honors database-backed valuation settings in the real request path", () => {
    expect(valuation).toContain("isEndeksaConfiguredFull");
    expect(valuation).toContain("isTapusorConfiguredFull");
    expect(endeksa).toContain("(await getEndeksaConfigFull()) ?? getEndeksaConfig()");
    expect(tapusor).toContain("(await getTapusorConfigFull()) ?? getTapusorConfig()");
  });

  it("bounds provider requests and keys the OAuth cache by full configuration", () => {
    expect(endeksa).toContain("fetchExternal(");
    expect(tapusor).toContain("fetchExternal(");
    expect(endeksa).toContain("ENDEKSA_TOKEN_MAX_RESPONSE_BYTES");
    expect(endeksa).toContain("ENDEKSA_VALUATION_MAX_RESPONSE_BYTES");
    expect(tapusor).toContain("TAPUSOR_MAX_RESPONSE_BYTES");
    expect(endeksa).not.toMatch(/\bfetch\s*\(/);
    expect(tapusor).not.toMatch(/\bfetch\s*\(/);
    expect(endeksa).toContain('redirect: "error"');
    expect(tapusor).toContain('redirect: "error"');
    expect(endeksa).toContain("configKey: key");
    expect(endeksa).toContain("config.clientSecret");
  });

  it("validates portal identity and provider base URL before saving or fetching", () => {
    expect(portalActions).toContain("isPortalName(portal)");
    expect(portalActions).toContain("normalizePortalBaseUrl(portal, baseUrl)");
    expect(portals).toContain("normalizeProviderBaseUrl(");
    expect(portals).toContain("if (!key || !configuredBaseUrl) return null");
    expect(portals).not.toMatch(/cfg\.baseUrl\s*\?\?/);
    expect(portalActions).toContain("if (!baseUrl)");
    expect(portals).toContain("encodeURIComponent(externalId)");
    expect(portals).toContain("fetchExternal(");
    expect(portals).toContain("PORTAL_MAX_RESPONSE_BYTES");
    expect(portals).not.toMatch(/\bfetch\s*\(/);
    expect(portals).toContain('redirect: "error"');
    expect(portals).not.toContain("errorCode: body.slice");
  });

  it("keeps e-invoice endpoints allow-listed, bounded and response-body safe", () => {
    expect(efatura).toContain("IMPLEMENTED_EFATURA_PROVIDERS");
    expect(efatura).toContain("process.env.EFATURA_ALLOWED_HOSTS");
    expect(efatura).toContain("fetchExternal(");
    expect(efatura).toContain("EFATURA_MAX_RESPONSE_BYTES");
    expect(efatura).not.toMatch(/\bfetch\s*\(/);
    expect(efatura).toContain('redirect: "error"');
    expect(efatura).toContain("safeArtifactUrl(data.pdf_url");
    expect(efatura).not.toContain("err.slice(0, 100)");
  });
});
