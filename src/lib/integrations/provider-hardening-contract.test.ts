import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Kaldırılan sağlayıcı adları parçalı yazılır (bu dosya da taramaya takılmasın).
const REMOVED_PROVIDERS = new RegExp(["end" + "eksa", "tapu" + "sor"].join("|"), "i");

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const valuation = read("src/lib/valuation.ts");
const emlakfiyati = read("src/lib/integrations/emlakfiyati/adapter.ts");
const emlakfiyatiKeys = read("src/lib/integrations/emlakfiyati/keys.ts");
const portals = read("src/lib/integrations/portals/index.ts");
const portalActions = read("src/app/actions/portal-keys.ts");
const efatura = read("src/lib/efatura.ts");

describe("external provider hardening contract", () => {
  it("wires EmlakFiyati into the real valuation path and never reads removed providers", () => {
    expect(valuation).toContain("getEndeksForPlace");
    expect(valuation).not.toMatch(REMOVED_PROVIDERS);
  });

  it("leaves no code reference to the removed valuation providers under src/ or scripts/", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== ".next") walk(full);
        } else if (/\.(?:ts|tsx|css|json)$/.test(entry.name) && !full.endsWith("provider-hardening-contract.test.ts")) {
          if (REMOVED_PROVIDERS.test(readFileSync(full, "utf8"))) hits.push(full);
        }
      }
    };
    walk(resolve(process.cwd(), "src"));
    walk(resolve(process.cwd(), "scripts"));
    expect(hits).toEqual([]);
  });

  it("bounds EmlakFiyati requests: single host, https only, no redirects, size cap, env-only key", () => {
    expect(emlakfiyati).toContain("fetchExternal(");
    expect(emlakfiyati).toContain("normalizeProviderBaseUrl(");
    expect(emlakfiyati).toContain("MAX_RESPONSE_BYTES");
    expect(emlakfiyati).toContain("PROVIDER_REQUEST_TIMEOUT_MS");
    expect(emlakfiyati).not.toMatch(/fetch\s*\(/);
    // Anahtar: admin (şifreli) > ortam değişkeni (yedek); ortam değişkeni YALNIZ keys.ts'te okunur.
    expect(emlakfiyatiKeys).toContain("process.env.EMLAKFIYATI_API_KEY");
    expect(emlakfiyati).not.toContain("process.env");
    expect(emlakfiyati).not.toContain("NEXT_PUBLIC_EMLAKFIYATI");
    expect(emlakfiyatiKeys).not.toContain("NEXT_PUBLIC_EMLAKFIYATI");
    // Anahtar hiçbir log çağrısına girmez.
    expect(emlakfiyati).not.toMatch(/console\.\w+\([^)]*key/);
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
