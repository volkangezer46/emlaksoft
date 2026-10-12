import { beforeEach, describe, expect, it, vi } from "vitest";

/** Portal aktarım uçları: köken/oturum/hız sınırı/yetki kapıları, TEK KULLANIMLIK kod sonuçlarının HTTP karşılığı, geçersiz girdi. */
const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
const getRequestUser = vi.fn(async () => ({ id: "u1" }) as { id: string } | null);
vi.mock("@/lib/supabase/auth-cache", () => ({ getRequestUser: () => getRequestUser() }));
const requirePermission = vi.fn(async (..._a: unknown[]) => ({ ok: true, tenantId: "t1", userId: "u1", role: "advisor" }) as Record<string, unknown>);
vi.mock("@/lib/require-permission", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...a) }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a), from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prospecting/district", () => ({ resolveDistrict: async () => null }));
vi.mock("@/lib/activity", () => ({ logActivity: async () => ({ ok: true }) }));

const post = (path: string, body: unknown, headers: Record<string, string> = { "x-emlaksoft-bridge": "1", origin: "https://emlaksoft.vercel.app" }) =>
  new Request(`https://emlaksoft.vercel.app${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("portal-aktar uçları", () => {
  beforeEach(() => {
    checkRateLimit.mockReset().mockResolvedValue({ allowed: true });
    getRequestUser.mockReset().mockResolvedValue({ id: "u1" });
    requirePermission.mockReset().mockResolvedValue({ ok: true, tenantId: "t1", userId: "u1", role: "advisor" });
    rpc.mockReset();
  });

  it("aynı köken + özel başlık yoksa 403; oturum yoksa 401; hız sınırı (deny) 429", async () => {
    const { POST } = await import("./al/route");
    expect((await POST(post("/api/app/portal-aktar/al", { code: "ABCDE-FGHJK" }, {}))).status).toBe(403);
    getRequestUser.mockResolvedValueOnce(null);
    expect((await POST(post("/api/app/portal-aktar/al", { code: "ABCDE-FGHJK" }))).status).toBe(401);
    checkRateLimit.mockResolvedValueOnce({ allowed: false });
    const res = await POST(post("/api/app/portal-aktar/al", { code: "ABCDE-FGHJK" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(checkRateLimit).toHaveBeenCalledWith("pt-al:u1", { limit: 20, windowSec: 60, failurePolicy: "deny" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("yetki yoksa 403 ve RPC çağrılmaz", async () => {
    requirePermission.mockResolvedValueOnce({ ok: false, error: "yok" });
    const { POST } = await import("./al/route");
    expect((await POST(post("/api/app/portal-aktar/al", { code: "ABCDE-FGHJK" }))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("al: geçersiz kod biçimi 400; ikinci kullanım 410 'used'; süresi dolan 410 'expired'; bilinmeyen 404", async () => {
    const { POST } = await import("./al/route");
    expect((await POST(post("/api/app/portal-aktar/al", { code: "x" }))).status).toBe(400);
    const outcomes: [string, number][] = [["used", 410], ["expired", 410], ["invalid", 404], ["forbidden", 403]];
    for (const [outcome, status] of outcomes) {
      rpc.mockResolvedValueOnce({ data: { outcome }, error: null });
      const res = await POST(post("/api/app/portal-aktar/al", { code: "ABCDE-FGHJK" }));
      expect(res.status, outcome).toBe(status);
      const j = (await res.json()) as { ok: boolean; error: string; message: string };
      expect(j).toMatchObject({ ok: false, error: outcome });
      expect(j.message.length).toBeGreaterThan(5);
    }
    // Kod ham olarak değil, SHA-256 özetiyle RPC'ye gider.
    const sent = rpc.mock.calls.at(-1)![1] as { p_code_hash: string };
    expect(sent.p_code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("ABCDE");
  });

  it("al: migration yoksa 502 schema_pending (sessiz hata değil)", async () => {
    const { POST } = await import("./al/route");
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42883", message: "function does not exist" } });
    const res = await POST(post("/api/app/portal-aktar/al", { code: "ABCDE-FGHJK" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "schema_pending" });
  });

  it("tamamla: yayın için ilan no/bağlantı doğrulanır; başka portföye bağlı numara 409", async () => {
    const { POST } = await import("./tamamla/route");
    const sid = "6f0e4b0e-9d6b-4d34-8f0a-9d2c1f6a7a11";
    expect((await POST(post("/api/app/portal-aktar/tamamla", { sessionId: sid, portal: "sahibinden", state: "published", externalId: "abc" }))).status).toBe(400);
    expect((await POST(post("/api/app/portal-aktar/tamamla", { sessionId: "x", portal: "sahibinden", state: "filled" }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: { outcome: "bound_to_other_property" }, error: null });
    const res = await POST(post("/api/app/portal-aktar/tamamla", { sessionId: sid, portal: "sahibinden", state: "published", externalId: "1234567890" }));
    expect(res.status).toBe(409);
    expect(rpc).toHaveBeenCalledWith("pt_complete_session", expect.objectContaining({ p_state: "published", p_external_id: "1234567890" }));
    rpc.mockResolvedValueOnce({ data: { outcome: "ok" }, error: null });
    expect((await POST(post("/api/app/portal-aktar/tamamla", { sessionId: sid, portal: "sahibinden", state: "filled", report: { title: "planned" } }))).status).toBe(200);
  });

  it("ice-al: portföy oluşturma için properties:create da gerekir; geçerli ilan yoksa 400", async () => {
    const { POST } = await import("./ice-al/route");
    requirePermission.mockResolvedValueOnce({ ok: true, tenantId: "t1", userId: "u1", role: "advisor" }).mockResolvedValueOnce({ ok: false, error: "yok" });
    expect((await POST(post("/api/app/portal-aktar/ice-al", { portal: "sahibinden", items: [] }))).status).toBe(403);
    expect(requirePermission.mock.calls.map((c) => c.slice(0, 2).join(":"))).toEqual(["portals:edit", "properties:create"]);
    const res = await POST(post("/api/app/portal-aktar/ice-al", { portal: "sahibinden", items: [{ externalId: "abc" }] }));
    expect(res.status).toBe(400);
    expect((await POST(post("/api/app/portal-aktar/ice-al", { portal: "zingat", items: [] }))).status).toBe(400);
  });
});
