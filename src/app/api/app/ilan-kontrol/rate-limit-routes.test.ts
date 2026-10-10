import { beforeEach, describe, expect, it, vi } from "vitest";

/** Eklenti köprüsü uçları: kullanıcı başına hız sınırı; sınır aşımı VE sayaç altyapısı arızası (deny) 429 döner. */
const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock("@/lib/supabase/auth-cache", () => ({ getRequestUser: async () => ({ id: "u1" }) }));
const importPortalInventory = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock("@/app/actions/listing-control-inventory", () => ({ importPortalInventory: (...a: unknown[]) => importPortalInventory(...a) }));
const workerClaim = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock("@/app/actions/listing-control-worker", () => ({
  workerClaim: (...a: unknown[]) => workerClaim(...a),
  workerComplete: vi.fn(), workerRegister: vi.fn(), workerRelease: vi.fn(), workerReportParser: vi.fn(async () => null),
}));

const req = (path: string) =>
  new Request(`https://emlaksoft.vercel.app${path}`, {
    method: "POST",
    headers: { "x-emlaksoft-bridge": "1", origin: "https://emlaksoft.vercel.app", "content-type": "application/json" },
    body: JSON.stringify({ op: "claim" }),
  });

describe("ilan-kontrol köprü uçları hız sınırı", () => {
  beforeEach(() => { checkRateLimit.mockReset(); workerClaim.mockClear(); importPortalInventory.mockClear(); });

  it("envanter: kullanıcı anahtarı + deny politikası; reddedilince 429 ve iş yapılmaz", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, degraded: true });
    const { POST } = await import("./envanter/route");
    const res = await POST(req("/api/app/ilan-kontrol/envanter"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(checkRateLimit).toHaveBeenCalledWith("lc-inv:u1", { limit: 20, windowSec: 60, failurePolicy: "deny" });
    expect(importPortalInventory).not.toHaveBeenCalled();
  });

  it("işçi: kullanıcı anahtarı + deny; reddedilince 429, işçi eylemi çağrılmaz", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, degraded: true });
    const { POST } = await import("./isci/route");
    const res = await POST(req("/api/app/ilan-kontrol/isci"));
    expect(res.status).toBe(429);
    expect(checkRateLimit).toHaveBeenCalledWith("lc-isci:u1", { limit: 120, windowSec: 60, failurePolicy: "deny" });
    expect(workerClaim).not.toHaveBeenCalled();
  });

  it("izin verilince istek işleme geçer (429 değil)", async () => {
    checkRateLimit.mockResolvedValue({ allowed: true });
    const { POST } = await import("./isci/route");
    const res = await POST(req("/api/app/ilan-kontrol/isci"));
    expect(res.status).not.toBe(429);
  });
});
