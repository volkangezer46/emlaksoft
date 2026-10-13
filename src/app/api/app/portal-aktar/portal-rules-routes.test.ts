import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { restamp, stampFor } from "@/lib/portal-transfer/rule-apply";
import { seedRuleSet } from "@/lib/portal-transfer/seed-rules";

/** Öğrenen kural uçları: köken/oturum/yetki/hız kapıları, eklenti sürüm başlığı, ETag/304, imza anahtarı yok → 503, gözlem sınırları. */
const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
const getRequestUser = vi.fn(async () => ({ id: "u1" }) as { id: string } | null);
vi.mock("@/lib/supabase/auth-cache", () => ({ getRequestUser: () => getRequestUser() }));
const requirePermission = vi.fn(async (..._a: unknown[]) => ({ ok: true, tenantId: "t1", userId: "u1", role: "advisor" }) as Record<string, unknown>);
vi.mock("@/lib/require-permission", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...a) }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const publicKeys: Record<string, JsonWebKey> = {};
vi.mock("@/lib/portal-transfer/rule-keys", () => ({ RULE_PUBLIC_KEYS: publicKeys }));

const ORIGIN = { "x-emlaksoft-bridge": "1", origin: "https://emlaksoft.com.tr" };
const EXT = { ...ORIGIN, "x-emlaksoft-ext": "0.6.0" };
const get = (headers: Record<string, string> = EXT, query = "?engine=f1") =>
  new Request(`https://emlaksoft.com.tr/api/app/portal-aktar/kurallar${query}`, { method: "GET", headers });
const post = (path: string, body: unknown, headers: Record<string, string> = EXT) =>
  new Request(`https://emlaksoft.com.tr${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

const SID = "6f0e4b0e-9d6b-4d34-8f0a-9d2c1f6a7a11";
const feedback = (over: Record<string, unknown> = {}, fieldOver: Record<string, unknown> = {}) => ({
  v: 1, sessionId: SID, portal: "sahibinden", engine: "f1", ruleVersion: 0, ruleSha: "a".repeat(16), phase: "filled", formFp: "f".repeat(64),
  rulesRegressed: false, consentTextVersion: 1, counts: { controls: 1, droppedPii: 0 },
  fields: [{ sig: "1".repeat(64), key: "heating", control: "choice", label: "isitma", labelSource: "label_for", options: ["kombi"], required: true, outcome: "filled", ...fieldOver }],
  ...over,
});

describe("portal kural uçları", () => {
  beforeEach(() => {
    checkRateLimit.mockReset().mockResolvedValue({ allowed: true });
    getRequestUser.mockReset().mockResolvedValue({ id: "u1" });
    requirePermission.mockReset().mockResolvedValue({ ok: true, tenantId: "t1", userId: "u1", role: "advisor" });
    rpc.mockReset();
    for (const k of Object.keys(publicKeys)) delete publicKeys[k];
  });

  it("kurallar: köken/başlık yok 403; oturum yok 401; izin yok 403; hız 429 (pt-kurallar 30/dk)", async () => {
    const { GET } = await import("./kurallar/route");
    expect((await GET(get({}))).status).toBe(403);
    getRequestUser.mockResolvedValueOnce(null);
    expect((await GET(get())).status).toBe(401);
    requirePermission.mockResolvedValueOnce({ ok: false, error: "yok" });
    expect((await GET(get())).status).toBe(403);
    expect(requirePermission).toHaveBeenLastCalledWith("portals", "view");
    checkRateLimit.mockResolvedValueOnce({ allowed: false });
    expect((await GET(get())).status).toBe(429);
    expect(checkRateLimit).toHaveBeenLastCalledWith("pt-kurallar:u1", { limit: 30, windowSec: 60, failurePolicy: "deny" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("kurallar: EXT başlığı yok / <0.6.0 / engine≠f1 → 426", async () => {
    const { GET } = await import("./kurallar/route");
    expect((await GET(get(ORIGIN))).status).toBe(426);
    expect((await GET(get({ ...ORIGIN, "x-emlaksoft-ext": "0.5.9" }))).status).toBe(426);
    const r = await GET(get(EXT, "?engine=f2"));
    expect(r.status).toBe(426);
    expect(await r.json()).toMatchObject({ error: "upgrade_required" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("kurallar: açık anahtar yoksa 503 signing_unavailable; şema yoksa 200 sets:[]", async () => {
    const { GET } = await import("./kurallar/route");
    const r = await GET(get());
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: "signing_unavailable" });
    publicKeys.k1 = { kty: "EC" };
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42883", message: "function does not exist" } });
    const p = await GET(get());
    expect(p.status).toBe(200);
    expect(await p.json()).toEqual({ engine: "f1", sets: [] });
  });

  it("kurallar: imzalı set ETag ile döner; If-None-Match → 304", async () => {
    const { signRuleSet, loadSigningKey } = await import("@/lib/portal-rules/server/sign");
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
    publicKeys.k1 = jwk;
    const st = loadSigningKey({ PORTAL_RULES_SIGNING_KEY: privateKey.export({ format: "pem", type: "pkcs8" }).toString(), PORTAL_RULES_SIGNING_KID: "k1" }, { k1: jwk });
    if (!st.ok) throw new Error(st.reason);
    const set = restamp(seedRuleSet("sahibinden"), stampFor(2, Date.now(), 14));
    const signed = await signRuleSet(set, st.key);
    if (!signed.ok) throw new Error(signed.reason);
    const row = { portal: "sahibinden", version: 2, content: set, content_sha256: signed.signed.sha, signature: signed.signed.sig, kid: "k1", expires_at: set.expiresAt };
    rpc.mockResolvedValue({ data: { outcome: "ok", sets: [row] }, error: null });
    const { GET } = await import("./kurallar/route");
    const r = await GET(get());
    expect(r.status).toBe(200);
    const etag = r.headers.get("ETag")!;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(r.headers.get("Cache-Control")).toBe("private, no-cache");
    const j = (await r.json()) as { engine: string; sets: { portal: string; sha256: string; kid: string; sig: string }[] };
    expect(j.sets).toHaveLength(1);
    expect(j.sets[0]).toMatchObject({ portal: "sahibinden", sha256: signed.signed.sha, kid: "k1", sig: signed.signed.sig });
    expect(rpc).toHaveBeenCalledWith("pt_rules_current", { p_engine: "f1" });
    const n = await GET(get({ ...EXT, "if-none-match": etag }));
    expect(n.status).toBe(304);
    expect(n.headers.get("ETag")).toBe(etag);
  });

  it("gözlem: EXT başlığı yok 426; >48000 bayt 413; 'value' anahtarı 400; geçerli yük RPC'ye süzülmüş gider", async () => {
    const { POST } = await import("./gozlem/route");
    expect((await POST(post("/api/app/portal-aktar/gozlem", feedback(), ORIGIN))).status).toBe(426);
    expect(requirePermission).toHaveBeenLastCalledWith("portals", "edit");
    expect((await POST(post("/api/app/portal-aktar/gozlem", "x".repeat(48_001)))).status).toBe(413);
    expect((await POST(post("/api/app/portal-aktar/gozlem", feedback({}, { value: "3+1" })))).status).toBe(400);
    expect((await POST(post("/api/app/portal-aktar/gozlem", feedback({ current: "x" })))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: { outcome: "ok", accepted: 1, dropped: 0, limited: 0 }, error: null });
    const r = await POST(post("/api/app/portal-aktar/gozlem", feedback({}, { options: ["kombi", "0532 111 22 33", "merkezi", "yerden"] })));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, accepted: 1, dropped: 1 });
    const [fn, args] = rpc.mock.calls[0] as [string, { p_session_id: string; p_payload: { fields: { options: string[] }[] } }];
    expect(fn).toBe("pt_report_form_feedback");
    expect(args.p_session_id).toBe(SID);
    expect(args.p_payload.fields[0]!.options).toEqual(["kombi", "merkezi", "yerden"]);
    expect(JSON.stringify(args)).not.toContain("0532");
    expect(checkRateLimit).toHaveBeenCalledWith("pt-gozlem-ofis:t1", { limit: 60, windowSec: 60, failurePolicy: "deny" });
  });

  it("gözlem: RPC sonuçlarının HTTP karşılığı; kiracı hız sınırı 429", async () => {
    const { POST } = await import("./gozlem/route");
    for (const [outcome, status] of [["invalid", 404], ["expired", 410], ["invalid_state", 409], ["forbidden", 403], ["consent_required", 400]] as const) {
      rpc.mockResolvedValueOnce({ data: { outcome }, error: null });
      expect((await POST(post("/api/app/portal-aktar/gozlem", feedback()))).status, outcome).toBe(status);
    }
    checkRateLimit.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false });
    expect((await POST(post("/api/app/portal-aktar/gozlem", feedback()))).status).toBe(429);
  });

  it("tamamla: boş rapor → p_field_report null (B8: önceki rapor korunur); dolu rapor olduğu gibi", async () => {
    const { POST } = await import("./tamamla/route");
    rpc.mockResolvedValue({ data: { outcome: "ok" }, error: null });
    await POST(post("/api/app/portal-aktar/tamamla", { sessionId: SID, portal: "sahibinden", state: "published", externalId: "1234567890", report: {} }, ORIGIN));
    expect((rpc.mock.calls.at(-1)![1] as { p_field_report: unknown }).p_field_report).toBeNull();
    await POST(post("/api/app/portal-aktar/tamamla", { sessionId: SID, portal: "sahibinden", state: "filled" }, ORIGIN));
    expect((rpc.mock.calls.at(-1)![1] as { p_field_report: unknown }).p_field_report).toBeNull();
    await POST(post("/api/app/portal-aktar/tamamla", { sessionId: SID, portal: "sahibinden", state: "filled", report: { title: "planned" } }, ORIGIN));
    expect((rpc.mock.calls.at(-1)![1] as { p_field_report: unknown }).p_field_report).toEqual({ title: "planned" });
  });
});
