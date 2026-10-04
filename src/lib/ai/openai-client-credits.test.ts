import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn().mockResolvedValue({ ok: true }) }));
const chargeAiUsage = vi.fn();
vi.mock("@/lib/ai/credits/meter", () => ({ chargeAiUsage: (i: unknown) => chargeAiUsage(i) }));

import { openAiChat, openAiChatRequest } from "./openai-client";

const base = { apiKey: "sk", purpose: "tenant_chat", timeoutMs: 5000, maxResponseBytes: 100_000, retryBaseDelayMs: 1 };
const body = { model: "gpt-4o-mini", messages: [{ role: "user", content: "Merhaba 0532 123 45 67" }] };

describe("openai-client kredi kancasi", () => {
  beforeEach(() => chargeAiUsage.mockReset().mockResolvedValue({ metered: true, balance: 1, credits: 1 }));
  afterEach(() => vi.unstubAllGlobals());

  it("openAiChat gercek jeton sayisiyla bir kez sayar, ham istem gecmez", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 120, completion_tokens: 30 } }), { status: 200 }),
      ),
    );
    await openAiChat({ ...base, body, audit: { tenantId: "t1", actorId: "u1" } });
    expect(chargeAiUsage).toHaveBeenCalledTimes(1);
    const arg = chargeAiUsage.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toEqual({ tenantId: "t1", actorId: "u1", feature: "tenant_chat", model: "gpt-4o-mini", tokensIn: 120, tokensOut: 30 });
    expect(JSON.stringify(arg)).not.toContain("0532");
  });

  it("akis (openAiChatRequest) tahmini jetonla bir kez sayar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("data: x", { status: 200 })));
    await openAiChatRequest({ ...base, body, audit: { tenantId: "t1" } });
    expect(chargeAiUsage).toHaveBeenCalledTimes(1);
    expect((chargeAiUsage.mock.calls[0]![0] as { tokensIn: number }).tokensIn).toBeGreaterThan(0);
  });

  it("tenant baglami yoksa sayilmaz", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 })));
    await openAiChat({ ...base, body });
    expect(chargeAiUsage).not.toHaveBeenCalled();
  });

  it("FAIL-OPEN: olculemedi sonucu yaniti bozmaz", async () => {
    // Ölçüm katmanı kendi içinde fırlatmaz (meter.test.ts); burada ölçülemedi sonucu akışı bozmaz.
    chargeAiUsage.mockResolvedValue({ metered: false, balance: null, credits: 0 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "tamam" } }] }), { status: 200 })));
    let r: Awaited<ReturnType<typeof openAiChat>> | null = null;
    let thrown: unknown = null;
    try {
      r = await openAiChat({ ...base, body, audit: { tenantId: "t1" } });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeNull();
    expect(r?.content).toBe("tamam");
  });

  it("basarisiz cagri kredi harcamaz", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("hata", { status: 400 })));
    await expect(openAiChat({ ...base, body, audit: { tenantId: "t1" }, retries: 0 })).rejects.toBeTruthy();
    expect(chargeAiUsage).not.toHaveBeenCalled();
  });
});
