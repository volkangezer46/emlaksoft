import { afterEach, describe, expect, it, vi } from "vitest";
import { publicOrigin, publicRedirect, publicUrl } from "@/lib/public-redirect";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("publicUrl / publicRedirect", () => {
  it("roots every path at NEXT_PUBLIC_APP_URL and keeps the query string", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://emlaksoft.com.tr/");
    expect(publicUrl("/app?eposta=dogrulandi").toString()).toBe("https://emlaksoft.com.tr/app?eposta=dogrulandi");
    expect(publicUrl("/kayit#form").toString()).toBe("https://emlaksoft.com.tr/kayit#form");
    expect(publicOrigin()).toBe("https://emlaksoft.com.tr");
  });

  it("rejects protocol-relative, schemed and relative input", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://emlaksoft.com.tr");
    for (const bad of ["//evil.com/x", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "app", ""]) {
      expect(() => publicUrl(bad)).toThrow();
    }
  });

  it("emits a Location header on the public root, never the container bind address", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://emlaksoft.com.tr");
    const res = publicRedirect("/kayit");
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith("https://emlaksoft.com.tr/")).toBe(true);
    expect(location).not.toContain("0.0.0.0");
    expect(publicRedirect("/imza/abc", 303).status).toBe(303);
  });
});
