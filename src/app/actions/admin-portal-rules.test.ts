import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Portal kuralları yönetim eylemleri, P1'in GERÇEK sözleşmesine karşı: gerçek `seedRuleSet`, `validateRuleSet`,
 * `applyProposals` ve `publishRuleSet`/`rollbackRuleSet` (damga + imza) çalışır. Yalnız DB ve imza anahtarı taklittir:
 * sahte RPC'ler P1 parametre adlarını (p_sha/p_signature/p_kid, 'approve'/'reject', p_pii_confirmed, p_proposal_ids)
 * ve `{outcome}` sözleşmesini (forbidden, invalid_input, pii_confirmation_required, version_conflict, invalid_signature,
 * invalid_expiry, content_mismatch) uygular.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { generateKeyPairSync } = require("node:crypto") as typeof import("node:crypto");
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    jwk: publicKey.export({ format: "jwk" }) as JsonWebKey,
    staff: { id: "00000000-0000-4000-8000-0000000000aa", role: "super_admin" } as { id: string; role: string } | null,
    tables: {} as Record<string, Row[]>,
    rpcCalls: [] as { fn: string; args: Row }[],
    rateHits: new Map<string, number>(),
    suggest: { ok: true, outcome: "ok", created: 2, skipped: 0, model: "m" } as unknown,
    suggestCalls: 0,
    rpcOverride: null as null | ((fn: string, args: Row) => unknown),
  };
});

vi.mock("@/lib/portal-transfer/rule-keys", () => ({ RULE_PUBLIC_KEYS: { "test-1": { ...h.jwk, crv: "P-256" } } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/platform", () => ({
  requirePlatformModule: async () => {
    if (!h.staff) throw new Error("NEXT_REDIRECT");
    return h.staff;
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async (key: string, opts: { limit: number }) => {
    const n = (h.rateHits.get(key) ?? 0) + 1;
    h.rateHits.set(key, n);
    return { allowed: n <= opts.limit };
  },
}));
vi.mock("@/lib/settings/read", () => ({ getSettings: async () => ({ "portal_rules.ai_min_tenants": 3 }) }));
vi.mock("@/lib/portal-rules/server/ai-suggest", () => ({
  suggestPortalRules: async () => {
    h.suggestCalls += 1;
    return h.suggest;
  },
}));

/** Zincirlenebilir, bellek içi PostgREST taklidi (eq/in/not/order/limit/maybeSingle/head count). */
function query(table: string) {
  let filters: ((r: Row) => boolean)[] = [];
  let order: { col: string; asc: boolean } | null = null;
  let limit: number | null = null;
  let head = false;
  const exec = () => {
    let out = (h.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    if (order) {
      const { col, asc } = order;
      out = [...out].sort((a, b) => (Number(a[col]) - Number(b[col])) * (asc ? 1 : -1));
    }
    if (limit != null) out = out.slice(0, limit);
    return out;
  };
  const b = {
    select(_cols?: string, opts?: { head?: boolean }) {
      head = !!opts?.head;
      return b;
    },
    eq(col: string, v: unknown) {
      filters = [...filters, (r) => r[col] === v];
      return b;
    },
    in(col: string, vs: unknown[]) {
      filters = [...filters, (r) => vs.includes(r[col])];
      return b;
    },
    not(col: string, op: string, v: unknown) {
      if (op === "is" && v === null) filters = [...filters, (r) => r[col] != null];
      return b;
    },
    order(col: string, o?: { ascending?: boolean }) {
      order = { col, asc: o?.ascending !== false };
      return b;
    },
    limit(n: number) {
      limit = n;
      return b;
    },
    async maybeSingle() {
      return { data: exec()[0] ?? null, error: null };
    },
    then(resolve: (v: unknown) => unknown) {
      const rows = exec();
      return Promise.resolve(head ? { data: null, count: rows.length, error: null } : { data: rows, error: null }).then(resolve);
    },
  };
  return b;
}

function sets(portal: string) {
  return (h.tables.portal_rule_sets ?? []).filter((r) => r.portal === portal);
}

function proposals() {
  return h.tables.portal_rule_proposals ?? [];
}

/** P1 pt_rules_insert_set: imza zorunlu, sürüm = max+1, expiresAt (now, now+31g], içerik TS doğrulayıcısından geçer. */
function insertSet(args: Row, kind: string, extra: Row = {}): Row {
  if (!args.p_sha || !args.p_signature || !args.p_kid) return { outcome: "invalid_signature" };
  const portal = String(args.p_portal);
  const content = args.p_content as Row;
  if (!validateRuleSet(content, { portal: portal as "sahibinden" }).ok) return { outcome: "invalid_content" };
  const max = Math.max(0, ...sets(portal).map((r) => Number(r.version)));
  if (content.version !== max + 1) return { outcome: "version_conflict", expected: max + 1 };
  const exp = Date.parse(String(content.expiresAt));
  if (!(exp > Date.now() && exp <= Date.now() + 31 * 86_400_000)) return { outcome: "invalid_expiry" };
  for (const r of sets(portal)) if (r.status === "published") r.status = "superseded";
  const id = `00000000-0000-4000-8000-${String(max + 1).padStart(12, "0")}`;
  (h.tables.portal_rule_sets ??= []).push({ id, portal, version: max + 1, status: "published", kind, content, published_at: "2026-10-13T00:00:00Z", ...extra });
  const ids = (args.p_proposal_ids as string[] | null) ?? [];
  for (const p of proposals()) if (ids.includes(String(p.id)) && p.state === "approved") p.rule_set_id = id;
  return { outcome: "ok", id, version: max + 1 };
}

const db = {
  from: (t: string) => query(t),
  async rpc(fn: string, args: Row) {
    h.rpcCalls.push({ fn, args });
    if (h.rpcOverride) {
      const o = h.rpcOverride(fn, args);
      if (o !== undefined) return { data: o, error: null };
    }
    if (fn === "pt_rules_admin_publish") return { data: insertSet(args, String(args.p_kind)), error: null };
    if (fn === "pt_rules_admin_rollback") {
      const target = sets(String(args.p_portal)).find((r) => r.version === args.p_to_version && r.published_at);
      if (!target) return { data: { outcome: "not_found" }, error: null };
      const strip = (c: Row) => JSON.stringify({ ...c, version: 0, issuedAt: "", expiresAt: "" });
      if (strip(args.p_content as Row) !== strip(target.content as Row)) return { data: { outcome: "content_mismatch" }, error: null };
      return { data: insertSet(args, "rollback", { rolls_back_to: target.id }), error: null };
    }
    if (fn === "pt_rules_admin_decide") {
      if (args.p_decision !== "approve" && args.p_decision !== "reject") return { data: { outcome: "invalid_input" }, error: null };
      const p = proposals().find((r) => r.id === args.p_proposal_id);
      if (!p) return { data: { outcome: "not_found" }, error: null };
      if (p.state !== "ready" && p.state !== "collecting") return { data: { outcome: "already_decided", state: p.state }, error: null };
      if (args.p_decision === "approve" && ["label_map", "option_map", "new_field"].includes(String(p.kind)) && Number(p.support_tenants) < 2 && !args.p_pii_confirmed) {
        return { data: { outcome: "pii_confirmation_required" }, error: null };
      }
      p.state = args.p_decision === "approve" ? "approved" : "rejected";
      return { data: { outcome: "ok", state: p.state }, error: null };
    }
    if (fn === "pt_rules_admin_set_trust") return { data: { outcome: "ok" }, error: null };
    return { data: null, error: null };
  },
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));

import { decideProposal, publishSeed, rollbackTo, runAiSuggest, setTenantTrust } from "./admin-portal-rules";
import { seedRuleSet } from "@/lib/portal-transfer/seed-rules";
import { validateRuleSet } from "@/lib/portal-transfer/rule-format";

const PROPOSAL_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  process.env.PORTAL_RULES_SIGNING_KEY = h.pem;
  process.env.PORTAL_RULES_SIGNING_KID = "test-1";
  h.staff = { id: "00000000-0000-4000-8000-0000000000aa", role: "super_admin" };
  h.tables = {};
  h.rpcCalls = [];
  h.rateHits = new Map();
  h.suggest = { ok: true, outcome: "ok", created: 2, skipped: 0, model: "m" };
  h.suggestCalls = 0;
  h.rpcOverride = null;
});

async function seeded() {
  const r = await publishSeed("sahibinden");
  expect(r).toMatchObject({ ok: true, version: 1 });
  h.rpcCalls = [];
}

describe("kapı", () => {
  it("personel olmayan kullanıcı her eylemde reddedilir (yazma yok)", async () => {
    h.staff = null;
    await expect(publishSeed("sahibinden")).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(rollbackTo("sahibinden", 1)).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(decideProposal({ proposalId: PROPOSAL_ID, decision: "reject", reason: "gerekçe" })).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(setTenantTrust({ tenantId: TENANT_ID, eligible: false, reason: "test ofisi" })).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(runAiSuggest("sahibinden")).rejects.toThrow(/NEXT_REDIRECT/);
    expect(h.rpcCalls).toEqual([]);
  });

  it("ops yayın üretemez (tohum/geri alma/onay yalnız süper admin), ret ve uygunluk yapabilir", async () => {
    h.staff = { id: "00000000-0000-4000-8000-0000000000bb", role: "ops" };
    expect((await publishSeed("sahibinden")).error).toMatch(/süper admin/);
    expect((await rollbackTo("sahibinden", 1)).error).toMatch(/süper admin/);
    expect((await decideProposal({ proposalId: PROPOSAL_ID, decision: "approve" })).error).toMatch(/süper admin/);
    expect(h.rpcCalls).toEqual([]);
    expect((await setTenantTrust({ tenantId: TENANT_ID, eligible: false, reason: "Demo ofisi" })).ok).toBe(true);
    expect(h.rpcCalls.map((c) => c.fn)).toEqual(["pt_rules_admin_set_trust"]);
  });
});

describe("publishSeed", () => {
  it("set yokken tohumu imzalı sürüm 1 olarak yayınlar (14 günlük ömür, 9999 son tarihi taşınmaz)", async () => {
    const r = await publishSeed("sahibinden");
    expect(r).toMatchObject({ ok: true, version: 1 });
    const call = h.rpcCalls.find((c) => c.fn === "pt_rules_admin_publish")!;
    expect(call.args).toMatchObject({ p_portal: "sahibinden", p_kind: "seed", p_parent: null, p_kid: "test-1" });
    expect(call.args.p_sha).toMatch(/^[0-9a-f]{64}$/);
    expect(String(call.args.p_signature)).toMatch(/^[A-Za-z0-9_-]{80,100}$/);
    const content = call.args.p_content as Row;
    expect(content.version).toBe(1);
    expect(content.expiresAt).not.toBe(seedRuleSet("sahibinden").expiresAt);
    expect(validateRuleSet(content).ok).toBe(true);
  });

  it("set varken reddedilir ve RPC çağrılmaz", async () => {
    await seeded();
    const r = await publishSeed("sahibinden");
    expect(r.ok).toBeUndefined();
    expect(r.error).toMatch(/zaten kural seti var/);
    expect(h.rpcCalls).toEqual([]);
  });

  it("imza anahtarı yoksa yayın yapılmaz ve açık mesaj verilir", async () => {
    delete process.env.PORTAL_RULES_SIGNING_KEY;
    const r = await publishSeed("sahibinden");
    expect(r.error).toMatch(/imzalama anahtarı/);
    expect(h.rpcCalls).toEqual([]);
  });

  it("RPC reddi (outcome) başarı sayılmaz", async () => {
    h.rpcOverride = (fn) => (fn === "pt_rules_admin_publish" ? { outcome: "forbidden" } : undefined);
    const r = await publishSeed("sahibinden");
    expect(r.ok).toBeUndefined();
    expect(r.error).toMatch(/yetkiniz yok/);
  });

  it("geçersiz portal reddedilir", async () => {
    expect((await publishSeed("zingat")).error).toMatch(/Geçersiz portal/);
  });
});

describe("decideProposal", () => {
  async function withProposal(extra: Row = {}) {
    await seeded();
    h.tables.portal_rule_proposals = [
      {
        id: PROPOSAL_ID,
        portal: "sahibinden",
        kind: "label_map",
        field_key: "heating",
        proposal: { label: "isinma sistemi" },
        source: "corrections",
        support_tenants: 3,
        confidence: 0.6,
        state: "ready",
        ...extra,
      },
    ];
  }

  it("onay: önce decide(approve), sonra imzalı sürüm 2 yayınlanır ve öneriye rule_set_id bağlanır", async () => {
    await withProposal();
    const r = await decideProposal({ proposalId: PROPOSAL_ID, decision: "approve" });
    expect(r).toMatchObject({ ok: true, version: 2 });
    expect(h.rpcCalls.map((c) => c.fn)).toEqual(["pt_rules_admin_decide", "pt_rules_admin_publish"]);
    expect(h.rpcCalls[0].args).toMatchObject({ p_decision: "approve", p_pii_confirmed: false });
    expect(h.rpcCalls[1].args).toMatchObject({ p_kind: "staff", p_portal: "sahibinden", p_proposal_ids: [PROPOSAL_ID], p_parent: sets("sahibinden")[0].id });
    const v2 = sets("sahibinden").find((s) => s.version === 2)!;
    const heating = ((v2.content as Row).fields as Row[]).find((f) => f.key === "heating")!;
    expect(heating.labels).toContain("isinma sistemi");
    expect(proposals()[0]).toMatchObject({ state: "approved", rule_set_id: v2.id });
  });

  it("öneri uygulanamazsa (bozuk sonuç) hiçbir yazma yapılmaz", async () => {
    await withProposal({ proposal: { label: "X!" } });
    const r = await decideProposal({ proposalId: PROPOSAL_ID, decision: "approve" });
    expect(r.ok).toBeUndefined();
    expect(r.error).toMatch(/yayın yapılmadı/);
    expect(h.rpcCalls).toEqual([]);
    expect(sets("sahibinden")).toHaveLength(1);
    expect(proposals()[0].state).toBe("ready");
  });

  it("tek ofisten gelen metin önerisi kişisel veri teyidi olmadan onaylanmaz; teyit p_pii_confirmed olarak gider", async () => {
    await withProposal({ support_tenants: 1 });
    expect((await decideProposal({ proposalId: PROPOSAL_ID, decision: "approve" })).error).toMatch(/kişisel veri/);
    expect(h.rpcCalls).toEqual([]);
    const r = await decideProposal({ proposalId: PROPOSAL_ID, decision: "approve", noPersonalData: true });
    expect(r).toMatchObject({ ok: true, version: 2 });
    expect(h.rpcCalls[0].args).toMatchObject({ p_decision: "approve", p_pii_confirmed: true });
  });

  it("decide reddederse (already_decided) yayın yapılmaz", async () => {
    await withProposal();
    h.rpcOverride = (fn) => (fn === "pt_rules_admin_decide" ? { outcome: "already_decided" } : undefined);
    const r = await decideProposal({ proposalId: PROPOSAL_ID, decision: "approve" });
    expect(r.error).toMatch(/zaten karar/);
    expect(h.rpcCalls.map((c) => c.fn)).toEqual(["pt_rules_admin_decide"]);
    expect(sets("sahibinden")).toHaveLength(1);
  });

  it("onaydan sonra yayın başarısızsa ok:true DÖNMEZ, durum açıkça raporlanır", async () => {
    await withProposal();
    h.rpcOverride = (fn) => (fn === "pt_rules_admin_publish" ? { outcome: "invalid_expiry" } : undefined);
    const r = await decideProposal({ proposalId: PROPOSAL_ID, decision: "approve" });
    expect(r.ok).toBeUndefined();
    expect(r.error).toMatch(/onaylandı ancak yeni sürüm YAYINLANMADI/);
  });

  it("ret gerekçe ister; p_decision 'reject' gider; outcome ok değilse başarı denmez", async () => {
    await withProposal();
    expect((await decideProposal({ proposalId: PROPOSAL_ID, decision: "reject", reason: " " })).error).toMatch(/gerekçe/);
    expect(h.rpcCalls).toEqual([]);
    const r = await decideProposal({ proposalId: PROPOSAL_ID, decision: "reject", reason: "Yanlış eşleme" });
    expect(r).toMatchObject({ ok: true, notice: "Öneri reddedildi." });
    expect(h.rpcCalls[0]).toMatchObject({ fn: "pt_rules_admin_decide", args: { p_decision: "reject", p_reason: "Yanlış eşleme" } });
    expect(proposals()[0].state).toBe("rejected");
    const again = await decideProposal({ proposalId: PROPOSAL_ID, decision: "reject", reason: "Yanlış eşleme" });
    expect(again.ok).toBeUndefined();
    expect(again.error).toMatch(/zaten karar/);
  });
});

describe("rollbackTo", () => {
  it("geri alma eski içerikle imzalı yeni sürüm üretir (v1, v2 → v3 = v1 içeriği)", async () => {
    await seeded();
    h.tables.portal_rule_proposals = [
      { id: PROPOSAL_ID, portal: "sahibinden", kind: "label_map", field_key: "heating", proposal: { label: "isinma sistemi" }, source: "corrections", support_tenants: 3, state: "ready" },
    ];
    expect((await decideProposal({ proposalId: PROPOSAL_ID, decision: "approve" })).version).toBe(2);
    h.rpcCalls = [];
    const r = await rollbackTo("sahibinden", 1);
    expect(r).toMatchObject({ ok: true, version: 3 });
    expect(h.rpcCalls[0].args).toMatchObject({ p_portal: "sahibinden", p_to_version: 1, p_kid: "test-1" });
    const v1 = sets("sahibinden").find((s) => s.version === 1)!;
    const v3 = sets("sahibinden").find((s) => s.version === 3)!;
    expect(v3).toMatchObject({ kind: "rollback", rolls_back_to: v1.id, status: "published" });
    expect((v3.content as Row).fields).toEqual((v1.content as Row).fields);
  });

  it("yayındaki sürüme geri dönülmez; olmayan sürüm reddedilir", async () => {
    await seeded();
    expect((await rollbackTo("sahibinden", 1)).error).toMatch(/zaten yayında/);
    expect((await rollbackTo("sahibinden", 9)).error).toMatch(/bulunamadı/);
    expect(h.rpcCalls).toEqual([]);
  });

  it("hedef içerik bugünkü doğrulamadan geçmezse geri alma yapılmaz", async () => {
    await seeded();
    (h.tables.portal_rule_sets ??= []).push({ id: "x", portal: "sahibinden", version: 5, status: "superseded", kind: "staff", content: { bozuk: true }, published_at: "2026-10-01T00:00:00Z" });
    expect((await rollbackTo("sahibinden", 5)).error).toMatch(/doğrulamadan geçmiyor/);
    expect(h.rpcCalls).toEqual([]);
  });
});

describe("setTenantTrust", () => {
  it("outcome ok değilse başarı denmez", async () => {
    h.rpcOverride = (fn) => (fn === "pt_rules_admin_set_trust" ? { outcome: "not_found" } : undefined);
    const r = await setTenantTrust({ tenantId: TENANT_ID, eligible: false, reason: "Demo ofisi" });
    expect(r.ok).toBeUndefined();
    expect(r.error).toMatch(/bulunamadı/);
  });
});

describe("runAiSuggest", () => {
  it("portal başına hız sınırı: 2. çağrı reddedilir ve öneri üretilmez; sayı `created`tan okunur", async () => {
    const first = await runAiSuggest("sahibinden");
    expect(first).toMatchObject({ ok: true, notice: "2 AI önerisi eklendi (doğrulanmamış)." });
    const second = await runAiSuggest("sahibinden");
    expect(second.ok).toBeUndefined();
    expect(second.error).toMatch(/10 dakikada/);
    expect(h.suggestCalls).toBe(1);
  });

  it("no_input → yetersiz veri metni (ayardaki eşik)", async () => {
    h.suggest = { ok: true, outcome: "no_input", created: 0 };
    const r = await runAiSuggest("sahibinden");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Yetersiz veri (en az 3 ofiste görülen eşleşmemiş alan yok).");
  });

  it("ai_unconfigured / rate_limited / schema_pending ayrı mesaj verir", async () => {
    h.suggest = { ok: false, error: "ai_unconfigured" };
    expect((await runAiSuggest("sahibinden")).error).toMatch(/yapılandırılmamış/);
    h.suggest = { ok: false, error: "rate_limited" };
    expect((await runAiSuggest("hepsiemlak")).error).toMatch(/hız sınırı/);
    h.suggest = { ok: false, error: "schema_pending" };
    expect((await runAiSuggest("emlakjet")).error).toMatch(/Sistem güncellemesi/);
  });
});
