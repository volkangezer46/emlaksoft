import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const protectedProviderFiles = [
  "src/lib/ai/openai-client.ts",
  "src/lib/calendar/index.ts",
  "src/lib/tcmb.ts",
  "src/lib/billing/iyzico.ts",
  "src/lib/efatura.ts",
  "src/lib/integrations/emlakfiyati/adapter.ts",
  "src/lib/integrations/portals/index.ts",
  "src/lib/messaging/netgsm.ts",
  "src/lib/messaging/tenant-providers.ts",
  "src/lib/messaging/whatsapp-cloud.ts",
  "src/lib/geo-provider.ts",
] as const;

function source(file: string): string {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    if (!/\.(?:ts|tsx)$/.test(entry.name) || /\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)) {
      return [];
    }
    return [relative(process.cwd(), fullPath).split(sep).join("/")];
  });
}

describe("external provider request contract", () => {
  it.each(protectedProviderFiles)("routes %s through the hardened fetch boundary", (file) => {
    const content = source(file);
    expect(content).toContain("fetchExternal(");
    expect(content).not.toMatch(/\bfetch\s*\(/);
  });

  it("centrally rejects redirects and composes hard timeouts", () => {
    const boundary = source("src/lib/external-fetch.ts");
    expect(boundary).toContain('redirect: "error"');
    expect(boundary).toContain("AbortSignal.timeout(");
    expect(boundary).toContain("AbortSignal.any(");
  });

  it("leaves no direct server-side fetch outside the central boundary", () => {
    const directFetchFiles = sourceFiles(resolve(process.cwd(), "src"))
      .filter((file) => /\bfetch\s*\(/.test(source(file)))
      .sort();
    const browserFetchFiles = [
      "src/app/admin/danisman/advisor-chat.tsx",
      "src/app/admin/personel/[id]/page.tsx",
      "src/app/admin/personel/page.tsx",
      "src/app/app/asistan/advisor-chat.tsx",
      "src/app/app/destek/ticket-attachment-input.tsx",
      "src/app/app/pano-tv/tv-hooks.ts",
      "src/app/lead/[token]/lead-form.tsx",
      "src/app/vitrin/[slug]/favoriler/favoriler-client.tsx",
      "src/components/admin/command-palette.tsx",
      "src/components/admin/notification-bell.tsx",
      "src/hooks/use-api.ts",
    ].sort();

    expect(directFetchFiles).toEqual([
      ...browserFetchFiles,
      "src/lib/external-fetch.ts",
    ].sort());
    for (const file of browserFetchFiles) {
      expect(source(file).trimStart().startsWith('"use client";')).toBe(true);
    }
  });

  it("keeps iyzico credential-bearing requests on exact official HTTPS origins", () => {
    const iyzico = source("src/lib/billing/iyzico.ts");
    expect(iyzico).toContain('"https://sandbox-api.iyzipay.com"');
    expect(iyzico).toContain('"https://api.iyzipay.com"');
    expect(iyzico).toContain("IYZICO_ALLOWED_BASE_URLS.has(origin)");
    expect(iyzico).toContain("endpoint.origin !== config.baseUrl");
  });
});
