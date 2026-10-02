import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = readFileSync("next.config.ts", "utf8");

describe("security header contract", () => {
  it("ships a global CSP with restrictive structural directives", () => {
    expect(config).toContain('{ key: "Content-Security-Policy", value: contentSecurityPolicy }');
    expect(config).toContain('"object-src \'none\'"');
    expect(config).toContain('"base-uri \'self\'"');
    expect(config).toContain('"form-action \'self\'"');
    expect(config).toContain('"frame-ancestors \'self\'"');
  });

  it("does not allow eval in production and keeps the service worker no-store", () => {
    expect(config).toContain('isDevelopment ? " \'unsafe-eval\'" : ""');
    expect(config).toContain('source: "/sw.js"');
    expect(config).toContain("no-store, no-cache, must-revalidate, proxy-revalidate");
    expect(config).toContain("default-src 'self'; script-src 'self'; object-src 'none'");
  });
});
