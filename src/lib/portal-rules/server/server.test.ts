import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ruleSetSha256, signedMessage, type RuleSet } from "@/lib/portal-transfer/rule-format";
import { restamp, stampFor } from "@/lib/portal-transfer/rule-apply";
import { seedRuleSet } from "@/lib/portal-transfer/seed-rules";

vi.mock("@/lib/ai/openai-client", () => ({ getOpenAiChatModel: () => "test-model", openAiChat: vi.fn() }));
vi.mock("@/lib/ai-advisor", () => ({ getOpenAiKey: async () => "sk-test" }));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: vi.fn(async () => undefined) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/settings/read", () => ({ getSetting: async () => 2 }));

const { loadSigningKey, signRuleMessage, signRuleSet, verifyRuleSignature } = await import("./sign");
const { etagFor, isSupportedExtension, loadServableRuleSets, matchesIfNoneMatch } = await import("./serve");
const { runPortalRulesLearn } = await import("./learn-step");
const { parseSuggestions } = await import("./ai-suggest");

function keypair(kid = "k1") {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  return { kid, jwk, pem, privateKey, env: { PORTAL_RULES_SIGNING_KEY: pem.replace(/\n/g, "\\n"), PORTAL_RULES_SIGNING_KID: kid } };
}

const NOW = Date.parse("2026-10-13T00:00:00Z");
const setV = (version: number, portal: "sahibinden" | "hepsiemlak" | "emlakjet" = "sahibinden"): RuleSet => restamp(seedRuleSet(portal), stampFor(version, NOW, 14));

async function webCryptoVerify(jwk: JsonWebKey, message: string, sig: Uint8Array<ArrayBuffer>): Promise<boolean> {
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, new TextEncoder().encode(message));
}

describe("imza (sign.ts) ↔ WebCrypto doğrulama", () => {
  it("P1363 imza WebCrypto ile doğrulanır; Node varsayılanı DER imza doğrulanmaz", async () => {
    const kp = keypair();
    const st = loadSigningKey(kp.env, { k1: kp.jwk });
    expect(st.ok).toBe(true);
    if (!st.ok) return;
    const set = setV(7);
    const sha = await ruleSetSha256(set);
    const msg = signedMessage("sahibinden", 7, sha);
    const sig = signRuleMessage(msg, st.key);
    expect(Buffer.from(sig, "base64url").length).toBe(64);
    expect(await webCryptoVerify(kp.jwk, msg, new Uint8Array(Buffer.from(sig, "base64url")))).toBe(true);
    const der = nodeSign("sha256", Buffer.from(msg), kp.privateKey);
    expect(await webCryptoVerify(kp.jwk, msg, new Uint8Array(der))).toBe(false);
    expect(verifyRuleSignature(msg, sig, kp.jwk)).toBe(true);
    expect(verifyRuleSignature(msg.replace("|7|", "|8|"), sig, kp.jwk)).toBe(false);
    expect(verifyRuleSignature(msg, der.toString("base64url"), kp.jwk)).toBe(false);
  });

  it("anahtar yok / kid paketlenmemiş / açık anahtar eşleşmiyor → imzalama kapalı", () => {
    const kp = keypair();
    const other = keypair();
    expect(loadSigningKey({}, { k1: kp.jwk })).toEqual({ ok: false, reason: "missing" });
    expect(loadSigningKey(kp.env, {})).toEqual({ ok: false, reason: "unknown_kid" });
    expect(loadSigningKey(kp.env, { k1: other.jwk })).toEqual({ ok: false, reason: "key_mismatch" });
    expect(loadSigningKey({ ...kp.env, PORTAL_RULES_SIGNING_KEY: "bozuk" }, { k1: kp.jwk })).toEqual({ ok: false, reason: "invalid_key" });
  });

  it("signRuleSet tohumu ve geçersiz içeriği imzalamaz", async () => {
    const kp = keypair();
    const st = loadSigningKey(kp.env, { k1: kp.jwk });
    if (!st.ok) throw new Error("anahtar");
    expect(await signRuleSet(seedRuleSet("sahibinden"), st.key)).toMatchObject({ ok: false });
    const bad = setV(2);
    bad.fields[0]!.labels.push("X");
    expect(await signRuleSet(bad, st.key)).toMatchObject({ ok: false });
    expect(await signRuleSet(setV(2), st.key)).toMatchObject({ ok: true });
  });
});

describe("kural sunumu (serve.ts)", () => {
  const rowsFor = async (kp: ReturnType<typeof keypair>, sets: RuleSet[]) => {
    const st = loadSigningKey(kp.env, { [kp.kid]: kp.jwk });
    if (!st.ok) throw new Error("anahtar");
    return Promise.all(
      sets.map(async (s) => {
        const signed = await signRuleSet(s, st.key);
        if (!signed.ok) throw new Error(signed.reason);
        return { portal: s.portal, version: s.version, content: s, content_sha256: signed.signed.sha, signature: signed.signed.sig, kid: kp.kid, expires_at: s.expiresAt };
      }),
    );
  };
  const db = (rows: unknown[] | null, error: unknown = null) => ({ rpc: async () => ({ data: rows ? { outcome: "ok", sets: rows } : null, error }) }) as never;

  it("geçerli imzalı setler sunulur; bozuk sha / imza / içerik / süresi dolmuş olan atlanır (diğer portallar etkilenmez)", async () => {
    const kp = keypair();
    const [a, b, c, d] = await rowsFor(kp, [setV(3), setV(4, "hepsiemlak"), setV(5, "emlakjet"), setV(6)]);
    const tampered = { ...b!, content: { ...setV(4, "hepsiemlak"), fingerprints: ["a".repeat(64)] } };
    const badSig = { ...c!, signature: a!.signature };
    const r = await loadServableRuleSets(db([a, tampered, badSig]), { nowMs: NOW + 1000, publicKeys: { k1: kp.jwk } });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.sets.map((s) => s.portal)).toEqual(["sahibinden"]);
    expect(r.skipped.map((s) => s.reason)).toEqual(["sha_mismatch", "bad_signature"]);
    const expired = await loadServableRuleSets(db([d]), { nowMs: NOW + 15 * 86_400_000, publicKeys: { k1: kp.jwk } });
    expect(expired.status === "ok" && expired.skipped[0]!.reason).toBe("expired");
    const unknown = await loadServableRuleSets(db([a]), { nowMs: NOW, publicKeys: { k2: kp.jwk } });
    expect(unknown.status === "ok" && unknown.skipped[0]!.reason).toBe("unknown_kid");
  });

  it("açık anahtar yoksa signing_unavailable; şema yoksa schema_pending; ETag/If-None-Match; sürüm başlığı", async () => {
    expect(await loadServableRuleSets(db([]), { nowMs: NOW, publicKeys: {} })).toEqual({ status: "signing_unavailable" });
    expect(await loadServableRuleSets(db(null, { code: "42883", message: "function does not exist" }), { nowMs: NOW, publicKeys: { k1: {} } })).toEqual({ status: "schema_pending" });
    const e = etagFor([]);
    expect(e).toMatch(/^"[0-9a-f]{64}"$/);
    expect(matchesIfNoneMatch(`W/${e}, "x"`, e)).toBe(true);
    expect(matchesIfNoneMatch(`"x"`, e)).toBe(false);
    expect(isSupportedExtension("0.6.0")).toBe(true);
    expect(isSupportedExtension("0.10.1")).toBe(true);
    expect(isSupportedExtension("0.5.9")).toBe(false);
    expect(isSupportedExtension(null)).toBe(false);
  });
});

describe("öğrenme adımı (learn-step.ts)", () => {
  function fakeAdmin(summary: Record<string, unknown>, published: { id: string; version: number; content: unknown; expires_at: string } | null) {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const chain = (result: unknown) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "not"]) c[m] = () => c;
      c.maybeSingle = async () => ({ data: result, error: null });
      c.limit = async () => ({ data: published ? [{ version: published.version }] : [], error: null });
      return c;
    };
    return {
      calls,
      db: {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          calls.push({ fn, args });
          if (fn === "pt_rules_learn") return { data: summary, error: null };
          if (fn === "pt_rules_publish_system") return { data: { outcome: "ok", id: "new", version: (published?.version ?? 0) + 1 }, error: null };
          return { data: null, error: null };
        },
        from: () => chain(published),
      } as never,
    };
  }

  it("tablo yoksa skipped; otomatik yayın kapalıyken hiçbir şey yayınlanmaz", async () => {
    const missing = { rpc: async () => ({ data: null, error: { code: "42883", message: "function does not exist" } }) } as never;
    expect(await runPortalRulesLearn(missing, { nowMs: NOW, signing: { ok: false, reason: "missing" } })).toEqual({ status: "skipped", reason: "schema_pending" });
    const ready = [{ id: "p1", portal: "sahibinden", kind: "label_map", field_key: "heating", source: "corrections", proposal: { anchor: "0123456789abcdef" }, confidence: 0.6 }];
    const f = fakeAdmin({ outcome: "ok", settings: { auto_publish: false, auto_degrade: false }, ready, demote_candidates: [], demote_budget: 3 }, null);
    const r = await runPortalRulesLearn(f.db, { nowMs: NOW, signing: { ok: false, reason: "missing" } });
    expect(r).toMatchObject({ status: "ok", ready: 1, published: [] });
    expect(f.calls.map((c) => c.fn)).toEqual(["pt_rules_learn"]);
  });

  it("auto_publish açık + anahtar var: hazır öneri imzalı yeni sürümle yayınlanır; AI önerisi asla", async () => {
    const kp = keypair();
    const st = loadSigningKey(kp.env, { k1: kp.jwk });
    const ready = [
      { id: "p1", portal: "sahibinden", kind: "label_map", field_key: "heating", source: "corrections", proposal: { anchor: "0123456789abcdef" }, confidence: 0.6 },
      { id: "p2", portal: "sahibinden", kind: "label_map", field_key: "facade", source: "ai", proposal: { label: "bakis" }, confidence: 0.9 },
    ];
    const cur = setV(2);
    const f = fakeAdmin({ outcome: "ok", settings: { auto_publish: true, auto_degrade: false }, ready, demote_candidates: [], demote_budget: 3 }, { id: "cur", version: 2, content: cur, expires_at: cur.expiresAt });
    const r = await runPortalRulesLearn(f.db, { nowMs: NOW, signing: st });
    expect(r).toMatchObject({ status: "ok", published: [{ portal: "sahibinden", version: 3, changes: 1, refresh: false }] });
    const pub = f.calls.find((c) => c.fn === "pt_rules_publish_system")!;
    expect(pub.args).toMatchObject({ p_portal: "sahibinden", p_kind: "auto", p_parent: "cur", p_proposal_ids: ["p1"], p_kid: "k1" });
    const content = pub.args.p_content as RuleSet;
    expect(content.version).toBe(3);
    expect(content.fields.find((x) => x.key === "heating")!.anchors).toEqual(["0123456789abcdef"]);
    expect(content.fields.find((x) => x.key === "facade")!.labels).not.toContain("bakis");
    expect(verifyRuleSignature(signedMessage("sahibinden", 3, String(pub.args.p_sha)), String(pub.args.p_signature), kp.jwk)).toBe(true);
  });

  it("öneriler tek tek uygulanır: riskli öneri atlanıp işaretlenir, kalanı yayınlanır; hepsi düşerse süre tazelemesi yine çalışır", async () => {
    const kp = keypair();
    const st = loadSigningKey(kp.env, { k1: kp.jwk });
    const heating = { id: "p1", portal: "sahibinden", kind: "label_map", field_key: "heating", source: "corrections", proposal: { anchor: "0123456789abcdef" }, confidence: 0.6 };
    const price = { id: "p2", portal: "sahibinden", kind: "label_map", field_key: "price", source: "corrections", proposal: { label: "satis bedeli" }, confidence: 0.7 };
    const cur = setV(2);
    const f = fakeAdmin({ outcome: "ok", settings: { auto_publish: true, auto_degrade: false }, ready: [heating, price], demote_candidates: [], demote_budget: 3 }, { id: "cur", version: 2, content: cur, expires_at: cur.expiresAt });
    const r = await runPortalRulesLearn(f.db, { nowMs: NOW, signing: st });
    expect(r).toMatchObject({ status: "ok", published: [{ portal: "sahibinden", version: 3, changes: 1, refresh: false }] });
    expect(r.status === "ok" && r.notPublished).toEqual([{ portal: "sahibinden", reason: "proposal_invalid:risky_key" }]);
    expect(f.calls.find((c) => c.fn === "pt_rules_mark_invalid")!.args).toEqual({ p_ids: ["p2"], p_reason: "risky_key" });
    const pub = f.calls.find((c) => c.fn === "pt_rules_publish_system")!;
    expect(pub.args).toMatchObject({ p_proposal_ids: ["p1"], p_change_summary: { count: 1 } });
    expect((pub.args.p_content as RuleSet).fields.find((x) => x.key === "price")!.labels).not.toContain("satis bedeli");

    // Yalnız riskli öneri + süresi yaklaşan set: içerik yayını yok, işaretleme + K3 tazeleme var.
    const near = NOW + 10 * 86_400_000;
    const g = fakeAdmin({ outcome: "ok", settings: { auto_publish: true, auto_degrade: false }, ready: [price], demote_candidates: [], demote_budget: 3 }, { id: "cur", version: 2, content: cur, expires_at: cur.expiresAt });
    const r2 = await runPortalRulesLearn(g.db, { nowMs: near, signing: st });
    expect(r2.status === "ok" && r2.published).toEqual([{ portal: "sahibinden", version: 3, changes: 0, refresh: true }]);
    expect(g.calls.filter((c) => c.fn === "pt_rules_mark_invalid")).toHaveLength(1);
    expect(g.calls.find((c) => c.fn === "pt_rules_publish_system")!.args).toMatchObject({ p_change_summary: { refresh: true, count: 0 } });
  });

  it("süresi yaklaşan yayın aynı içerikle yeniden imzalanır (K3); anahtar yoksa bildirilir", async () => {
    const kp = keypair();
    const st = loadSigningKey(kp.env, { k1: kp.jwk });
    const cur = setV(5, "emlakjet");
    const near = NOW + 10 * 86_400_000;
    const f = fakeAdmin({ outcome: "ok", settings: { auto_publish: false, auto_degrade: false }, ready: [], demote_candidates: [] }, { id: "c5", version: 5, content: cur, expires_at: cur.expiresAt });
    const r = await runPortalRulesLearn(f.db, { nowMs: near, signing: st });
    expect(r.status === "ok" && r.published).toEqual([{ portal: "emlakjet", version: 6, changes: 0, refresh: true }]);
    const noKey = await runPortalRulesLearn(fakeAdmin({ outcome: "ok", settings: {}, ready: [], demote_candidates: [] }, { id: "c5", version: 5, content: cur, expires_at: cur.expiresAt }).db, { nowMs: near, signing: { ok: false, reason: "missing" } });
    expect(noKey.status === "ok" && noKey.notPublished[0]!.reason).toBe("signing_unavailable");
  });
});

describe("AI önerisi çıktı doğrulaması (ai-suggest.ts)", () => {
  const input = [
    { field_sig: "a".repeat(64), control: "choice", label_folded: "yakit tipi", options_folded: ["dogalgaz"], distinct_tenants: 3 },
    { field_sig: "b".repeat(64), control: "number", label_folded: "satis bedeli", options_folded: [], distinct_tenants: 2 },
  ];
  it("girdide olmayan imza, FILL_FIELD_KEYS dışı/riskli anahtar ve tür uyumsuzluğu atılır; etiket girdiden gelir", () => {
    const out = parseSuggestions(
      JSON.stringify({
        suggestions: [
          { field_sig: "a".repeat(64), field_key: "heating", confidence: 0.8, label: "UYDURMA 0532 111 22 33" },
          { field_sig: "b".repeat(64), field_key: "price" },
          { field_sig: "c".repeat(64), field_key: "heating" },
          { field_sig: "a".repeat(64), field_key: "rooms" },
          { field_sig: "b".repeat(64), field_key: "owner_phone" },
        ],
      }),
      input,
    );
    expect(out).toEqual([{ field_sig: "a".repeat(64), field_key: "heating", label: "yakit tipi", confidence: 0.8, support_tenants: 3 }]);
    expect(parseSuggestions("bozuk", input)).toBeNull();
    expect(parseSuggestions(JSON.stringify({ x: 1 }), input)).toBeNull();
  });
});
