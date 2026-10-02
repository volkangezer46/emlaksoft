import { describe, expect, it } from "vitest";
import { normalizeProviderBaseUrl, providerAllowedHosts } from "./provider-url";

describe("provider base URL boundary", () => {
  const allowed = providerAllowedHosts(["api.example.com"], "sandbox.example.com");

  it("accepts only exact allow-listed HTTPS hosts", () => {
    expect(normalizeProviderBaseUrl("https://api.example.com/v1/", allowed))
      .toBe("https://api.example.com/v1");
    expect(normalizeProviderBaseUrl("https://sandbox.example.com", allowed))
      .toBe("https://sandbox.example.com");
    expect(normalizeProviderBaseUrl("https://evil.api.example.com", allowed)).toBeNull();
  });

  it.each([
    "http://api.example.com",
    "https://user:secret@api.example.com",
    "https://api.example.com:8443",
    "https://api.example.com/v1?next=http://127.0.0.1",
    "https://127.0.0.1",
    "https://localhost",
    "https://service.internal",
  ])("rejects unsafe provider URL %s", (url) => {
    expect(normalizeProviderBaseUrl(url, allowed)).toBeNull();
  });
});
