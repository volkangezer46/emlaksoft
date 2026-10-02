import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("private download response boundary", () => {
  it("tenant-scopes customer files and serves unsafe types as attachments", () => {
    const route = read("src/app/api/customer-files/[id]/download/route.ts");
    expect(route).toContain('.eq("tenant_id", gate.tenantId)');
    expect(route).toContain("SAFE_INLINE_TYPES");
    expect(route).toContain('"application/octet-stream"');
    expect(route).toContain('"X-Content-Type-Options": "nosniff"');
    expect(route).toContain('"Content-Security-Policy": "sandbox; default-src \'none\'"');
    expect(route).toContain('"CDN-Cache-Control": "private, no-store"');
  });

  it("forces unknown property media types to download", () => {
    const route = read("src/app/api/property-media/[id]/download/route.ts");
    expect(route).toContain("asAttachment || !safeInline");
    expect(route).toContain('"application/octet-stream"');
    expect(route).toContain('"X-Content-Type-Options": "nosniff"');
    expect(route).toContain('"Content-Security-Policy": "sandbox; default-src \'none\'"');
  });
});
