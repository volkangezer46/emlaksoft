import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeAllowedWhatsAppApiUrl,
  sendWhatsAppTemplateWithConfig,
  sendWhatsAppWithConfig,
} from "./netgsm";

describe("legacy WhatsApp provider network boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("accepts the fixed Meta origin and only explicitly trusted safe origins", () => {
    expect(normalizeAllowedWhatsAppApiUrl(
      "https://graph.facebook.com/v23.0/123/messages",
    )).toBe("https://graph.facebook.com/v23.0/123/messages");

    vi.stubEnv(
      "WHATSAPP_ALLOWED_API_ORIGINS",
      "https://wa.provider.com,https://127.0.0.1,https://service.internal",
    );
    expect(normalizeAllowedWhatsAppApiUrl("https://wa.provider.com/v1/messages"))
      .toBe("https://wa.provider.com/v1/messages");
    expect(normalizeAllowedWhatsAppApiUrl("https://127.0.0.1/messages")).toBeNull();
    expect(normalizeAllowedWhatsAppApiUrl("https://service.internal/messages")).toBeNull();
  });

  it.each([
    "http://graph.facebook.com/v23/messages",
    "https://graph.facebook.com.attacker.example/messages",
    "https://user:secret@graph.facebook.com/messages",
    "https://graph.facebook.com:8443/messages",
    "https://graph.facebook.com/messages?access_token=secret",
    "https://localhost/messages",
    "https://127.0.0.1/messages",
  ])("rejects unsafe provider URL %s", (url) => {
    expect(normalizeAllowedWhatsAppApiUrl(url)).toBeNull();
  });

  it("rejects redirects, bounds responses and never reflects provider bodies", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("provider-secret-or-pii", { status: 401 }))
      .mockResolvedValueOnce(new Response("x".repeat(256 * 1024 + 1), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const config = {
      apiUrl: "https://graph.facebook.com/v23.0/123/messages",
      apiToken: "test-token",
    };
    const rejected = await sendWhatsAppWithConfig(config, "+905551112233", "Merhaba");
    expect(rejected).toMatchObject({ ok: false, code: "http_401" });
    expect(rejected.error).not.toContain("provider-secret-or-pii");

    const oversized = await sendWhatsAppWithConfig(config, "+905551112233", "Merhaba");
    expect(oversized).toMatchObject({ ok: false, code: "unknown_provider_outcome" });

    for (const [, init] of fetchMock.mock.calls as Array<[unknown, RequestInit]>) {
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("never automatically replays ambiguous WhatsApp POST outcomes", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
      .mockResolvedValueOnce(new Response("upstream uncertain", { status: 503 }))
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const config = {
      apiUrl: "https://graph.facebook.com/v25.0/123456789/messages",
      apiToken: "a".repeat(32),
    };
    const template = { name: "portfoy_duyurusu", language: "tr" };

    await expect(sendWhatsAppTemplateWithConfig(config, "+905551112233", template))
      .resolves.toMatchObject({ ok: false, code: "unknown_provider_outcome" });
    await expect(sendWhatsAppTemplateWithConfig(config, "+905551112233", template))
      .resolves.toMatchObject({ ok: false, code: "unknown_provider_outcome" });
    await expect(sendWhatsAppTemplateWithConfig(config, "+905551112233", template))
      .resolves.toMatchObject({ ok: false, code: "http_429" });
  });
});
