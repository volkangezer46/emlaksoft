import { beforeEach, describe, expect, it, vi } from "vitest";

/** Ekstre yükleme ucu: köken denetimi, oturum, kullanıcı başına hız sınırı (deny) ve boyut sınırı; iş servise devredilir. */
const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
let user: { id: string } | null = { id: "u1" };
vi.mock("@/lib/supabase/auth-cache", () => ({ getRequestUser: async () => user }));
const previewStatement = vi.fn(async (..._a: unknown[]) => ({ ok: true, format: "ofx", lineCount: 1, invalid: 0, preview: [] }));
const stageStatement = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock("@/lib/finance/statement/service", () => ({
  previewStatement: (...a: unknown[]) => previewStatement(...a),
  stageStatement: (...a: unknown[]) => stageStatement(...a),
}));

const form = (op: string) => {
  const fd = new FormData();
  fd.set("op", op);
  fd.set("accountId", "00000000-0000-4000-8000-000000000001");
  return fd;
};
const req = (op: string, headers: Record<string, string> = {}) =>
  new Request("https://emlaksoft.vercel.app/api/app/finans/ekstre", {
    method: "POST",
    headers: { "x-emlaksoft-bridge": "1", origin: "https://emlaksoft.vercel.app", ...headers },
    body: form(op),
  });

describe("POST /api/app/finans/ekstre", () => {
  beforeEach(() => {
    user = { id: "u1" };
    checkRateLimit.mockReset();
    checkRateLimit.mockResolvedValue({ allowed: true });
    previewStatement.mockClear();
    stageStatement.mockClear();
  });

  it("başlıksız / yabancı köken isteği reddedilir", async () => {
    const { POST } = await import("./route");
    expect((await POST(req("preview", { "x-emlaksoft-bridge": "0" }))).status).toBe(403);
    expect((await POST(req("preview", { origin: "https://kotu.example" }))).status).toBe(403);
    expect(previewStatement).not.toHaveBeenCalled();
  });

  it("oturum yoksa 401; hız sınırı aşılırsa (deny) 429 ve iş yapılmaz", async () => {
    const { POST } = await import("./route");
    user = null;
    expect((await POST(req("preview"))).status).toBe(401);
    user = { id: "u1" };
    checkRateLimit.mockResolvedValue({ allowed: false, degraded: true });
    const res = await POST(req("stage"));
    expect(res.status).toBe(429);
    expect(checkRateLimit).toHaveBeenCalledWith("fin-stmt:u1", { limit: 20, windowSec: 60, failurePolicy: "deny" });
    expect(stageStatement).not.toHaveBeenCalled();
  });

  it("izin verilince işlem servise devredilir; bilinmeyen işlem 400, büyük gövde 413", async () => {
    const { POST } = await import("./route");
    expect((await POST(req("preview"))).status).toBe(200);
    expect(previewStatement).toHaveBeenCalledTimes(1);
    expect((await POST(req("stage"))).status).toBe(200);
    expect(stageStatement).toHaveBeenCalledTimes(1);
    expect((await POST(req("sil"))).status).toBe(400);
    expect((await POST(req("preview", { "content-length": String(3 * 1024 * 1024) }))).status).toBe(413);
  });
});
