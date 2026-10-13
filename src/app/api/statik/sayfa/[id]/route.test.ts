import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Statik uç nokta güvenliği (G1): jetonsuz doğrudan istek 404; kayıtta olmayan / kalıcı kapalı kimlik 404;
 * sorgu dizesi kaynağa ve önbellek anahtarına girmez (aynı kimliğe farklı sorgular tek çizim).
 */
const h = vi.hoisted(() => ({ fetched: [] as string[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/external-fetch", () => ({
  fetchExternal: async (url: string) => {
    h.fetched.push(url);
    return new Response("<html><head></head><body><p>kaynak</p></body></html>", { status: 200 });
  },
}));
vi.mock("@/lib/perf/store", () => ({
  readStaticRev: async () => 0,
  incrementStaticRev: async () => 1,
  readStaticToggles: async () => ({}),
}));
vi.mock("@/lib/billing/public-pricing", () => ({
  getPublicPricing: async () => ({ plans: [], trialDays: 14, offers: {}, founders: null, efValuationCost: 0, efLive: false }),
}));

const ENV = { OTP_HMAC_SECRET: "test-secret-0123456789abcdef0123456789" };

async function token() {
  const { staticRewriteToken } = await import("@/lib/static-home/internal-token");
  return (await staticRewriteToken(ENV))!;
}

const call = async (path: string, headers: Record<string, string> = {}) => {
  const { GET } = await import("./route");
  const id = new URL(`http://x${path}`).pathname.split("/").pop()!;
  return GET(new Request(`http://localhost${path}`, { headers }), { params: Promise.resolve({ id }) });
};

describe("/api/statik/sayfa/[id] ve /api/statik/ana-sayfa", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    Object.assign(process.env, ENV);
    h.fetched.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const k of Object.keys(ENV)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("jetonsuz ya da yanlış jetonla 404 (kaynak hiç çekilmez)", async () => {
    expect((await call("/api/statik/sayfa/home")).status).toBe(404);
    expect((await call("/api/statik/sayfa/home", { "x-static-rewrite": "yanlis" })).status).toBe(404);
    const { GET } = await import("../../ana-sayfa/route");
    expect((await GET(new Request("http://localhost/api/statik/ana-sayfa"))).status).toBe(404);
    expect(h.fetched).toEqual([]);
  });

  it("sır yoksa jeton üretilmez ve her istek 404", async () => {
    const { staticRewriteToken, hasValidStaticRewrite } = await import("@/lib/static-home/internal-token");
    expect(await staticRewriteToken({})).toBeNull();
    expect(await hasValidStaticRewrite({ get: () => "x" }, {})).toBe(false);
  });

  it("kayıtta olmayan ya da kalıcı kapalı kimlik jetonla da 404", async () => {
    const t = await token();
    expect((await call("/api/statik/sayfa/kayit", { "x-static-rewrite": t })).status).toBe(404);
    expect((await call("/api/statik/sayfa/__proto__", { "x-static-rewrite": t })).status).toBe(404);
    expect((await call("/api/statik/sayfa/fiyatlar", { "x-static-rewrite": t })).status).toBe(404);
    expect(h.fetched).toEqual([]);
  });

  it("geçerli jetonla sunar; kaynak kayıt yolu (sorgusuz), farklı sorgular tek önbellek girdisi", async () => {
    const t = await token();
    const a = await call("/api/statik/sayfa/gizlilik?utm_source=x", { "x-static-rewrite": t });
    const b = await call("/api/statik/sayfa/gizlilik?baska=1", { "x-static-rewrite": t });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.headers.get("x-static")).toMatch(/^(1|fallback)$/);
    expect(a.headers.get("etag")).toBe(b.headers.get("etag"));
    expect(h.fetched).toEqual(["http://127.0.0.1:3000/gizlilik".replace("3000", process.env.PORT || "3000")]);
    const c = await call("/api/statik/sayfa/gizlilik", { "x-static-rewrite": t, "if-none-match": a.headers.get("etag")! });
    expect(c.status).toBe(304);
  });

  it("eski ana sayfa adresi aynı kapıyla korunur ve jetonla home önbelleğini kullanır", async () => {
    const t = await token();
    const { GET } = await import("../../ana-sayfa/route");
    const res = await GET(new Request("http://localhost/api/statik/ana-sayfa", { headers: { "x-static-rewrite": t } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-static-home")).toBe(res.headers.get("x-static"));
    expect(h.fetched.at(-1)).toMatch(/\/$/);
  });
});
