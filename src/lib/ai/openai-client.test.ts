import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const logActivity = vi.fn().mockResolvedValue({ ok: true });
vi.mock("@/lib/activity", () => ({ logActivity: (i: unknown) => logActivity(i) }));

import { classifyOpenAiError, openAiChat, openAiChatRequest } from "./openai-client";
import { ExternalHttpError } from "@/lib/external-fetch";

const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

const base = {
  apiKey: "sk-test",
  purpose: "test",
  timeoutMs: 5000,
  maxResponseBytes: 100_000,
  retryBaseDelayMs: 1,
};

describe("openai-client", () => {
  beforeEach(() => logActivity.mockClear());
  afterEach(() => vi.unstubAllGlobals());

  it("giden gövdeyi maskeler, yanıtı geri çevirir, denetim izine PII yazmaz", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok("Arayın: [TELEFON_1]"));
    vi.stubGlobal("fetch", fetchMock);

    const { content } = await openAiChat({
      ...base,
      audit: { tenantId: "t1", actorId: "u1" },
      body: { model: "m", messages: [{ role: "user", content: "Müşteri 0532 123 45 67 ali@x.com" }] },
    });

    const sent = String((fetchMock.mock.calls[0]![1] as RequestInit).body);
    expect(sent).not.toContain("0532");
    expect(sent).not.toContain("ali@x.com");
    expect(sent).toContain("[TELEFON_1]");
    expect(content).toBe("Arayın: 0532 123 45 67");

    expect(logActivity).toHaveBeenCalledTimes(1);
    const audit = logActivity.mock.calls[0]![0] as { tenantId: string; action: string; newValue: unknown };
    expect(audit.tenantId).toBe("t1");
    expect(audit.action).toBe("ai.openai_call");
    const logged = JSON.stringify(audit);
    expect(logged).not.toContain("0532");
    expect(logged).not.toContain("ali@x.com");
    expect(audit.newValue).toMatchObject({ outcome: "ok", redacted: { TELEFON: 1, E_POSTA: 1 } });
  });

  it("tenant yoksa denetim kaydı yazmaz", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok("x")));
    await openAiChat({ ...base, body: { model: "m", messages: [] } });
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("429/5xx'te tekrar dener, 401'de denemez", async () => {
    const f1 = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(ok("tamam"));
    vi.stubGlobal("fetch", f1);
    const r = await openAiChat({ ...base, body: { model: "m", messages: [] } });
    expect(r.content).toBe("tamam");
    expect(f1).toHaveBeenCalledTimes(2);

    const f2 = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    vi.stubGlobal("fetch", f2);
    await expect(openAiChat({ ...base, body: { model: "m", messages: [] } })).rejects.toBeInstanceOf(
      ExternalHttpError,
    );
    expect(f2).toHaveBeenCalledTimes(1);
  });

  it("istek bayt sınırını aşan gövdeyi göndermez", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const huge = "abc ".repeat(4 * 1024 * 1024);
    await expect(
      openAiChatRequest({ ...base, body: { model: "m", messages: [{ role: "user", content: huge }] } }),
    ).rejects.toThrow(/limit/);
    expect(f).not.toHaveBeenCalled();
  });

  it("hata sınıflandırma", () => {
    expect(classifyOpenAiError(new ExternalHttpError(401))).toBe("auth");
    expect(classifyOpenAiError(new ExternalHttpError(429))).toBe("rate_limit");
    expect(classifyOpenAiError(new ExternalHttpError(502))).toBe("server");
    expect(classifyOpenAiError(new ExternalHttpError(400))).toBe("bad_request");
    expect(classifyOpenAiError(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe("timeout");
    expect(classifyOpenAiError(new Error("boom"))).toBe("network");
  });
});
