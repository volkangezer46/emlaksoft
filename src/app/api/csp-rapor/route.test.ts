import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("süreç başına dakikada en çok 30 yazım; bütçe doluyken DB hız sınırına da gidilmez", async () => {
    const { POST } = await import("./route");
    for (let i = 0; i < 40; i++) await POST(report(`farkli-${i}`));
    expect(logError).toHaveBeenCalledTimes(30);
    expect(checkRateLimit).toHaveBeenCalledTimes(30);
  });

  it("hız sınırına takılan ihlal işaretlenmez: aynı gerçek ihlal sonraki raporda yazılır", async () => {
    const { POST } = await import("./route");
    checkRateLimit.mockResolvedValueOnce({ allowed: false });
    await POST(report("gercek"));
    expect(logError).not.toHaveBeenCalled();
    await POST(report("gercek"));
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("uydurma raporla sınırsız yeni satır açılamaz: saatte en çok 60 yeni ihlal, bilinen ihlalin tekrarı yine yazılır", async () => {
    const { POST } = await import("./route");
    await POST(report("bilinen"));
    for (let m = 0; m < 4; m++) {
      for (let i = 0; i < 30; i++) await POST(report(`sahte-${m}-${i}`));
      clock += 61_000;
    }
    expect(logError).toHaveBeenCalledTimes(60);
    logError.mockClear();
    clock += 10 * 60_000;
    await POST(report("bilinen"));
    await POST(report("yepyeni"));
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("«bilinen»") }));
    clock += 60 * 60_000;
    await POST(report("yepyeni"));
    expect(logError).toHaveBeenCalledTimes(2);
  });

  it("Content-Length'siz (parçalı) büyük gövde 32 KB'tan fazla okunmaz", async () => {
    const { POST } = await import("./route");
    const chunk = new TextEncoder().encode(" ".repeat(16 * 1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        if (sent > 64) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const req = new Request(`${ORIGIN}/api/csp-rapor`, {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const res = await POST(req);
    expect(res.status).toBe(204);
    expect(sent).toBeLessThan(10);
    expect(logError).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});

describe("CSP ölçüm satırları hata triyajını kirletmez (kaynak sözleşmesi)", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("'Açık hata türü' sayımı (Sistem özeti + Hatalar) ve varsayılan liste 'csp' kaynağını dışlar", () => {
    const triage = read("src/app/admin/sistem/_hatalar/triage.ts");
    expect(triage).toContain('export const CSP_MEASUREMENT_SOURCE = "csp";');
    expect(triage.match(/\.neq\("source", CSP_MEASUREMENT_SOURCE\)/g)).toHaveLength(2);
    const view = read("src/app/admin/sistem/_hatalar/errors-view.tsx");
    expect(view).toContain('listQ = kaynak ? listQ.eq("source", kaynak) : listQ.neq("source", CSP_MEASUREMENT_SOURCE);');
    expect(view).toContain('sonSaatQ.neq("source", CSP_MEASUREMENT_SOURCE)');
  });
});
