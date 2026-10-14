import { beforeEach, describe, expect, it, vi } from "vitest";

const logError = vi.fn(async () => {});
const checkRateLimit = vi.fn(async () => ({ allowed: true }));
let clock = 1_000_000;

vi.mock("@/lib/error-log", () => ({ logError }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/lib/base-url", () => ({ getBaseUrl: () => "https://emlaksoft.com.tr" }));
vi.mock("@/lib/clock", () => ({ now: () => clock }));

const ORIGIN = "https://emlaksoft.com.tr";

function report(sample: string, contentType = "application/csp-report", extra: Record<string, unknown> = {}) {
  const body = JSON.stringify({
    "csp-report": {
      "document-uri": `${ORIGIN}/app/musteriler`,
      "effective-directive": "script-src-elem",
      "blocked-uri": "inline",
      "script-sample": sample,
      disposition: "report",
      ...extra,
    },
  });
  return new Request(`${ORIGIN}/api/csp-rapor`, {
    method: "POST",
    headers: { "content-type": contentType, "x-forwarded-for": "203.0.113.9", "user-agent": "test-ua" },
    body,
  });
}

describe("POST /api/csp-rapor", () => {
  beforeEach(() => {
    vi.resetModules();
    logError.mockClear();
    checkRateLimit.mockClear();
    checkRateLimit.mockResolvedValue({ allowed: true });
    clock += 60 * 60_000;
  });

  it("ihlali error_logs'a 'csp' kaynağıyla yazar, 204 döner", async () => {
    const { POST } = await import("./route");
    const res = await POST(report("var a=1"));
    expect(res.status).toBe(204);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ source: "csp", message: "CSP (rapor modu) script-src-elem: inline «var a=1»", path: null, userAgent: "test-ua" }),
    );
    expect(checkRateLimit).toHaveBeenCalledWith("csp-report:203.0.113.9", expect.objectContaining({ failurePolicy: "deny" }));
  });

  it("aynı ihlal 10 dakika içinde yeniden DB'ye inmez (hız sınırı da çağrılmaz); süre dolunca yeniden yazılır", async () => {
    const { POST } = await import("./route");
    await POST(report("dup"));
    await POST(report("dup"));
    expect(logError).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    clock += 11 * 60_000;
    await POST(report("dup"));
    expect(logError).toHaveBeenCalledTimes(2);
  });

  it("hız sınırı reddederse ya da gövde/tür uygunsuzsa yazmaz", async () => {
    const { POST } = await import("./route");
    checkRateLimit.mockResolvedValueOnce({ allowed: false });
    await POST(report("limitli"));
    await POST(report("tur", "text/plain"));
    await POST(report("x".repeat(40 * 1024)));
    await POST(report("baska", "application/csp-report", { "document-uri": "https://evil.example/app" }));
    expect(logError).not.toHaveBeenCalled();
  });

  it("süreç başına dakikada en çok 30 yazım", async () => {
    const { POST } = await import("./route");
    for (let i = 0; i < 40; i++) await POST(report(`farkli-${i}`));
    expect(logError).toHaveBeenCalledTimes(30);
  });
});
